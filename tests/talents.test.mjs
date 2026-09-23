import test from "node:test";
import assert from "node:assert/strict";
import {
  TALENTS,
  drawTalent,
  legacyTalent,
  migrateTalents,
  talentOdds,
} from "../core/talents.mjs";
import { initialState, transition } from "../core/game.mjs";
import { validateState } from "../core/store.mjs";
import { dayKey } from "../core/economy.mjs";
const now = Date.now();
let n = 0;
const act = (s, c, t = now) =>
  transition(s, c, { now: t, rng: () => 0, id: () => `test-${++n}` });
test("talents use explicit birth weights and conditional inheritance odds", () => {
  const counts = Object.fromEntries(TALENTS.map((t) => [t.id, 0]));
  for (let i = 0; i < 100; i++) counts[drawTalent(() => i).id]++;
  for (const t of TALENTS) assert.equal(counts[t.id], t.weight);
  const odds = talentOdds({ id: "dance" }, { id: "dance" });
  assert.equal(odds.find((t) => t.id === "dance").percent, 73.6);
  assert.ok(Math.abs(odds.reduce((s, t) => s + t.percent, 0) - 100) < 1e-9);
  assert.equal(
    drawTalent(() => 0, { id: "moonwalk" }, { id: "flip" }).id,
    "moonwalk",
  );
});
test("legacy talent grant is fixed, does not reroll genes or currency and survives repeat migration", () => {
  const s = initialState(now);
  delete s.talentVersion;
  delete s.lanTransactions;
  s.pets = [{ id: "old-pet", genome: { coat: [1, 2] }, parents: [] }];
  const next = migrateTalents(s);
  assert.equal(next.pets[0].talent.id, legacyTalent(s.pets[0]).id);
  assert.deepEqual(next.pets[0].genome, s.pets[0].genome);
  assert.equal(next.balance, 0);
  assert.equal(migrateTalents(next), next);
  assert.equal(s.pets[0].talent, undefined);
});
test("training consumes coins, caps at level three, and never changes the birth talent or genes", () => {
  let s = act(initialState(now), { type: "connect" });
  s = act(s, { type: "free-egg" });
  s = act(s, { type: "hatch", eggId: s.eggs[0].id });
  for (let i = 0; i < 3; i++) {
    const at = now + i * 86400000;
    s = act(
      s,
      {
        type: "observe",
        report: {
          complete: true,
          fresh: true,
          unpriced: 0,
          sourceId: "fixture",
          days: [{ date: dayKey(at), tokens: 1000, usd: 15, unpriced: 0 }],
        },
      },
      at,
    );
    s = act(s, { type: "claim" }, at);
  }
  const pet = structuredClone(s.pets[0]);
  s = act(s, { type: "train", petId: pet.id });
  assert.equal(s.balance, 240);
  s = act(s, { type: "train", petId: pet.id });
  assert.equal(s.balance, 0);
  assert.equal(s.pets[0].talent.level, 3);
  assert.equal(s.pets[0].talent.id, pet.talent.id);
  assert.deepEqual(s.pets[0].genome, pet.genome);
  assert.throws(() => act(s, { type: "train", petId: pet.id }));
  validateState(s);
});
