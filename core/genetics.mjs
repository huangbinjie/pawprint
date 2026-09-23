import { expandTraits } from "./genetics-extra.mjs";
// Append-only allele IDs: never reorder existing entries or reroll an existing genome.
export const CATALOG_VERSION = "founder-v4";
export const TRAITS = {
  coat: [
    { name: "奶油", weight: 8, color: "#E7CDA6", shade: "#B78860" },
    { name: "杏橘", weight: 14, color: "#DDA76B", shade: "#A6693E" },
    { name: "云灰", weight: 18, color: "#A7ADB9", shade: "#707886" },
    { name: "可可", weight: 9, color: "#9C7868", shade: "#624A43" },
    { name: "雪白", weight: 6, color: "#EEECE3", shade: "#B8B2A5" },
    { name: "墨黑", weight: 10, color: "#53545B", shade: "#30333B" },
    { name: "泥灰", weight: 16, color: "#969586", shade: "#686A5C" },
    { name: "砂褐", weight: 14, color: "#AE997B", shade: "#796C55" },
    { name: "银蓝", weight: 4, color: "#B6C8CE", shade: "#718C98" },
    { name: "烟紫", weight: 2, color: "#B5A5B8", shade: "#827087" },
    { name: "瓷白", weight: 1, color: "#F6F5F0", shade: "#D4D5CE" },
    { name: "乌金", weight: 1, color: "#373A38", shade: "#181F1C" },
    { name: "石灰", weight: 10, color: "#BAC0B1", shade: "#868D7C" },
    { name: "麦芽", weight: 4, color: "#D3B383", shade: "#A48A61" },
    { name: "深栗", weight: 1, color: "#685045", shade: "#47372E" },
  ],
  pattern: [
    { name: "纯色", weight: 40 },
    { name: "虎斑", weight: 22 },
    { name: "斑点", weight: 8 },
    { name: "双色", weight: 10 },
    { name: "碎杂斑", weight: 14 },
    { name: "背鞍", weight: 4 },
    { name: "细纹", weight: 2 },
    { name: "玳瑁", weight: 1 },
  ],
  eyes: [
    { name: "琥珀", weight: 25, color: "#B38438" },
    { name: "鼠尾草", weight: 18, color: "#6F946D" },
    { name: "湖蓝", weight: 12, color: "#729EB9" },
    { name: "葡萄", weight: 3, color: "#9B81AC" },
    { name: "褐瞳", weight: 28, color: "#76674B" },
    { name: "橄榄", weight: 10, color: "#868951" },
    { name: "银灰", weight: 3, color: "#A7B4B9" },
    { name: "冰蓝", weight: 1, color: "#AFE1E5" },
    { name: "金蓝异瞳", weight: 1, color: "#C5A55B", other: "#81BCCB" },
    { name: "橙铜", weight: 6, color: "#B77542" },
    { name: "海绿", weight: 1, color: "#69A99A" },
  ],
  eyeSize: [
    { name: "圆眼", weight: 12, scale: 1 },
    { name: "大眼", weight: 3, scale: 1.22 },
    { name: "眯眯眼", weight: 22, scale: 0.77 },
    { name: "豆豆眼", weight: 25, scale: 0.52 },
    { name: "细长眼", weight: 24, scale: 1, sx: 1.15, sy: 0.46 },
    { name: "凸圆眼", weight: 12, scale: 1.38 },
    { name: "凤眼", weight: 2, scale: 0.92, sx: 1.3, sy: 0.68 },
  ],
  ears: [
    { name: "立耳", weight: 30 },
    { name: "圆耳", weight: 12 },
    { name: "折耳", weight: 8 },
    { name: "宽耳", weight: 25 },
    { name: "高低耳", weight: 18 },
    { name: "大尖耳", weight: 5 },
    { name: "簇毛耳", weight: 2 },
  ],
  tail: [
    { name: "长尾", weight: 25 },
    { name: "卷尾", weight: 8 },
    { name: "短尾", weight: 25 },
    { name: "细尾", weight: 24 },
    { name: "扫帚尾", weight: 12 },
    { name: "钩尾", weight: 5 },
    { name: "团尾", weight: 1 },
  ],
  white: [
    { name: "白围脖", weight: 10 },
    { name: "白袜子", weight: 14 },
    { name: "无白纹", weight: 45 },
    { name: "小白领", weight: 12 },
    { name: "白鼻梁", weight: 8 },
    { name: "偏心白斑", weight: 10 },
    { name: "白面罩", weight: 1 },
  ],
  body: [
    { name: "均衡", weight: 12, sx: 1, sy: 1 },
    { name: "圆润", weight: 6, sx: 1.12, sy: 0.94 },
    { name: "清瘦", weight: 30, sx: 0.79, sy: 1.04 },
    { name: "敦实", weight: 24, sx: 1.16, sy: 0.88 },
    { name: "修长", weight: 18, sx: 0.89, sy: 1.1 },
    { name: "短腿", weight: 9, sx: 1.03, sy: 0.8 },
    { name: "大骨架", weight: 1, sx: 1.19, sy: 1.06 },
    { name: "健壮", weight: 8, sx: 1.08, sy: 1.03 },
    { name: "矮胖", weight: 2, sx: 1.13, sy: 0.83 },
  ],
  face: [
    { name: "圆脸", weight: 10, sx: 1, sy: 1 },
    { name: "普通脸", weight: 35, sx: 0.95, sy: 0.91 },
    { name: "窄脸", weight: 25, sx: 0.78, sy: 1.03 },
    { name: "方脸", weight: 15, sx: 1.04, sy: 0.94 },
    { name: "长脸", weight: 10, sx: 0.88, sy: 1.17 },
    { name: "腮帮脸", weight: 4, sx: 1.17, sy: 0.96 },
    { name: "三角脸", weight: 1, sx: 0.94, sy: 1.02 },
    { name: "扁脸", weight: 6, sx: 1.08, sy: 0.81 },
    { name: "小脸", weight: 1, sx: 0.86, sy: 0.86 },
  ],
  expression: [
    { name: "平静", weight: 30 },
    { name: "困倦", weight: 25 },
    { name: "认真", weight: 20 },
    { name: "不耐烦", weight: 12 },
    { name: "呆愣", weight: 8 },
    { name: "傲娇", weight: 4 },
    { name: "笑眯眯", weight: 1 },
  ],
  fur: [
    { name: "顺毛", weight: 40 },
    { name: "短绒", weight: 25 },
    { name: "蓬乱", weight: 22 },
    { name: "炸毛", weight: 8 },
    { name: "长毛", weight: 4 },
    { name: "丝滑", weight: 1 },
  ],
  eyeSpacing: [
    { name: "自然", weight: 30, dx: 0, dy: 0 },
    { name: "近眼", weight: 28, dx: -12, dy: 0 },
    { name: "宽眼", weight: 26, dx: 9, dy: 0 },
    { name: "高低眼", weight: 15, dx: 0, dy: 9 },
    { name: "对称宽眼", weight: 1, dx: 5, dy: 0 },
    { name: "高眼位", weight: 1, dx: 2, dy: 0, yOffset: -9 },
  ],
};
expandTraits(TRAITS);
export const LABELS = {
  pupil: "瞳孔",
  muzzle: "口吻",
  nose: "鼻形",
  patternScale: "花纹分布",
  coat: "毛色",
  pattern: "花纹",
  eyes: "瞳色",
  eyeSize: "眼型",
  ears: "耳形",
  tail: "尾形",
  white: "白纹",
  body: "体型",
  face: "脸型",
  expression: "神态",
  fur: "毛质",
  eyeSpacing: "眼位",
};
export const LEGACY_KEYS = [
  "coat",
  "pattern",
  "eyes",
  "eyeSize",
  "ears",
  "tail",
  "white",
];
// Append-only: existing allele IDs and all saved genomes stay unchanged.
TRAITS.ears.push({ name: "无耳", weight: 2, absent: true });
TRAITS.tail.push({ name: "无尾", weight: 50, absent: true });
export const GENE_KEYS = Object.keys(TRAITS);
export const GENE_COUNT = GENE_KEYS.reduce(
  (sum, k) => sum + TRAITS[k].length,
  0,
);
export const RARITIES = [
  { id: "common", name: "普通", min: 15, color: "#819077" },
  { id: "uncommon", name: "少见", min: 5, color: "#608C85" },
  { id: "rare", name: "稀有", min: 1, color: "#688AB2" },
  { id: "epic", name: "珍稀", min: 0.1, color: "#9A78AE" },
  { id: "legendary", name: "传说", min: 0, color: "#B59654" },
];
export function rarityFor(percent) {
  return RARITIES.find((r) => percent >= r.min - 1e-12);
}
export function geneOdds(key, index) {
  const values = TRAITS[key],
    total = values.reduce((sum, v) => sum + v.weight, 0);
  const allele = values[index].weight / total;
  const tail =
    values.slice(index + 1).reduce((sum, v) => sum + v.weight, 0) / total;
  const visible = allele * 100;
  return {
    allele: allele * 100,
    visible,
    carried: (1 - (1 - allele) ** 2) * 100,
    rarity: rarityFor(visible),
  };
}
export function formatChance(value) {
  return `${value.toFixed(value < 0.1 ? 4 : value < 1 ? 3 : 2).replace(/\.?0+$/, "")}%`;
}
export function withDefaults(genome) {
  return {
    ...genome,
    ...Object.fromEntries(GENE_KEYS.map((key) => [key, genome[key] ?? [0, 0]])),
  };
}
export function migrateGenetics(state) {
  if (state.geneticsVersion === 3) return state;
  const next = structuredClone(state);
  if (!Array.isArray(next.pets) || !Array.isArray(next.eggs)) return state;
  for (const resident of [...next.pets, ...next.eggs]) {
    for (const entity of [resident, ...(resident.parents || [])]) {
      if (
        !entity.genome ||
        !LEGACY_KEYS.every((key) => Array.isArray(entity.genome[key]))
      )
        throw new Error("Invalid legacy genome");
      entity.genome = withDefaults(entity.genome);
    }
  }
  next.geneticsVersion = 3;
  return next;
}
function weightedAllele(key, rng) {
  const values = TRAITS[key];
  let draw = rng(values.reduce((sum, v) => sum + v.weight, 0));
  for (let i = 0; i < values.length; i++) {
    draw -= values[i].weight;
    if (draw < 0) return i;
  }
  throw new Error("Invalid random source");
}
export function randomGenome(rng) {
  return {
    $schema: "expression-v3",
    ...Object.fromEntries(
      GENE_KEYS.map((key) => [
        key,
        [weightedAllele(key, rng), weightedAllele(key, rng)],
      ]),
    ),
  };
}
// Existing allele indices retain their dominance. No rarity-based power score.
export function phenotype(genome) {
  return Object.fromEntries(
    GENE_KEYS.map((key) => [
      key,
      genome.$schema === "expression-v3"
        ? (genome[key] ?? [0, 0])[0]
        : Math.min(...(genome[key] ?? [0, 0])),
    ]),
  );
}
export function inheritGenome(a, b, rng) {
  return {
    $schema: "expression-v3",
    ...Object.fromEntries(
      GENE_KEYS.map((key) => {
        const pair = [(a[key] ?? [0, 0])[rng(2)], (b[key] ?? [0, 0])[rng(2)]];
        if (rng(2)) pair.reverse();
        return [key, pair];
      }),
    ),
  };
}
export function inheritanceOptions(a, b, key) {
  const counts = new Map();
  for (const allele of [...(a[key] ?? [0, 0]), ...(b[key] ?? [0, 0])])
    counts.set(allele, (counts.get(allele) || 0) + 25);
  return [...counts].map(([value, percent]) => ({
    value,
    percent,
    name: TRAITS[key][value].name,
  }));
}
export function describe(genome) {
  const p = phenotype(genome);
  return `${TRAITS.coat[p.coat].name}${TRAITS.pattern[p.pattern].name} · ${TRAITS.eyes[p.eyes].name}眼`;
}
export function rarestTrait(genome) {
  const p = phenotype(genome);
  return GENE_KEYS.map((key) => ({
    key,
    name: TRAITS[key][p[key]].name,
    ...geneOdds(key, p[key]),
  })).sort((a, b) => a.visible - b.visible)[0];
}
export function previewGenome(key, index) {
  const base = Object.fromEntries(GENE_KEYS.map((k) => [k, [0, 0]]));
  base.white = [2, 2];
  if (key === "patternScale") base.pattern = [2, 2];
  base[key] = [index, index];
  return base;
}
function fixed(values, extra = {}) {
  return withDefaults({
    ...Object.fromEntries(LEGACY_KEYS.map((k, i) => [k, values[i]])),
    ...extra,
  });
}
export const PARTNERS = [
  {
    id: "npc-mochi",
    talent: { id: "stretch", level: 1 },
    name: "糯米",
    title: "干净白毛，性格有点冷",
    fee: 180,
    genome: fixed(
      [
        [4, 4],
        [0, 3],
        [2, 2],
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 2],
      ],
      {
        body: [4, 4],
        face: [2, 4],
        expression: [5, 5],
        fur: [5, 5],
        eyeSpacing: [0, 2],
      },
    ),
  },
  {
    id: "npc-sesame",
    talent: { id: "roll", level: 1 },
    name: "芝麻",
    title: "蓬乱杂斑，不太爱营业",
    fee: 220,
    genome: fixed(
      [
        [5, 6],
        [4, 4],
        [4, 5],
        [3, 4],
        [4, 4],
        [3, 4],
        [2, 5],
      ],
      {
        body: [2, 4],
        face: [4, 4],
        expression: [1, 3],
        fur: [2, 3],
        eyeSpacing: [3, 3],
      },
    ),
  },
  {
    id: "npc-maple",
    talent: { id: "dance", level: 1 },
    name: "枫糖",
    title: "敦实方脸，一本正经",
    fee: 180,
    genome: fixed(
      [
        [1, 1],
        [1, 6],
        [0, 2],
        [4, 4],
        [3, 5],
        [5, 5],
        [2, 2],
      ],
      {
        body: [3, 3],
        face: [3, 5],
        expression: [2, 3],
        fur: [1, 2],
        eyeSpacing: [1, 1],
      },
    ),
  },
];
