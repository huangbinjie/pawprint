import React from "react";
import { petSkills, skillOdds } from "../../core/skills.mjs";
import { formatChance } from "../../core/genetics.mjs";
export default function SkillOdds({ a, b }) {
  return <>{["idle", "social"].map(category => <div className="talent-probabilities" key={category}>
    <h4>后代{category === "idle" ? "待机" : "社交"}技能概率 · 每类抽一项</h4>
    <div>{skillOdds(category, petSkills(a), petSkills(b)).map(s => <span className="chip" key={s.id}>{s.name} {formatChance(s.percent)}</span>)}</div>
  </div>)}<p className="muted small-copy">玩球为赠送技能，获取率 100%；各类技能分别抽取，概率不跨类相加。</p></>;
}
