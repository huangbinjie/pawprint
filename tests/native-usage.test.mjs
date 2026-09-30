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

test("dynamic provider pricing reparses cached unknown usage and releases only the daily difference", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(root, "dynamic.jsonl", [meta("dynamic", now, {model_provider: "other"}), context(now, "new-model"), meter(now, tokens(1000000, 1000, 500000))], now);
    const first = (await scanUsage({codexHome: root, cacheDirectory, now}))[0];
    assert.equal(first.daily.at(-1).totalCost, null);
    const catalog = {other: {models: {"new-model": {cost: {input: 2, cache_read: 0.2, output: 10}}}}};
    const second = (await scanUsage({codexHome: root, cacheDirectory, now, catalog, pricingVersion: "dynamic-1"}))[0];
    close(second.daily.at(-1).totalCost, 1.11);
    assert.equal(second.daily.at(-1).cachedTokens, 500000);
    assert.equal(second.sourceId, first.sourceId);
    const state = initialState(now);
    observeUsage(state, normalizeReport([first], now), now);
    observeUsage(state, normalizeReport([second], now), now);
    assert.equal(availableReward(state, now), 22);
    state.usage.days[dayKey(now)].claimed = 22;
    observeUsage(state, normalizeReport([second], now), now);
    assert.equal(availableReward(state, now), 0);
  }));

test("partial pricing rewards known records while keeping unknown models explicit", () =>
  fixture(async (root, cacheDirectory) => {
    await logFile(root, "mixed.jsonl", [meta("mixed", now), context(now), meter(now, tokens(1000000, 1000)), context(now, "unknown", "turn-2"), meter(now, tokens(1000100, 1010), tokens(100, 10))], now);
    const report = normalizeReport(await scanUsage({codexHome: root, cacheDirectory, now}), now);
    assert.equal(report.days.at(-1).usd, null);
    close(report.days.at(-1).knownUSD, 20.075);
    const state = initialState(now);
    observeUsage(state, report, now);
    assert.equal(availableReward(state, now), 120);
  }));

test("repeated identical session metadata is harmless while conflicting identity remains incomplete", () =>
 fixture(async (root, cacheDirectory) => {
  await logFile(root,"repeat.jsonl",[meta("repeat",now),context(now),meter(now,tokens()),meta("repeat",now)],now);
  assert.equal((await scanUsage({codexHome:root,cacheDirectory,now}))[0].historyCoverageIsEstablished,true);
  await appendFile(path.join(root,"sessions","repeat.jsonl"),JSON.stringify(meta("different",now))+"\n");
  assert.equal((await scanUsage({codexHome:root,cacheDirectory,now}))[0].historyCoverageIsEstablished,false);
 }));

test("copied ancestor metadata keeps leaf identity and provider; mirrors and parent use are not rewarded twice", () =>
 fixture(async (root, cacheDirectory) => {
  const parentRows = [meta("parent-with-history", now - 200), context(now - 190), meter(now - 180, tokens(10000,1000))];
  await logFile(root,"parent.jsonl",parentRows,now);
  const leafMeta = meta("leaf",now - 100,{forked_from_id:"parent-with-history",parent_thread_id:"parent-with-history",subagent_history_start_ordinal:4,model_provider:"leaf-provider"});
  const childRows = [leafMeta,...parentRows,context(now - 90,"leaf-model","leaf-turn"),meter(now - 80,tokens(11000,1100),tokens())];
  await logFile(root,"child.jsonl",childRows,now);
  await mkdir(path.join(root,"archived_sessions"));
  await copyFile(path.join(root,"sessions","child.jsonl"),path.join(root,"archived_sessions","mirror.jsonl"));
  const catalog={"leaf-provider":{models:{"leaf-model":{cost:{input:2,output:10}}}}};
  const [report] = await scanUsage({codexHome:root,cacheDirectory,now,catalog});
  assert.equal(report.historyCoverageIsEstablished,true);
  assert.equal(report.daily.at(-1).totalTokens,12100);
  assert.equal(report.daily.at(-1).modelBreakdowns.find(m=>m.modelName==="leaf-model").provider,"leaf-provider");
  close(report.daily.at(-1).totalCost,0.153);
  const cached = await scanUsage({codexHome:root,cacheDirectory,now,catalog});
  assert.deepEqual(cached[0].daily,report.daily);
  const state=initialState(now);
  observeUsage(state,normalizeReport([report],now),now);
  const reward=availableReward(state,now);
  assert.equal(reward,3);
  state.usage.days[dayKey(now)].claimed=reward;
  observeUsage(state,normalizeReport(cached,now),now);
  assert.equal(availableReward(state,now),0);
 }));

test("declared parent metadata before fork creation is inherited without an ordinal; unrelated identities still fail", () =>
 fixture(async (root, cacheDirectory) => {
  const records=[meta("leaf-time",now - 100,{forked_from_id:"parent-time"}),meta("parent-time",now - 200),context(now - 190),meter(now - 180,tokens(5000,500)),context(now - 90),meter(now - 80,tokens(6000,600),tokens())];
  const file=await logFile(root,"time.jsonl",records,now);
  let [report]=await scanUsage({codexHome:root,cacheDirectory,now});
  assert.equal(report.historyCoverageIsEstablished,true);
  assert.equal(report.daily.at(-1).totalTokens,1100);
  await appendFile(file,JSON.stringify(meta("unrelated",now))+"\n");
  [report]=await scanUsage({codexHome:root,cacheDirectory,now});
  assert.equal(report.historyCoverageIsEstablished,false);
  assert.ok(report.diagnostics.issues.includes("multiple-session-identities"));
 }));

test("ancestor identity outside the explicit inherited boundary remains a conflict", () =>
 fixture(async(root,cacheDirectory)=>{
  await logFile(root,"outside.jsonl",[meta("leaf-outside",now - 100,{forked_from_id:"parent-outside",subagent_history_start_ordinal:1}),meta("parent-outside",now - 200),context(now - 90),meter(now - 80,tokens())],now);
  const [report]=await scanUsage({codexHome:root,cacheDirectory,now});
  assert.equal(report.historyCoverageIsEstablished,false);
 }));

test("upgrading a zero-use baseline does not withhold today's newly priceable reward",()=>{
 const state=initialState(now),date=dayKey(now);
 state.usage.days[date]={sourceId:"old-price-version",maxTokens:0,maxUSD:0,eligibleUSD:0,claimed:0};
 const report={complete:true,fresh:true,sourceId:"stable-source",days:[{date,tokens:1000000,pricedTokens:1000000,usd:80,knownUSD:80,unpriced:0}]};
 observeUsage(state,report,now);
 assert.equal(availableReward(state,now),120);
 state.usage.days[date].claimed=120;
 observeUsage(state,report,now);
 assert.equal(availableReward(state,now),0);
});
