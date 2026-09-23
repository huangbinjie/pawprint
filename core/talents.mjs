export const TALENTS = [
  {
    id: "wave",
    name: "挥爪打招呼",
    weight: 25,
    description: "认真举起小爪，向你打个招呼。",
  },
  {
    id: "stretch",
    name: "伸懒腰",
    weight: 25,
    description: "舒展开身体，把疲惫慢慢抖掉。",
  },
  {
    id: "roll",
    name: "打滚",
    weight: 20,
    description: "歪一歪，滚一滚，快乐就这么简单。",
  },
  {
    id: "dance",
    name: "扭扭舞",
    weight: 12,
    description: "跟着自己的节奏左右摇摆。",
  },
  {
    id: "spin",
    name: "转圈圈",
    weight: 8,
    description: "轻巧地转一圈，尾巴也跟着开心。",
  },
  {
    id: "salute",
    name: "小小敬礼",
    weight: 5,
    description: "站得笔直，向今天的努力致意。",
  },
  {
    id: "moonwalk",
    name: "月球步",
    weight: 3,
    description: "脚步向前，身体却悄悄滑向后。",
  },
  {
    id: "flip",
    name: "花式翻跟头",
    weight: 2,
    description: "一跃而起，献上一场小小的杂技。",
  },
];
export const talentById = (id) => TALENTS.find((t) => t.id === id);
export function drawTalent(rng, a, b) {
  let id;
  if (a && b && rng(100) < 70) id = [a.id, b.id][rng(2)];
  else {
    let n = rng(100);
    for (const t of TALENTS) {
      n -= t.weight;
      if (n < 0) {
        id = t.id;
        break;
      }
    }
  }
  return { id: id ?? "wave", level: 1 };
}
export function legacyTalent(pet) {
  let hash = 2166136261;
  for (const c of `${pet.id}|pawprint-talent-v1`)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  let n = hash % 100;
  for (const t of TALENTS) {
    n -= t.weight;
    if (n < 0) return { id: t.id, level: 1 };
  }
  return { id: "wave", level: 1 };
}
export function migrateTalents(state) {
  if (state.talentVersion === 1 && state.lanTransactions) return state;
  const next = structuredClone(state);
  next.talentVersion = 1;
  next.lanTransactions ??= {};
  for (const p of [...next.pets, ...next.eggs]) {
    p.talent ??= legacyTalent(p);
    for (const ancestor of p.parents ?? [])
      ancestor.talent ??= legacyTalent(ancestor);
  }
  return next;
}
export function talentOdds(a, b) {
  return TALENTS.map((t) => ({
    ...t,
    percent:
      !a || !b
        ? t.weight
        : t.weight * 0.3 + (a.id === t.id ? 35 : 0) + (b.id === t.id ? 35 : 0),
  }));
}
export const trainingCost = (pet) =>
  pet.talent.level >= 3 ? null : 120 * pet.talent.level;
