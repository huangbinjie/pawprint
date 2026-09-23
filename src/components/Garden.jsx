import React from "react";
import { Leaf, Heart, ArrowRight, Dna } from "lucide-react";
import Cat from "./Cat.jsx";
import { gardenPets, usedSlots, companionDays } from "../../core/economy.mjs";
import { describe } from "../i18n/metadata.js";
import RawText from "../i18n/RawText.jsx";
import { localeTag } from "../i18n/locale.js";
export default function Garden({
  state,
  working,
  now,
  onReturn,
  onGenes,
  onCollection,
}) {
  const pets = gardenPets(state),
    full = usedSlots(state) >= state.capacity;
  return (
    <div className="garden-page">
      <section className="card garden-intro">
        <div className="garden-emblem">
          <Leaf size={29} />
        </div>
        <div>
          <span className="eyebrow">A QUIET PLACE TO STAY</span>
          <h2>换个地方生活，陪伴还在。</h2>
          <p>
            名字、基因、血统与回忆都保留。这里不占小屋位置，休养时暂停成长和繁育。
          </p>
        </div>
        <span className="chip">{pets.length} 位伙伴在休息</span>
      </section>
      <div className="garden-rules">
        <span>
          <Heart size={14} />
          安置与接回都免费，不返还宠物币
        </span>
        <span>接回后延续成长与冷却，不重新抽取基因</span>
      </div>
      {full && pets.length > 0 && (
        <div className="notice">
          小屋已满（{usedSlots(state)}/{state.capacity}
          ）。先安置一位伙伴或扩建，就能接它回来。
        </div>
      )}
      {!pets.length ? (
        <div className="empty-state garden-empty">
          <Leaf size={48} strokeWidth={1.2} />
          <h2>后花园里，阳光正好</h2>
          <p>想让某位伙伴休息一阵子，可以从宠物图鉴安排它过来。</p>
          <button className="button secondary" onClick={onCollection}>
            去看看小屋里的伙伴 <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="collection-grid garden-grid">
          {pets.map((p) => (
            <article className="card pet-card garden-pet" key={p.id}>
              <div className="pet-card-art">
                <span className="chip">
                  <Leaf size={11} />
                  在后花园休息
                </span>
                <Cat
                  genome={p.genome}
                  label={`${p.name}，${describe(p.genome)}`}
                />
              </div>
              <div className="pet-card-info">
                <h3><RawText>{p.name}</RawText></h3>
                <p>{describe(p.genome)}</p>
                <div className="traits">
                  <span className="chip">第 {p.generation} 代</span>
                  <span className="chip">
                    已陪伴 {companionDays(p, now)} 个活跃日
                  </span>
                </div>
                <p className="garden-since">
                  {new Date(p.gardenSince).toLocaleDateString(localeTag())}{" "}
                  来到后花园
                </p>
                <div className="pet-card-actions">
                  <button className="text-button" onClick={() => onGenes(p)}>
                    <Dna size={14} />
                    基因与血统
                  </button>
                  <button
                    className="text-button"
                    disabled={working || full}
                    onClick={() => onReturn(p)}
                  >
                    接回小屋 <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
