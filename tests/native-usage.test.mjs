import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  copyFile,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tokenCounts, estimateCost } from "../electron/usage/pricing.mjs";
import { scanUsage, parseSession } from "../electron/usage/scanner.mjs";
import { readUsage } from "../electron/local-usage.mjs";
import {
  normalizeReport,
  observeUsage,
  availableReward,
  dayKey,
} from "../core/economy.mjs";
import { initialState } from "../core/game.mjs";
import { meta, context, meter, tokens, logFile } from "./fixtures/codex.mjs";
const now = new Date(2026, 8, 20, 12).getTime(),
  startMs = now - 7 * 86400000;
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-native-"));
  try {
    await fn(root, path.join(root, "cache"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function close(a, b) {
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
}
test("native pricing separates input, cache reads/writes and output without double charging reasoning", () => {
  const c = tokenCounts(tokens(1000, 100, 400, 200, 40));
  close(estimateCost("gpt-6-astra", c), 0.0119);
  close(estimateCost("gpt-6-astra", c, "fast"), 0.0238);
  close(estimateCost("gpt-6-astra", c, "flex"), 0.00595);
  close(estimateCost("gpt-6-astra", tokenCounts(tokens(272000, 1000))), 2.77);
  close(
    estimateCost("gpt-6-astra", tokenCounts(tokens(272001, 1000))),
    5.51502,
  );
  assert.equal(estimateCost("unreleased-model", c), null);
  assert.equal(estimateCost("gpt-5", c), null);
  assert.equal(estimateCost("gpt-6-astra", c, "unknown"), null);
  assert.equal(tokenCounts(tokens(100, 1, 110)), null);
  assert.equal(tokenCounts(tokens(-1)), null);
  assert.equal(tokenCounts(tokens(100, 2, 0, 0, 3)), null);
});
test("direct local reader deduplicates repeated snapshots and archive mirrors; cached scans stay identical", () =>
  fixture(async (root, cacheDirectory) => {
    const first = tokens(1000, 100),
      second = tokens(2000, 200, 400);
    const total = tokens(3000, 300, 400);
    const file = await logFile(
      root,
      "session.jsonl",
      [
        meta("session", now - 100),
        context(now - 100),
        meter(now - 90, first),
        meter(now - 80, first),
        meter(now - 70, total, second),
      ],
      now,
    );
    await mkdir(path.join(root, "archived_sessions"));
    await copyFile(file, path.join(root, "archived_sessions", "copy.jsonl"));
    const a = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(a.historyCoverageIsEstablished, true);
    assert.equal(a.daily.at(-1).totalTokens, 3300);
    assert.equal(a.coverage.unpriced, 0);
    const b = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.deepEqual(a.daily, b.daily);
    assert.equal(b.diagnostics.cachedFiles, 2);
  }));
test("changed files are rescanned, partial final records are withheld until completed", () =>
  fixture(async (root, cacheDirectory) => {
    const file = await logFile(
      root,
      "live.jsonl",
      [meta("live", now - 100), context(now - 100), meter(now - 90, tokens())],
      now,
    );
    const next = JSON.stringify(meter(now - 70, tokens(2000, 200), tokens()));
    await appendFile(file, next.slice(0, -12));
    let r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 1100);
    assert.equal(r.historyCoverageIsEstablished, true);
    await appendFile(file, next.slice(-12) + "\n");
    r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 2200);
    assert.equal(r.diagnostics.scannedFiles, 1);
  }));
test("model switches and counter resets price each actual request at its own model", () =>
  fixture(async (root, cacheDirectory) => {
    const rows = [
      meta("models", now - 100),
      context(now - 99),
      meter(now - 90, tokens()),
      context(now - 80, "gpt-5.6-luna", "turn-2"),
      meter(now - 70, tokens(2000, 200), tokens()),
      context(now - 60, "gpt-6-astra", "turn-3"),
      meter(now - 50, tokens(500, 50), tokens(500, 50)),
    ];
    await logFile(root, "models.jsonl", rows, now);
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 2750);
    close(r.daily.at(-1).totalCost, 0.015 + 0.00032 + 0.0075);
  }));
test("copied subagent history is excluded using its ordinal boundary", () =>
  fixture(async (root, cacheDirectory) => {
    const rows = [
      meta("child", now - 100, {
        subagent_history_start_ordinal: 4,
        source: { subagent: { parent_thread_id: "parent" } },
      }),
      context(now - 200),
      meter(now - 150, tokens(10000, 1000)),
      context(now - 90, "gpt-6-astra", "child-turn"),
      meter(now - 80, tokens(11000, 1100), tokens()),
    ];
    await logFile(root, "child.jsonl", rows, now);
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 1100);
    assert.equal(r.coverage.unpriced, 0);
  }));
test("fork timestamps exclude inherited prefix when there is no explicit ordinal", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(
      root,
      "fork.jsonl",
      [
        meta("fork", now - 100, { forked_from_id: "parent" }),
        context(now - 200),
        meter(now - 150, tokens(5000, 500)),
        context(now - 90, "gpt-6-astra", "fork-turn"),
        meter(now - 80, tokens(6000, 600), tokens()),
      ],
      now,
    );
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 1100);
  }));
test("unknown models and missing request detail do not mint currency", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(
      root,
      "unknown.jsonl",
      [
        meta("unknown", now - 100),
        context(now - 99, "future-model"),
        meter(now - 90, tokens()),
      ],
      now,
    );
    await logFile(
      root,
      "gap.jsonl",
      [
        meta("gap", now - 100),
        context(now - 99),
        meter(now - 90, tokens(9000, 900), tokens()),
      ],
      now,
    );
    const report = normalizeReport(
      await scanUsage({ codexHome: root, cacheDirectory, now }),
      now,
    );
    assert.equal(report.unpriced, 2);
    const state = initialState(now);
    observeUsage(state, report, now);
    assert.equal(availableReward(state, now), 0);
  }));
test("bad counters, malformed metering and missing identity fail closed", () =>
  fixture(async (root, cacheDirectory) => {
    const file = await logFile(
      root,
      "bad.jsonl",
      [
        context(now - 100),
        meter(now - 90, tokens()),
        '{"type":"event_msg","payload":{"type":"token_count", broken}',
      ],
      now,
    );
    const parsed = await parseSession(file, { startMs, endMs: now });
    assert.equal(parsed.complete, false);
    assert.equal(parsed.rows.length, 0);
  }));
test("cache corrections cannot replay the last request", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(
      root,
      "correct.jsonl",
      [
        meta("correct", now - 100),
        context(now - 99),
        meter(now - 90, tokens(1000, 100, 100)),
        meter(now - 80, tokens(1000, 100, 200), tokens(1000, 100, 200)),
      ],
      now,
    );
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 1100);
  }));
test("large conversation bodies are skipped, and caches contain neither text nor instructions", () =>
  fixture(async (root, cacheDirectory) => {
    const secret = "PRIVATE-CONVERSATION-DO-NOT-CACHE";
    await logFile(
      root,
      "privacy.jsonl",
      [
        meta("privacy", now - 100, { base_instructions: secret }),
        context(now - 99),
        {
          timestamp: new Date(now - 98).toISOString(),
          type: "event_msg",
          payload: {
            type: "user_message",
            message: secret + "x".repeat(2 * 1024 * 1024),
          },
        },
        meter(now - 90, tokens()),
      ],
      now,
    );
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.historyCoverageIsEstablished, true);
    assert.equal(r.daily.at(-1).totalTokens, 1100);
    for (const file of await readdir(cacheDirectory))
      assert.ok(
        !(await readFile(path.join(cacheDirectory, file), "utf8")).includes(
          secret,
        ),
      );
  }));
test("old-created sessions with recent activity are discovered; out-of-window rows do not count", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(
      root,
      "2025/01/01/old.jsonl",
      [
        meta("old", now - 20 * 86400000),
        context(now - 20 * 86400000),
        meter(now - 20 * 86400000, tokens()),
        meter(now - 90, tokens(2000, 200), tokens()),
      ],
      now,
    );
    const r = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.equal(r.daily.at(-1).totalTokens, 1100);
    assert.equal(
      r.daily.reduce((n, d) => n + d.totalTokens, 0),
      1100,
    );
  }));
test("switching adapter, directory or pricing version establishes a baseline and preserves old earnings", () => {
  const s = initialState(now),
    date = dayKey(now);
  s.usage.days[date] = {
    maxTokens: 1000,
    maxUSD: 1,
    eligibleUSD: 1,
    claimed: 20,
  };
  s.balance = 20;
  const report = {
    complete: true,
    fresh: true,
    unpriced: 0,
    sourceId: "native-A",
    days: [{ date, tokens: 100000, usd: 10, unpriced: 0 }],
  };
  observeUsage(s, report, now);
  assert.equal(availableReward(s, now), 0);
  assert.equal(s.balance, 20);
  assert.equal(s.usage.days[date].eligibleUSD, 1);
  observeUsage(
    s,
    { ...report, days: [{ date, tokens: 101000, usd: 11, unpriced: 0 }] },
    now,
  );
  assert.equal(availableReward(s, now), 20);
  observeUsage(s, { ...report, sourceId: "native-B" }, now);
  assert.equal(availableReward(s, now), 20);
  observeUsage(s, report, now);
  assert.equal(availableReward(s, now), 20);
});
test("older unpriced dates do not block a complete priced day", () => {
  const s = initialState(now);
  observeUsage(
    s,
    {
      complete: true,
      fresh: true,
      unpriced: 2,
      sourceId: "A",
      days: [{ date: dayKey(now), tokens: 1000, usd: 1, unpriced: 0 }],
    },
    now,
  );
  assert.equal(availableReward(s, now), 20);
});
test("bundled worker runs with an empty executable search path and reports missing directories clearly", () =>
  fixture(async (root, cacheDirectory) => {
    await assert.rejects(
      () =>
        readUsage({
          codexHome: path.join(root, "absent"),
          cacheDirectory,
          now,
        }),
      /目录/,
    );
    await logFile(
      root,
      "worker.jsonl",
      [meta("worker", now - 100), context(now - 99), meter(now - 90, tokens())],
      now,
    );
    const old = process.env.PATH;
    process.env.PATH = "";
    try {
      const report = await readUsage({ codexHome: root, cacheDirectory, now });
      assert.equal(report.source, "builtin-codex-v1");
      assert.equal(report.days.at(-1).tokens, 1100);
    } finally {
      process.env.PATH = old;
    }
  }));

test("a corrupt non-authoritative cache is rebuilt from source records", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(
      root,
      "rebuild.jsonl",
      [
        meta("rebuild", now - 100),
        context(now - 99),
        meter(now - 90, tokens()),
      ],
      now,
    );
    const a = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    const file = path.join(
      cacheDirectory,
      (await readdir(cacheDirectory)).find((f) => f.endsWith(".json")),
    );
    const cache = JSON.parse(await readFile(file, "utf8"));
    Object.values(cache.files)[0].data = { rows: "invalid" };
    await writeFile(file, JSON.stringify(cache));
    const b = (await scanUsage({ codexHome: root, cacheDirectory, now }))[0];
    assert.deepEqual(b.daily, a.daily);
    assert.equal(b.diagnostics.scannedFiles, 1);
  }));
