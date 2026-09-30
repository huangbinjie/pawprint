import { dayKey } from './economy.mjs';
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
function temperament(id, axis) {
  let hash = 2166136261;
  for (const c of `${id}|companion-v1|${axis}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return .3 + (hash % 1000) / 1000 * .3;
}
export function recordInteraction(pet, kind, now) {
  if (!['touch','play','chat'].includes(kind)) throw new Error('请选择有效的陪伴互动。');
  const date = dayKey(now), previous = pet.companion;
  if (previous?.daily?.date === date && previous.daily[kind] && now - previous.lastInteractionAt < 30000) return false;
  const profile = previous ? structuredClone(previous) : { version:1, counts:{touch:0,play:0,chat:0,night:0}, days:[], daily:{}, lastInteractionAt:0 };
  if (profile.daily.date !== date) profile.daily = {date};
  if (!profile.daily[kind]) { profile.counts[kind] = count(profile.counts[kind]) + 1; profile.daily[kind] = true; }
  const hour = new Date(now).getHours();
  if ((hour >= 22 || hour < 5) && !profile.daily.night) { profile.counts.night = count(profile.counts.night) + 1; profile.daily.night = true; }
  profile.days = [...new Set([...profile.days, date])].slice(-3660);
  profile.lastInteractionAt = now; pet.companion = profile;
  return true;
}
export function companionPersonality(pet) {
  const c = pet?.companion?.counts || {}, touch=count(c.touch),play=count(c.play),chat=count(c.chat),night=count(c.night);
  const days = new Set([...(pet?.activeDays || []), ...(pet?.companion?.days || [])]).size;
  const scores = {
    affection:clamp(temperament(pet?.id,'affection') + .3*touch/(touch+10) + .08*Math.min(days/30,1)),
    energy:clamp(temperament(pet?.id,'energy') + .3*play/(play+10)),
    curiosity:clamp(temperament(pet?.id,'curiosity') + .15*play/(play+12)),
    talkative:clamp(temperament(pet?.id,'talkative') + .4*chat/(chat+12)),
    nocturnal:clamp(temperament(pet?.id,'nocturnal') + .4*night/(night+8)),
  };
  const traits=[];
  if(scores.affection>=.68)traits.push('亲人');
  if(scores.energy>=.65)traits.push('活泼');else if(scores.energy<.4)traits.push('慢悠悠');
  if(scores.curiosity>=.61)traits.push('好奇');
  if(scores.talkative>=.65)traits.push('爱聊天');
  if(night>=3 && scores.nocturnal>=.65)traits.push('夜猫子');
  if(scores.affection<.42)traits.push('有点傲娇');
  if(!traits.length)traits.push('温和慢热');
  const stage=days<3?'初识':days<14?'熟悉起来':days<30?'默契伙伴':'老朋友';
  return {days,stage,traits,scores,interactionDays:{touch,play,chat},lastInteractionAt:pet?.companion?.lastInteractionAt || 0};
}
export function personalityDescription(pet) {
  const p=companionPersonality(pet);
  return `气质：${p.traits.join('、')}。关系阶段：${p.stage}。已记录 ${p.days} 个活跃日，摸摸 ${p.interactionDays.touch} 天、玩耍 ${p.interactionDays.play} 天、聊天 ${p.interactionDays.chat} 天。只有互动统计，没有聊天内容记忆，不要编造项目或过往聊天细节。根据主人主动互动慢慢形成；保持温柔，不因主人忙碌而抱怨或责怪，不催促熬夜。`;
}
export function companionLine(pet, language = 'zh', variation = 0) {
  const p = companionPersonality(pet), {scores,interactionDays:c}=p, en=language==='en';
  if (variation % 2 === 0) {
    if (scores.talkative>=.65 && c.chat>=3) return en ? `We've chatted on ${c.chat} days. I'd love to hear a little more today.` : `我们有 ${c.chat} 天聊过天啦，今天也想听你说两句。`;
    if (scores.energy>=.65 && c.play>=3) return en ? `We've played together on ${c.play} days. Fancy another little game?` : `你有 ${c.play} 天陪我玩啦，今天再玩一小会儿？`;
    if (scores.affection>=.68 && c.touch>=3) return en ? `You've petted me on ${c.touch} days. A little pet when you're free?` : `你有 ${c.touch} 天摸摸我啦，忙完了再摸摸？`;
    if (p.days>=3) {
      const end = scores.energy<.4 ? (en ? "I'll have a little nap beside you." : '今天想在你旁边打个小盹。') : scores.affection<.42 ? (en ? "Just passing by to check on you." : '我只是过来看看你。') : (en ? "I'm here with you today, too." : '今天也在这里陪你。');
      return en ? `${p.days} active days together. ${end}` : `已经一起度过 ${p.days} 个活跃日。${end}`;
    }
  }
  if(scores.talkative>=.65)return en?'Want a little break to play ball with me?':'要不要歇一小会儿，陪我玩个球？';
  if(scores.affection>=.68)return en?"I'm here. A little pet when you're free would be nice.":'我在这里。忙完了，可以摸摸我。';
  if(scores.energy<.4)return en?"I'll have a little nap here and keep you company.":'我先在这里打个小盹，陪着你。';
  if(scores.affection<.42)return en?"Just passing by. I wasn't missing you or anything.":'只是路过看看你，才没有想你呢。';
  return en?"Meow, I'm here with you.":'喵，我在这里陪你。';
}
export class CompanionInitiative {
  constructor({random=Math.random}={}){this.random=random;this.nextAt=null;this.lastAt=null;}
  step({now,enabled,blocked,pet,history,language='zh'}){
    const slept=this.lastAt!==null&&now-this.lastAt>2000;this.lastAt=now;
    const schedule=()=>{this.nextAt=now+20*60000+this.random()*10*60000;};
    if(!enabled||!pet){this.nextAt=null;return null;}
    if(this.nextAt===null)schedule();
    if(slept)this.nextAt=Math.max(this.nextAt,now+5*60000);
    const hour=new Date(now).getHours();
    // Temporary actions postpone delivery, not the entire interval.
    if(blocked||slept||hour>=22||hour<8)return null;
    const profile=companionPersonality(pet),date=dayKey(now);
    if(now<this.nextAt || now-profile.lastInteractionAt<15*60000 || (history?.date===date&&count(history.count)>=2) || now-(history?.lastAt||0)<45*60000)return null;
    this.nextAt=now+45*60000+this.random()*15*60000;
    return {petId:pet.id,text:companionLine(pet,language,history?.date===date?history.count:0),action:profile.scores.energy<.4?'doze':'observe'};
  }
}
export function validCompanionProfile(profile) {
  if (profile === undefined) return true;
  const kinds=['touch','play','chat','night'],date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
  return profile?.version===1 && kinds.every(kind=>Number.isSafeInteger(profile.counts?.[kind])&&profile.counts[kind]>=0) &&
    Array.isArray(profile.days)&&profile.days.length<=3660&&profile.days.every(date)&&new Set(profile.days).size===profile.days.length&&
    date(profile.daily?.date)&&kinds.every(kind=>profile.daily[kind]===undefined||typeof profile.daily[kind]==='boolean')&&Number.isFinite(profile.lastInteractionAt)&&profile.lastInteractionAt>=0;
}
