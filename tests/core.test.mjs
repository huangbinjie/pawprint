import test from "node:test";
import assert from "node:assert/strict";
import { initialState, transition } from "../core/game.mjs";
import {
  dayKey,
  normalizeReport,
  availableReward,
  rewardForUSD,
} from "../core/economy.mjs";
import {
  PARTNERS,
  TRAITS,
  randomGenome,
  inheritGenome,
  phenotype,
  inheritanceOptions,
} from "../core/genetics.mjs";
import { randomInt } from "node:crypto";
const now = new Date(2026, 8, 14, 12).getTime();
let seq = 0;
const opts = (time = now) => ({
  now: time,
  rng: randomInt,
  id: () => `id-${++seq}`,
});
function run(s, command, time = now) {
  return transition(s, command, opts(time));
}
function report(usd = 6, tokens = 10000, time = now, extras = {}) {
  return normalizeReport(
    [
      {
        provider: "codex",
        source: "local",
        historyCoverageIsEstablished: true,
        updatedAt: new Date(time).toISOString(),
        daily: [
          {
            date: dayKey(time),
            totalTokens: tokens,
            totalCost: usd,
            modelBreakdowns: [{ modelName: "test-model", cost: usd }],
          },
        ],
        ...extras,
      },
    ],
    time,
  );
}
function withReward() {
  let s = run(initialState(now), { type: "connect" });
  s = run(s, { type: "observe", report: report(15) });
  return run(s, { type: "claim" });
}
function withPet(s = initialState(now)) {
  s = run(s, { type: "free-egg" });
  return run(s, { type: "hatch", eggId: s.eggs[0].id });
}

function fundedPet(days = 3) {
  const first = now - (days - 1) * 86400000;
  let s = run(initialState(first), { type: "connect" }, first);
  s = run(s, { type: "free-egg" }, first);
  s = run(s, { type: "hatch", eggId: s.eggs[0].id }, first);
  for (let i = 0; i < days; i++) {
    const time = first + i * 86400000;
    s = run(s, { type: "observe", report: report(15, 10000, time) }, time);
    s = run(s, { type: "claim" }, time);
  }
  return s;
}

test("daily reward curve is monotonic, rounded cumulatively and capped", () => {
  assert.equal(rewardForUSD(0.049), 0);
  assert.equal(rewardForUSD(0.05), 1);
  assert.equal(rewardForUSD(5), 100);
  assert.equal(rewardForUSD(6), 102);
  assert.equal(rewardForUSD(15), 120);
  assert.equal(rewardForUSD(10000), 120);
  assert.equal(rewardForUSD(NaN), 0);
  assert.equal(rewardForUSD(-1), 0);
});
test("claim, repeated scan, report rollback and disconnect cannot duplicate rewards", () => {
  let s = withReward();
  assert.equal(s.balance, 120);
  assert.equal(s.ledger.length, 1);
  s = run(s, { type: "observe", report: report(15) });
  assert.equal(availableReward(s, now), 0);
  assert.throws(() => run(s, { type: "claim" }));
  s = run(s, { type: "observe", report: report(1, 500) });
  s = run(s, { type: "observe", report: report(15) });
  assert.equal(availableReward(s, now), 0);
  s = run(s, { type: "disconnect" });
  s = run(s, { type: "connect" });
  assert.equal(availableReward(s, now), 0);
  assert.equal(s.balance, 120);
});
test("price-only changes do not create new currency; later new use earns only its delta", () => {
  let s = run(initialState(now), { type: "observe", report: report(1, 1000) });
  assert.equal(availableReward(s, now), 20);
  s = run(s, { type: "observe", report: report(3, 1000) });
  assert.equal(availableReward(s, now), 20);
  s = run(s, { type: "observe", report: report(4, 2000) });
  assert.equal(availableReward(s, now), 40);
});
test("daily rollover does not backfill or double count prior dates", () => {
  let s = withReward();
  const tomorrow = now + 86400000;
  assert.equal(availableReward(s, tomorrow), 0);
  s = run(s, { type: "observe", report: report(1, 2000, tomorrow) }, tomorrow);
  assert.equal(availableReward(s, tomorrow), 20);
  s = run(s, { type: "claim" }, tomorrow);
  assert.equal(s.balance, 140);
  const oldOnly = normalizeReport(
    [
      {
        provider: "codex",
        source: "local",
        historyCoverageIsEstablished: true,
        updatedAt: new Date(tomorrow).toISOString(),
        daily: [{ date: dayKey(now), totalTokens: 999999, totalCost: 500 }],
      },
    ],
    tomorrow,
  );
  s = run(s, { type: "observe", report: oldOnly }, tomorrow);
  assert.equal(availableReward(s, tomorrow), 0);
});
test("incomplete, stale, unpriced, and unknown-cost reports do not mint currency", () => {
  for (const extra of [
    { historyCoverageIsEstablished: false },
    { historyCoverageIsEstablished: undefined },
    { coverage: { unpriced: 1 } },
    { updatedAt: new Date(now - 3600000).toISOString() },
    { updatedAt: new Date(now + 3600000).toISOString() },
  ]) {
    const s = run(initialState(now), {
      type: "observe",
      report: report(5, 10000, now, extra),
    });
    assert.equal(availableReward(s, now), 0);
  }
  const s = run(initialState(now), { type: "observe", report: report(null) });
  assert.equal(availableReward(s, now), 0);
});
test("malformed reports fail without allowing ledger mutation", () => {
  assert.throws(() => report(-1));
  assert.throws(() => report(1, -1));
  assert.throws(() => report(1, 1.5));
  assert.throws(() => normalizeReport({ provider: "codex" }, now));
  assert.throws(() =>
    report(1, 10, now, {
      daily: [
        { date: dayKey(now), totalTokens: 10, totalCost: 1 },
        { date: dayKey(now), totalTokens: 10, totalCost: 1 },
      ],
    }),
  );
});
test("free egg is one-time; genome is fixed before hatch and hatch cannot be replayed", () => {
  let s = run(initialState(now), { type: "free-egg" });
  const egg = structuredClone(s.eggs[0]);
  assert.throws(() => run(s, { type: "free-egg" }));
  s = run(s, { type: "hatch", eggId: egg.id });
  assert.deepEqual(s.pets[0].genome, egg.genome);
  assert.equal(s.eggs.length, 0);
  assert.throws(() => run(s, { type: "hatch", eggId: egg.id }));
});
test("insufficient balance and full capacity preserve the original state", () => {
  const s = initialState(now);
  const original = structuredClone(s);
  assert.throws(() => run(s, { type: "buy-egg" }));
  assert.deepEqual(s, original);
  let funded = fundedPet(5);
  funded = run(funded, { type: "buy-egg" });
  funded = run(funded, { type: "buy-egg" });
  const before = structuredClone(funded);
  assert.throws(() => run(funded, { type: "buy-egg" }));
  assert.deepEqual(funded, before);
});
test("breeding atomically debits fee, retains lineage, respects incubation and cooldown", () => {
  let s = fundedPet();
  const parent = s.pets[0];
  const original = structuredClone(s);
  s = run(s, { type: "breed", petId: parent.id, partnerId: PARTNERS[0].id });
  assert.equal(s.balance, 180);
  assert.equal(s.ledger[0].amount, -180);
  assert.equal(s.eggs.length, 1);
  assert.equal(s.eggs[0].generation, 2);
  assert.equal(s.eggs[0].parents[0].name, parent.name);
  assert.throws(() => run(s, { type: "hatch", eggId: s.eggs[0].id }));
  assert.throws(() =>
    run(s, { type: "breed", petId: parent.id, partnerId: PARTNERS[0].id }),
  );
  const genome = structuredClone(s.eggs[0].genome);
  s = run(s, { type: "hatch", eggId: s.eggs[0].id }, now + 20000);
  assert.equal(s.pets.length, 2);
  assert.deepEqual(s.pets[1].genome, genome);
  assert.equal(original.balance, 360);
  assert.equal(
    s.balance,
    s.ledger.reduce((sum, e) => sum + e.amount, 0),
  );
});
test("gene inheritance always takes one allele from each parent; phenotype is stable", () => {
  for (let i = 0; i < 500; i++) {
    const a = randomGenome(randomInt),
      b = randomGenome(randomInt),
      child = inheritGenome(a, b, randomInt);
    for (const key of Object.keys(TRAITS)) {
      assert.ok(
        (a[key].includes(child[key][0]) && b[key].includes(child[key][1])) ||
          (a[key].includes(child[key][1]) && b[key].includes(child[key][0])),
      );
      assert.equal(
        inheritanceOptions(a, b, key).reduce((sum, o) => sum + o.percent, 0),
        100,
      );
      assert.ok(
        inheritanceOptions(a, b, key).some(
          (o) => o.value === phenotype(child)[key],
        ),
      );
    }
    assert.deepEqual(
      phenotype(child),
      phenotype(JSON.parse(JSON.stringify(child))),
    );
  }
});
test("unknown commands, invalid names and forged pricing are rejected or ignored", () => {
  let s = fundedPet();
  assert.throws(() => run(s, { type: "mint", amount: 999 }));
  assert.throws(() =>
    run(s, { type: "rename", petId: s.pets[0].id, name: " " }),
  );
  assert.throws(() =>
    run(s, { type: "rename", petId: s.pets[0].id, name: "x".repeat(13) }),
  );
  s = run(s, {
    type: "breed",
    petId: s.pets[0].id,
    partnerId: PARTNERS[0].id,
    fee: -1000,
  });
  assert.equal(s.balance, 180);
});
