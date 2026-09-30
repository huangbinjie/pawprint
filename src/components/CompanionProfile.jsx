import React from 'react';
import { companionPersonality } from '../../core/personality.mjs';
import { t } from '../i18n/locale.js';
export default function CompanionProfile({pet,language}){
 const p=companionPersonality(pet),en=language==='en',c=p.interactionDays;
 return <div className="companion-profile" data-testid="companion-profile">
  <h4>{en?'Growing together':'和你一起长大'}</h4>
  <p>{en?`${p.days} active days together`:`一起度过 ${p.days} 个活跃日`} · {t(p.stage)}</p>
  <div className="traits">{p.traits.map(trait=><span className="chip" key={trait}>{t(trait)}</span>)}</div>
  <p className="muted small-copy">{en?`Petting ${c.touch} days · Play ${c.play} days · Chat ${c.chat} days`:`摸摸 ${c.touch} 天 · 玩耍 ${c.play} 天 · 聊天 ${c.chat} 天`}</p>
  <p className="muted small-copy">{en?'Temperament grows slowly through your interactions. Repeated clicks do not speed it up.':'先天气质与相处经历慢慢融合，反复点击不会加速成长。'}</p>
 </div>;
}
