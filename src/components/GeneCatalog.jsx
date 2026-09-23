import React, { useState } from "react";
import { t, currentLanguage } from "../i18n/locale.js";
import { Dna, Info, ArrowUpRight, Search } from "lucide-react";
import Cat from "./Cat.jsx";
import {
  TRAITS,
  LABELS,
  GENE_KEYS,
  GENE_COUNT,
  RARITIES,
  geneOdds,
  formatChance,
  previewGenome,
  PARTNERS,
} from "../../core/genetics.mjs";
export function RarityBadge({ rarity }) {
  return (
    <span className="rarity-badge" style={{ "--rarity": rarity.color }}>
      <i />
      {rarity.name}
    </span>
  );
}
export default function GeneCatalog({ onBreed }) {
  const [showLooks, setShowLooks] = useState(false);
  const examples = [
    {
      name: "圆润奶油",
      description: "大眼、圆脸、圆润体型",
      genome: {
        ...previewGenome("coat", 0),
        eyeSize: [1, 1],
        body: [1, 1],
        ears: [1, 1],
      },
    },
    {
      name: "日常砂褐",
      description: "普通脸、细长眼、短绒毛",
      genome: {
        ...previewGenome("coat", 7),
        face: [1, 1],
        eyeSize: [4, 4],
        fur: [1, 1],
        expression: [2, 2],
        body: [3, 3],
      },
    },
    {
      name: "蓬乱清瘦",
      description: "豆豆眼、长脸、高低耳、乱毛",
      genome: PARTNERS[1].genome,
    },
    {
      name: "清冷单色",
      description: "乌金纯色、无白纹、窄脸",
      genome: {
        ...previewGenome("coat", 11),
        face: [2, 2],
        body: [4, 4],
        eyeSize: [2, 2],
        eyes: [7, 7],
        expression: [5, 5],
      },
    },
  ];
  const [category, setCategory] = useState("coat"),
    [tier, setTier] = useState("all"),
    [query, setQuery] = useState("");
  const options = TRAITS[category].map((gene, index) => ({
    ...gene,
    index,
    ...geneOdds(category, index),
  }));
  const visible = options.filter(
    (g) => (tier === "all" || g.rarity.id === tier) && [g.name, t(g.name)].some(name => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
  );
  return (
    <div className="catalog">
      <section className="catalog-intro card">
        <div>
          <span className="eyebrow">BORN DIFFERENT</span>
          <h2>稀有不等于漂亮，普通也有性格。</h2>
          <p>纯色、细眼、长脸或一身乱毛，都可以成为你喜欢的那一种。</p>
          <button
            className="text-button"
            onClick={() => setShowLooks(!showLooks)}
          >
            {showLooks ? "收起组合预览" : "看看组合效果"}{" "}
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="catalog-count">
          <strong>{GENE_COUNT}</strong>
          <span>可获取基因 · {GENE_KEYS.length} 类</span>
        </div>
      </section>
      {showLooks && (
        <section className="combo-examples">
          <div className="combo-grid">
            {examples.map((example) => (
              <article className="card combo-card" key={example.name}>
                <Cat genome={example.genome} />
                <h3>{example.name}</h3>
                <p>{example.description}</p>
              </article>
            ))}
          </div>
          <p className="catalog-hint">
            组合示意：展示多种基因叠加后的差异，不是可直接领取的宠物，也没有整体颜值分。
          </p>
        </section>
      )}
      <div className="catalog-rules">
        <div>
          <Dna size={17} />
          <p>
            <strong>只在出生前确定</strong>
            初遇蛋与探索蛋从同一基因池抽取；配种蛋继承父母。孵化后不洗基因，当前没有外貌基因突变。新蛋随机选择表现位，避免总由低编号特征占优。
          </p>
        </div>
        <div>
          <Info size={17} />
          <p>
            <strong>以下概率仅适用于初代蛋</strong>
            “显现”是出生时看得见；“携带”包含显性及隐藏基因，二者不能相加。繁育请查看配对的条件概率。
          </p>
        </div>
      </div>
      <div className="catalog-categories" role="tablist" aria-label="基因类别">
        {GENE_KEYS.map((key) => (
          <button
            role="tab"
            aria-selected={category === key}
            key={key}
            onClick={() => {
              setCategory(key);
              setTier("all");
              setQuery("");
            }}
          >
            {LABELS[key]}
            <span>{TRAITS[key].length}</span>
          </button>
        ))}
      </div>
      <div className="catalog-filters">
        <div>
          <button
            className={tier === "all" ? "selected" : ""}
            onClick={() => setTier("all")}
          >
            全部稀有度
          </button>
          {RARITIES.map((r) => (
            <button
              className={tier === r.id ? "selected" : ""}
              key={r.id}
              onClick={() => setTier(r.id)}
            >
              <i style={{ background: r.color }} />
              {r.name}
            </button>
          ))}
        </div>
        <label className="gene-search">
          <Search size={14} />
          <input
            aria-label="搜索当前类别基因"
            placeholder="搜索当前类别"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <p className="catalog-hint">
        {category === "pattern" || category === "white"
          ? "想要全身纯色：组合「纯色」花纹与「无白纹」，再选喜欢的毛色。"
          : "预览使用统一底样，只替换当前特征；不同基因组合会改变最终外貌。"}
      </p>
      <div className="gene-cards">
        {visible.map((g) => (
          <article
            className="card gene-option"
            key={`${category}-${g.index}`}
            data-gene-id={`${category}:${g.index}`}
          >
            <div className="gene-option-art">
              <RarityBadge rarity={g.rarity} />
              <Cat
                genome={previewGenome(category, g.index)}
                label={`${LABELS[category]}：${g.name}的外观预览`}
              />
            </div>
            <div className="gene-option-info">
              <h3>{g.name}</h3>
              <div className="gene-prob">
                <span>初代出生显现</span>
                <strong>{formatChance(g.visible)}</strong>
              </div>
              <div className="gene-prob muted">
                <span>初代携带概率</span>
                <span>{formatChance(g.carried)}</span>
              </div>
              <p className="gene-source">
                来源：初遇蛋 / 探索蛋
                {PARTNERS.filter((p) => p.genome[category].includes(g.index))
                  .length > 0 && (
                  <>
                    <br />
                    系统伙伴携带：
                    {PARTNERS.filter((p) =>
                      p.genome[category].includes(g.index),
                    )
                      .map((p) => t(p.name))
                      .join(currentLanguage() === "en" ? ", " : "、")}
                  </>
                )}
              </p>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="catalog-empty">
          这个类别没有符合筛选的基因。可以切换稀有度或清空搜索。
        </div>
      )}
      <section className="card rarity-rules">
        <div>
          <h3>稀有度怎么定义？</h3>
          <p>
            按当前初代池的显现概率分级，不按颜色多少、好看程度或战斗能力打分。
          </p>
        </div>
        <div className="rarity-thresholds">
          {RARITIES.map((r, i) => (
            <div key={r.id}>
              <RarityBadge rarity={r} />
              <span>
                {i === 0
                  ? "≥ 15%"
                  : i === 4
                    ? "< 0.1%"
                    : `${r.min}% – < ${RARITIES[i - 1].min}%`}
              </span>
            </div>
          ))}
        </div>
        <div className="rarity-bottom">
          <p>
            稀有特征通过特定父母繁育，可能更容易出现。图鉴稀有度不代表市场价格，也不代表每次配种的概率。
          </p>
          <button className="text-button" onClick={onBreed}>
            查看配对概率 <ArrowUpRight size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
