import React from "react";
import { Music, Play, Sparkles, CheckCircle2 } from "lucide-react";
import { phenotype, TRAITS } from "../../core/genetics.mjs";
import Cat from "./Cat.jsx";
import { TALENTS, talentById, trainingCost } from "../../core/talents.mjs";
import { housePets, availableCoins } from "../../core/economy.mjs";
import { GIFT_SKILLS, IDLE_SKILLS, SOCIAL_SKILLS, petSkills, skillById, skillRarity } from "../../core/skills.mjs";
export default function TalentRoom({
  state,
  now,
  working,
  onPerform,
  onTrain,
  onSelect,
  onHome,
  onSkill,
  onNearby,
}) {
  const pets = housePets(state),
    pet = pets.find((p) => p.id === state.activePetId) || pets[0];
  const performing =
    pet &&
    state.performance?.petId === pet.id &&
    !state.performance.guestId &&
    now - state.performance.at < (state.performance.duration || 6000);
  const shownSkill = performing ? skillById(state.performance.skillId) : null;
  const skillDescription = s => s?.id === "chase" && pet && TRAITS.tail[phenotype(pet.genome).tail].absent ? "无尾伙伴会原地左右张望，不做追尾旋转。" : s?.description;
  const rarity = s => s.category === "gift" ? "基础" : skillRarity(s);
  const owns = s => !!pet && (s.category === "talent" ? pet.talent.id === s.id : s.category === "gift" || Object.values(petSkills(pet)).includes(s.id));
  const catalogs = [
    { name: "出生才艺池", note: "初代抽一项 · 繁育 70% 继承、30% 随机", pool: TALENTS.map(s => ({ ...s, category: "talent" })) },
    { name: "待机技能池", note: "玩球默认掌握；其余技能初代抽一项", pool: [...GIFT_SKILLS, ...IDLE_SKILLS] },
    { name: "社交技能池", note: "初代抽一项 · 繁育 70% 继承、30% 随机", pool: SOCIAL_SKILLS },
  ];
  return (
    <div>
      <section className="catalog-intro card">
        <div>
          <span className="eyebrow">A LITTLE SHOW, JUST FOR YOU</span>
          <h2>看看它会哪些小本领。</h2>
          <p>技能池会标记当前伙伴已拥有的技能。玩球默认掌握，其他本领在蛋生成时固定，升级和重启不重抽。</p>
        </div>
        <Music size={36} />
      </section>
      {pet ? (
        <section className="card talent-stage">
          <div className="talent-art">
            <Cat
              key={`${pet.id}-${state.performance?.at}`}
              genome={pet.genome}
              talentId={performing && !state.performance.skillId ? pet.talent.id : null}
              skillId={performing ? state.performance.skillId : null}
              talentLevel={pet.talent.level}
            />
          </div>
          <div>
            <select
              aria-label="选择才艺伙伴"
              value={pet.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {pets.map((p) => (
                <option key={p.id} value={p.id} translate="no">
                  {p.name}
                </option>
              ))}
            </select>
            <h2>{shownSkill?.name || talentById(pet.talent.id)?.name}</h2>
            <p>{skillDescription(shownSkill) || talentById(pet.talent.id)?.description}</p>
            <div className="traits">
              <span className="chip">
                {shownSkill ? `${rarity(shownSkill)} · 技能演示` : `Lv.${pet.talent.level} · ${["初学", "熟练", "拿手"][pet.talent.level - 1]}`}
              </span>
              <span className="chip">不改变外貌基因</span>
            </div>
            <div className="talent-actions">
              <button
                className="button primary"
                onClick={() => onPerform(pet.id)}
              >
                <Play size={15} />
                {shownSkill ? "表演出生才艺" : "表演一下"}
              </button>
              <button
                className="button secondary"
                disabled={
                  working ||
                  !!shownSkill ||
                  trainingCost(pet) === null ||
                  availableCoins(state) < trainingCost(pet)
                }
                onClick={() => onTrain(pet.id)}
              >
                <Sparkles size={15} />
                {trainingCost(pet) === null
                  ? "已经练到拿手"
                  : `练习课程 · ${trainingCost(pet)} 币`}
              </button>
            </div>
            <small>{shownSkill ? "技能演示免费；练习课程只提升原有出生才艺。" : "课程提升动作节奏与表现，不重抽才艺，也不额外产币。"}</small>
          </div>
        </section>
      ) : (
        <div className="empty-state">
          <Music size={35} />
          <h2>先接一位伙伴回小屋</h2>
          <button className="button primary" onClick={onHome}>
            打开小屋
          </button>
        </div>
      )}
      {catalogs.map(({ name, note, pool }) => <section key={name} className="skill-catalog">
        <div className="section-label"><h3>{name}</h3><span>{note}</span></div>
        <div className="talent-grid">{pool.map(s => <article className={`card skill-card ${owns(s) ? "skill-owned" : ""}`} data-skill-id={s.id} key={s.id}>
          <div className="skill-card-top"><span className="skill-rarity">{rarity(s)}</span>{owns(s) && <span className="skill-owned-badge"><CheckCircle2 size={13} />已拥有</span>}</div>
          <h3>{s.name}</h3><p>{skillDescription(s)}</p><strong>{s.category === "gift" ? "默认掌握 · 100%" : `初代概率 ${s.weight}%`}</strong>
          {owns(s) && <button className="button secondary small" onClick={() => s.category === "social" ? onNearby() : s.category === "talent" ? onPerform(pet.id) : onSkill(pet.id, s.id)}>
            {s.category === "social" ? "邀请伙伴来玩" : `试试${s.name}`}
          </button>}
        </article>)}</div>
      </section>)}
    </div>
  );
}
