import test from "node:test";
import assert from "node:assert/strict";
import { drawSkills, IDLE_SKILLS, SOCIAL_SKILLS, petSkills, migrateSkills, skillOdds, ownsSkill, socialCast } from "../core/skills.mjs";
import { initialState, transition } from "../core/game.mjs";
import { scaledFloatSize, floatPosition } from "../core/desktop.mjs";
import { IdleDirector } from "../core/idle.mjs";
import { cleanPet, lanTransition } from "../core/multiplayer.mjs";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("skill pools match exact founder probabilities and inheritance odds sum separately", () => {
  const counts = {};
  for (let i = 0; i < 100; i++) {
    const s = drawSkills(() => i);
    for (const id of Object.values(s)) counts[id] = (counts[id] || 0) + 1;
  }
  for (const s of [...IDLE_SKILLS, ...SOCIAL_SKILLS]) assert.equal(counts[s.id], s.weight);
  for (const category of ["idle", "social"]) {
    const same = { idle: "starnap", social: "constellation" };
    const odds = skillOdds(category, same, same);
    assert.ok(Math.abs(odds.reduce((sum, s) => sum + s.percent, 0) - 100) < 1e-8);
    assert.equal(odds.find(s => s.id === same[category]).percent, 70.9);
  }
  assert.deepEqual(drawSkills(() => 0, { idle: "box", social: "duet" }, { idle: "starnap", social: "constellation" }), { idle: "box", social: "duet" });
});
test("legacy skills are a stable grant and never reroll original talents, genes or money", () => {
  const old = initialState(1); delete old.skillVersion;
  old.pets.push({ id: "old-cat", genome: { coat: [2, 3] }, talent: { id: "flip", level: 3 }, parents: [{ id: "parent", talent: { id: "wave", level: 1 } }] });
  const upgraded = migrateSkills(old);
  assert.deepEqual(upgraded.pets[0].skills, petSkills(old.pets[0]));
  assert.deepEqual(upgraded.pets[0].talent, old.pets[0].talent);
  assert.deepEqual(upgraded.pets[0].genome, old.pets[0].genome);
  assert.equal(upgraded.balance, old.balance);
  assert.equal(migrateSkills(upgraded), upgraded);
  assert.equal(old.pets[0].skills, undefined);
  assert.ok(ownsSkill(upgraded.pets[0], "ball"));
  assert.ok(!ownsSkill(upgraded.pets[0], "arbitrary"));
});
test("skills are fixed in the egg and hatch/rename cannot redraw them", () => {
  let n = 0; const ctx = { now: 5, rng: () => 99, id: () => `p-${++n}` };
  let s = transition(initialState(1), { type: "free-egg" }, ctx);
  const skills = structuredClone(s.eggs[0].skills);
  s = transition(s, { type: "hatch", eggId: s.eggs[0].id }, { ...ctx, rng: () => 0 });
  s = transition(s, { type: "rename", petId: s.pets[0].id, name: "不重抽" }, ctx);
  assert.deepEqual(s.pets[0].skills, skills);
});
test("social cast requires an accepted current guest and the leader's own skill", () => {
  const host = { id: "same-id", name: "A", residence: "home", genome: {}, skills: { idle: "groom", social: "highfive" } };
  const guest = { ...host, name: "B", skills: { idle: "box", social: "constellation" } };
  const visitors = [{ id: "visit", pet: guest, expiresAt: 100 }];
  const r = { visitId: "visit", petId: host.id, leader: "guest", skillId: "constellation" };
  assert.equal(socialCast([host], visitors, r, 50).guest.name, "B");
  assert.throws(() => socialCast([host], [], r, 50));
  assert.throws(() => socialCast([host], visitors, r, 101));
  assert.throws(() => socialCast([host], visitors, { ...r, leader: "host" }, 50));
});
test("scaled windows and roaming use their actual smaller dimensions without changing genes", () => {
  const s = transition(initialState(1), { type: "pet-scale", percent: 50 }, { now: 2 });
  assert.equal(s.settings.petScale, .5);
  assert.deepEqual(scaledFloatSize(.5), { width: 110, height: 121 });
  assert.deepEqual(floatPosition({ x: 999, y: 999 }, { x: 0, y: 0, width: 500, height: 500 }, scaledFloatSize(.5)), { x: 390, y: 379 });
  const d = new IdleDirector({ random: () => .8 }); let p = { x: 380, y: 379 };
  for (let now = 0; now < 30_000; now += 100) {
    p = d.step({ now, position: p, area: { x: 0, y: 0, width: 500, height: 500 }, size: scaledFloatSize(.5), enabled: true }).position;
    assert.ok(p.x >= 0 && p.x <= 390); assert.equal(p.y, 379);
  }
  assert.throws(() => transition(s, { type: "pet-scale", percent: 49 }, { now: 3 }));
});
test("legacy LAN receipts remain finalizable after a skill upgrade without repeated payment", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-old-receipt-"));
  try {
    let s = await seedMatureCompanion(dir);
    s = transition(s, { type: "visit" }, { now: Date.now(), rng: () => 0, id: randomUUID });
    const peerId = "a".repeat(64), id = randomUUID();
    const mate = { ...s.pets[0], id: "mate", name: "同事" };
    s = lanTransition(s, { type: "_lan-reserve", id, peerId, petId: s.pets[0].id, mate }, { now: Date.now(), rng: () => 0, id: randomUUID });
    const tx = s.lanTransactions[id]; delete tx.aPet.skills; delete tx.bPet.skills;
    const a = structuredClone(tx.aPet), b = structuredClone(tx.bPet);
    const egg = { id: `lan-${id}`, genome: { ...a.genome }, talent: { id: "wave", level: 1 }, generation: 2, parents: [a, b] };
    const receipt = { id, fee: 240, ownerReward: 60, egg, committedAt: Date.now() };
    const command = { type: "_lan-finalize", id, peerId, receipt };
    s = lanTransition(s, command, { now: Date.now(), rng: () => 0, id: randomUUID });
    assert.equal(s.eggs.length, 1); assert.equal(s.balance, 0); assert.ok(s.eggs[0].skills);
    s = lanTransition(s, command, { now: Date.now(), rng: () => 0, id: randomUUID });
    assert.equal(s.eggs.length, 1); assert.equal(s.balance, 0);
    assert.throws(() => cleanPet({ ...mate, skills: { idle: "fake", social: "constellation" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
