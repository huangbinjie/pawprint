import { writeFile } from "node:fs/promises";
import {
  GENE_KEYS,
  GENE_COUNT,
  LABELS,
  TRAITS,
  geneOdds,
  formatChance,
  CATALOG_VERSION,
} from "../core/genetics.mjs";
let text = `# 爪印基因图鉴与概率\n\n版本：${CATALOG_VERSION}。共 ${GENE_KEYS.length} 类、${GENE_COUNT} 个可获取基因。\n\n新领取的初遇蛋固定为奶油虎斑外观，隐藏基因仍随机；已领取的蛋与已有宠物不会重抽。以下概率仅针对探索蛋的随机基因池，不适用于固定初遇外观或配种。显现概率指外貌实际表现；携带概率包含显性和隐藏携带，两者不可相加。显示值经过四舍五入。\n\n基因在蛋生成时确定，孵化只揭晓；出生后不洗基因。配种时双方每组各传一个等位基因，当前没有突变，所以不会凭空产生父母都不携带的基因。\n\n稀有度以当前探索蛋显现率分级：普通 ≥15%；少见 5% 至 <15%；稀有 1% 至 <5%；珍稀 0.1% 至 <1%；传说 <0.1%。这不代表颜值、战斗力或市场价格。特定父母可以使某个初代罕见基因在后代中高概率出现。\n\n全身纯色的组合：纯色花纹 + 无白纹 + 喜欢的毛色。不同体型、脸型、眼型和神态决定气质，复杂花纹没有更高价值。\n`;
for (const key of GENE_KEYS) {
  text += `\n## ${LABELS[key]}\n\n| 基因 | 探索蛋显现概率 | 探索蛋携带概率 | 稀有度 |\n|---|---:|---:|---|\n`;
  TRAITS[key].forEach((g, i) => {
    const o = geneOdds(key, i);
    text += `| ${g.name} | ${formatChance(o.visible)} | ${formatChance(o.carried)} | ${o.rarity.name} |\n`;
  });
}
text +=
  "\n## 计算规则\n\n探索蛋每组独立抽两个等位基因，各等位基因有配置权重；初遇蛋固定表现位、随机携带位。若某等位基因的单次概率为 p，探索蛋显现概率就是 p，携带概率为 1−(1−p)²。繁育从双方各取一份，再各以 50% 概率决定谁占表现位，因此双方每个等位基因的显现贡献为 25%。旧宠物保留原有固定显性规则，不改变既有外貌。\n\n旧宠物保留原来的基因，新类别补齐中性默认值，不重新抽取。旧宠物的实际出生概率不能从当前池反推；图鉴只展示当前版本探索蛋随机池。\n";
await writeFile(new URL("../docs/GENES.md", import.meta.url), text);
