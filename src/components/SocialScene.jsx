import React from "react";
import Cat from "./Cat.jsx";
import { skillById } from "../../core/skills.mjs";
export default function SocialScene({ scene, onEnd }) {
  return <div className={`social-scene social-${scene.skillId}`} aria-label={`联机技能：${skillById(scene.skillId)?.name}`}>
    <div className="social-pet social-host"><Cat genome={scene.host.genome} /></div>
    <div className="social-pet social-guest"><Cat genome={scene.guest.genome} /></div>
    {scene.skillId === "passball" && <div className="social-ball" role="img" aria-label="接力玩具球"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#dda366" stroke="#a77543" strokeWidth="2" /><path d="M4 12Q20 22 36 12M4 28Q20 18 36 28M20 2Q5 20 20 38M20 2Q35 20 20 38" fill="none" stroke="#fff4d6" strokeWidth="3" /></svg></div>}
    {scene.skillId === "constellation" && <div className="social-stars" aria-hidden="true">✦　♪　✧　♫　✦</div>}
    <button className="social-end" onClick={onEnd} aria-label="结束合演">×</button>
  </div>;
}
