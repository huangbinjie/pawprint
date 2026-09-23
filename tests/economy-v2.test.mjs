import test from "node:test";
import assert from "node:assert/strict";
import { initialState, transition } from "../core/game.mjs";
import {
  RULES,
  dayKey,
  usedSlots,
  expansionCost,
  breedingEligibility,
  companionDays,
  migrateEconomy,
} from "../core/economy.mjs";
import { PARTNERS } from "../core/genetics.mjs";
import { validateState } from "../core/store.mjs";
const now = new Date(2026, 8, 20, 12).getTime(),
  DAY = 86400000;
let seq = 0;
const go = (s, c, t = now) =>
  transition(s, c, { now: t, rng: () => 0, id: () => `test-${++seq}` });
function mature(days = 8) {
  const born = now - (days - 1) * DAY;
  let s = go(initialState(born), { type: "connect" }, born);
  s = go(s, { type: "free-egg" }, born);
  s = go(s, { type: "hatch", eggId: s.eggs[0].id }, born);
  for (let i = 0; i < days; i++) {
    const t = born + i * DAY;
    s = go(
      s,
      {
        type: "observe",
        report: {
          complete: true,
          fresh: true,
          unpriced: 0,
          sourceId: "test",
          days: [{ date: dayKey(t), tokens: 1000, usd: 15, unpriced: 0 }],
        },
      },
      t,
    );
    s = go(s, { type: "claim" }, t);
  }
  return s;
}
test("new purchases use v2 prices; spending exits the ledger without altering past income", () => {
  let s = mature();
  const issued = s.balance;
  s = go(s, { type: "buy-egg", price: 0 });
  assert.equal(s.balance, issued - 240);
  assert.equal(s.ledger[0].amount, -240);
  assert.equal(
    s.ledger.filter((x) => x.amount > 0).reduce((n, x) => n + x.amount, 0),
    issued,
  );
  validateState(s);
  let rich = mature(14);
  assert.equal(expansionCost(rich), 600);
  rich = go(rich, { type: "expand" });
  assert.equal(rich.capacity, 4);
  assert.equal(expansionCost(rich), 900);
  rich = go(rich, { type: "expand" });
  assert.equal(rich.balance, 180);
  assert.equal(expansionCost(rich), 1200);
  validateState(rich);
});
test("growth counts distinct active days, not repeated visits, money or passive wall-clock age", () => {
  let s = go(initialState(now), { type: "free-egg" });
  s = go(s, { type: "hatch", eggId: s.eggs[0].id });
  const id = s.pets[0].id;
  for (let i = 0; i < 10; i++) s = go(s, { type: "visit" });
  assert.equal(companionDays(s.pets[0], now), 1);
  assert.equal(breedingEligibility(s.pets[0], now + 100 * DAY).allowed, false);
  s = go(s, { type: "visit" }, now + DAY);
  assert.equal(breedingEligibility(s.pets[0], now + DAY).allowed, false);
  s = go(s, { type: "garden", petId: id }, now + DAY);
  s = go(s, { type: "visit" }, now + 2 * DAY);
  assert.equal(s.pets[0].activeDays.length, 2);
  s = go(s, { type: "return-home", petId: id }, now + 2 * DAY);
  assert.equal(breedingEligibility(s.pets[0], now + 2 * DAY).allowed, true);
});
test("garden placement is reversible, frees capacity, changes no money or genes, and cannot be replayed", () => {
  let s = mature();
  const pet = structuredClone(s.pets[0]),
    balance = s.balance,
    ledger = structuredClone(s.ledger);
  s = go(s, { type: "garden", petId: pet.id });
  assert.equal(usedSlots(s), 0);
  assert.equal(s.activePetId, null);
  assert.equal(s.pets.length, 1);
  assert.equal(s.balance, balance);
  assert.deepEqual(s.ledger, ledger);
  assert.deepEqual(s.pets[0].genome, pet.genome);
  validateState(s);
  assert.throws(() => go(s, { type: "garden", petId: pet.id }));
  assert.throws(() => go(s, { type: "select", petId: pet.id }));
  assert.throws(() =>
    go(s, { type: "breed", petId: pet.id, partnerId: PARTNERS[0].id }),
  );
  s = go(s, { type: "return-home", petId: pet.id });
  assert.equal(s.activePetId, pet.id);
  assert.equal(usedSlots(s), 1);
  assert.deepEqual(s.pets[0].genome, pet.genome);
  assert.equal(s.balance, balance);
  assert.deepEqual(s.pets[0].parents, pet.parents);
  assert.equal(s.pets[0].residenceHistory.length, 2);
  validateState(s);
  assert.throws(() => go(s, { type: "return-home", petId: pet.id }));
});
test("returning a garden resident into a full home is rejected atomically, including egg slots", () => {
  let s = mature();
  const id = s.pets[0].id;
  s = go(s, { type: "garden", petId: id });
  for (let i = 0; i < 3; i++) s = go(s, { type: "buy-egg" });
  assert.equal(usedSlots(s), 3);
  const before = structuredClone(s);
  assert.throws(() => go(s, { type: "return-home", petId: id }), /住满/);
  assert.deepEqual(s, before);
  validateState(s);
});
test("48-hour cooldown and rolling seven-day quota survive garden trips and restarts", () => {
  let s = mature();
  const id = s.pets[0].id,
    partnerId = PARTNERS[0].id;
  s = go(s, { type: "breed", petId: id, partnerId });
  s = go(s, { type: "garden", petId: id });
  s = go(s, { type: "return-home", petId: id });
  s = JSON.parse(JSON.stringify(s));
  assert.equal(s.pets[0].lastBredAt, now);
  assert.equal(
    breedingEligibility(s.pets[0], now + 2 * DAY - 1).allowed,
    false,
  );
  s = go(s, { type: "breed", petId: id, partnerId }, now + 2 * DAY);
  const status = breedingEligibility(s.pets[0], now + 4 * DAY);
  assert.equal(status.allowed, false);
  assert.equal(status.readyAt, now + 7 * DAY);
  assert.equal(breedingEligibility(s.pets[0], now + 7 * DAY).allowed, true);
  assert.equal(breedingEligibility(s.pets[0], now - DAY).allowed, false);
  validateState(s);
});
test("legacy migration preserves assets and money, infers evidenced days, and keeps breeding cooldown", () => {
  const s = mature(3);
  const old = structuredClone(s);
  old.economyVersion = "local-v1";
  const p = old.pets[0];
  p.lastBredAt = now - 1000;
  p.breedCount = 1;
  delete p.residence;
  delete p.activeDays;
  delete p.breedHistory;
  delete p.residenceHistory;
  const next = migrateEconomy(old, now);
  assert.equal(next.economyVersion, RULES.version);
  assert.equal(next.balance, old.balance);
  assert.deepEqual(next.ledger, old.ledger);
  assert.deepEqual(next.pets[0].genome, p.genome);
  assert.equal(next.pets[0].activeDays.length, 3);
  assert.deepEqual(next.pets[0].breedHistory, [now - 1000]);
  assert.equal(breedingEligibility(next.pets[0], now).allowed, false);
  assert.equal(migrateEconomy(next, now), next);
  assert.equal(old.pets[0].activeDays, undefined);
  validateState(next);
});
