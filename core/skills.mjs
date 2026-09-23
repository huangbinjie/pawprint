export const SKILL_VERSION = 1;
export const GIFT_SKILLS = [{ id: "ball", name: "拨弄玩具球", weight: 100, category: "gift", description: "每位伙伴都能得到的小礼物，轻轻拨球，看它滚回来。" }];
export const IDLE_SKILLS = [
  { id: "groom", name: "认真洗脸", weight: 45, category: "idle", description: "舔舔爪，揉揉脸，把毛毛整理好。" },
  { id: "chase", name: "追自己的尾巴", weight: 35, category: "idle", description: "发现身后的小尾巴，忍不住追着转。" },
  { id: "box", name: "纸箱躲猫猫", weight: 17, category: "idle", description: "躲进小纸箱，过一会儿再探出脑袋。" },
  { id: "starnap", name: "星光打盹", weight: 3, category: "idle", description: "眯着眼做个小梦，星星围着它轻轻转。" },
];
export const SOCIAL_SKILLS = [
  { id: "highfive", name: "碰爪问好", weight: 55, category: "social", description: "邀请来访伙伴一起举爪，碰个友好的掌。" },
  { id: "passball", name: "滚球接力", weight: 30, category: "social", description: "把球拨给朋友，再等它滚回来。" },
  { id: "duet", name: "双猫合拍", weight: 12, category: "social", description: "一左一右，跟着同一个节奏跳舞。" },
  { id: "constellation", name: "星光合奏", weight: 3, category: "social", description: "两位朋友合演一段星星与音符的小舞曲。" },
];
export const SKILLS = [...GIFT_SKILLS, ...IDLE_SKILLS, ...SOCIAL_SKILLS];
export const skillById = id => SKILLS.find(s => s.id === id);
export const skillRarity = s => s.category === "gift" ? "赠送" : s.weight >= 20 ? "基础" : s.weight >= 5 ? "少见" : "稀有";
const poolFor = category => category === "idle" ? IDLE_SKILLS : SOCIAL_SKILLS;
function draw(pool, rng, a, b) {
  if (a && b && rng(100) < 70) return rng(2) === 0 ? a : b;
  let n = rng(100);
  for (const s of pool) { n -= s.weight; if (n < 0) return s.id; }
  return pool[0].id;
}
export function drawSkills(rng, a, b) {
  return { idle: draw(IDLE_SKILLS, rng, a?.idle, b?.idle), social: draw(SOCIAL_SKILLS, rng, a?.social, b?.social) };
}
export function legacySkills(pet) {
  const result = {};
  for (const category of ["idle", "social"]) {
    let hash = 2166136261;
    for (const c of `${pet.id}|pawprint-skill-v1|${category}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    result[category] = draw(poolFor(category), () => hash % 100);
  }
  return result;
}
export const validSkills = value => !!value && IDLE_SKILLS.some(s => s.id === value.idle) && SOCIAL_SKILLS.some(s => s.id === value.social) && Object.keys(value).length === 2;
export const petSkills = pet => pet.skills ?? legacySkills(pet);
export const ownsSkill = (pet, id) => id === "ball" || Object.values(petSkills(pet)).includes(id);
export function skillOdds(category, a, b) {
  return poolFor(category).map(s => ({ ...s, percent: a && b ? s.weight * .3 + (a[category] === s.id ? 35 : 0) + (b[category] === s.id ? 35 : 0) : s.weight }));
}
export function migrateSkills(state) {
  if (state.skillVersion === SKILL_VERSION) return state;
  const next = structuredClone(state);
  next.skillVersion = SKILL_VERSION;
  for (const p of [...next.pets, ...next.eggs]) {
    p.skills ??= legacySkills(p);
    for (const parent of p.parents ?? []) parent.skills ??= legacySkills(parent);
  }
  return next;
}
export function socialCast(pets, visitors, request, now) {
  const host = pets.find(p => p.id === request.petId && p.residence !== "garden");
  const visit = visitors.find(v => v.id === request.visitId && v.expiresAt > now);
  if (!host || !visit) throw new Error("需要一位小屋伙伴和已经获准串门的访客。");
  if (!["host", "guest"].includes(request.leader)) throw new Error("请选择带领合演的伙伴。");
  const lead = request.leader === "host" ? host : visit.pet;
  const skillId = petSkills(lead).social;
  if (request.skillId !== skillId || skillById(skillId)?.category !== "social") throw new Error("带领者还没有这项社交技能。");
  const card = p => ({ id: p.id, name: p.name, genome: structuredClone(p.genome) });
  return { host: card(host), guest: card(visit.pet), skillId, visitId: visit.id, at: now };
}
