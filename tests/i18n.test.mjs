import test from "node:test";
import assert from "node:assert/strict";
import { translateText, formatText, translateMenu } from "../core/i18n.mjs";
import { TRAITS, LABELS, RARITIES } from "../core/genetics.mjs";
import { SKILLS } from "../core/skills.mjs";
import { TALENTS } from "../core/talents.mjs";
import { initialState, transition } from "../core/game.mjs";
test("all gene, skill and rarity labels have English translations", () => {
  const texts = [...Object.values(LABELS), ...Object.values(TRAITS).flat().map(v => v.name), ...RARITIES.map(v => v.name), ...[...SKILLS,...TALENTS].flatMap(v => [v.name,v.description])];
  for (const s of texts) assert.ok(!/[\u3400-\u9fff]/.test(translateText(s, "en")), s);
});
test("dynamic messages localize metadata but preserve user names and callbacks", () => {
  assert.equal(translateText("领取 12 宠物币", "en"), "Claim 12 pet coins");
  assert.equal(translateText("周剩余：36%（旧快照）", "en"), "Weekly remaining: 36% (old snapshot)");
  assert.equal(translateText("爪印 · 我的小屋", "en"), "Pawprint · 我的小屋");
  assert.equal(formatText("让{0}去后花园生活？", ["我的小屋"], "en"), "Move 我的小屋 to the garden?");
  const click = () => {};
  const menu = translateMenu([{ label: "语言", submenu: [{ label: "打开小屋", click }] }], "en");
  assert.equal(menu[0].label, "Language"); assert.equal(menu[0].submenu[0].click, click);
  assert.equal(translateText("未知的用户文字", "en"), "未知的用户文字");
});
test("language preferences preserve every game field and only new English births get English default names", () => {
  let seq=0; const ctx = { now: Date.now(), rng: () => 0, id: () => `locale-${++seq}` };
  let before = transition(initialState(ctx.now), { type: "free-egg" }, ctx);
  const english = transition(before, { type: "language", value: "en" }, ctx);
  assert.deepEqual({ ...english, settings: before.settings }, before);
  const hatched = transition(english, { type: "hatch", eggId: english.eggs[0].id }, ctx);
  assert.equal(hatched.pets[0].name, "Pudding");
  const chinese = transition(hatched, { type: "language", value: "zh" }, ctx);
  assert.deepEqual(chinese.pets, hatched.pets);
  assert.throws(() => transition(before, { type: "language", value: "fr" }, ctx));
});
