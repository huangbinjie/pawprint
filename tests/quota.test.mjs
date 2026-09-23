import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseQuotaLine, quotaPresentation } from "../core/quota.mjs";
import { scanQuota } from "../electron/quota/scan.mjs";
import { QuotaMonitor } from "../electron/quota/monitor.mjs";
import { initialState, transition } from "../core/game.mjs";
const now = Date.now();
const window = (minutes, used = 62) => ({ window_minutes: minutes, used_percent: used, resets_at: Math.floor((now + minutes * 30000) / 1000) });
const record = (q, at = now) => JSON.stringify({ type: "event_msg", timestamp: new Date(at).toISOString(), payload: { type: "token_count", rate_limits: q } }) + "\n";
test("quota uses window duration rather than primary/secondary position and displays remaining", () => {
  const data = parseQuotaLine(record({ limit_id: "codex", primary: window(10080), secondary: window(300, 20) }), now);
  const view = quotaPresentation({ enabled: true, data }, "both", now);
  assert.equal(view.title, "5h 80% · W 38%");
  assert.equal(view.values.weekly.percent, 38);
  assert.equal(parseQuotaLine(record({ limit_id: "codex-spark", primary: window(10080, 0) }), now), null);
  assert.equal(parseQuotaLine(record({ limit_id: "codex", primary: window(300, 110) }), now).windows.session.remaining, 0);
});
test("missing, stale, expired and malformed quotas never become a fabricated full allowance", () => {
  const data = parseQuotaLine(record({ primary: window(10080), secondary: null }), now);
  assert.equal(quotaPresentation({ enabled: true, data }, "session", now).title, "5h —");
  assert.equal(quotaPresentation({ enabled: true, data }, "weekly", now + 16 * 60000).title, "W ~38%");
  assert.equal(quotaPresentation({ enabled: true, data }, "weekly", data.windows.weekly.resetAt).title, "W —");
  assert.equal(quotaPresentation({ enabled: true, data, error: "unreadable" }, "weekly", now).title, "W ~38%");
  assert.deepEqual(parseQuotaLine(record({ primary: window(10080, "62") }), now).windows, {});
  assert.equal(parseQuotaLine("not json", now), null);
  assert.equal(parseQuotaLine(record({ primary: window(10080) }, now + 120000), now), null);
  assert.deepEqual(parseQuotaLine(record({ primary: { ...window(300), resets_at: 999999999999 } }), now).windows, {});
});
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pawprint-quota-"));
  await mkdir(path.join(directory, "sessions/2020/01/01"), { recursive: true });
  // Credentials are deliberately invalid. This scanner must never need them.
  await writeFile(path.join(directory, "auth.json"), "PRIVATE-CREDENTIAL-SENTINEL");
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, "sessions/2020/01/01/old-active.jsonl") };
}
test("scanner finds resumed old files, skips other model buckets, withholds partial lines and leaks no text", async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ type: "response_item", payload: "PRIVATE-TEXT".repeat(80000) }) + "\n" + record({ primary: window(10080) }));
  await appendFile(file, record({ limit_id: "codex-spark", primary: window(10080, 1) }, now + 1));
  const partial = record({ primary: window(10080, 80) }, now + 2);
  await appendFile(file, partial.slice(0, -1));
  const data = await scanQuota({ directory, now });
  assert.equal(data.windows.weekly.remaining, 38);
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
  await appendFile(file, "\n");
  assert.equal((await scanQuota({ directory, now })).windows.weekly.remaining, 20);
});
test("a newer explicit empty snapshot replaces old windows; same-time conflicting records stay unknown", async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, record({ primary: window(10080) }) + record({ primary: null, secondary: null }, now + 1));
  assert.deepEqual((await scanQuota({ directory, now })).windows, {});
  await writeFile(file, record({ primary: window(10080) }) + record({ primary: window(10080, 70) }));
  const result = await scanQuota({ directory, now });
  assert.equal(result.ambiguous, true); assert.deepEqual(result.windows, {});
});
test("worker reads quota without external commands and clears memory on disconnect or directory change", async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, record({ primary: window(10080) }));
  const monitor = new QuotaMonitor();
  try {
    await monitor.configure({ directory, enabled: true });
    assert.equal(monitor.snapshot().data.windows.weekly.remaining, 38);
    await monitor.configure({ directory, enabled: false });
    assert.equal(monitor.snapshot().data, null);
    await monitor.configure({ directory: path.join(directory, "missing"), enabled: true });
    assert.equal(monitor.snapshot().data, null); assert.ok(monitor.snapshot().error);
  } finally { await monitor.close(); }
});
test("display preferences never change currency, genes or usage reward calculations", () => {
  const before = initialState(now);
  const after = transition(before, { type: "quota-settings", enabled: true, window: "both" }, { now });
  assert.deepEqual({ ...after, settings: before.settings }, before);
  assert.throws(() => transition(before, { type: "quota-settings", enabled: true, window: "spark" }, { now }));
});
