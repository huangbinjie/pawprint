import { dayKey, housePets } from './economy.mjs';
import { recordInteraction, companionPersonality } from './personality.mjs';

export const GAMES = ['ball', 'wand', 'hide'];
export const ROUND_MS = 30_000;
export const DAILY_GROWTH = 3;
export const DECOR = ['bed', 'plant', 'ball', 'wand', 'box', 'trophy', 'cushion', 'curtain'];
export const training = pet => pet?.training || {version:1,bond:0,xp:{ball:0,wand:0,hide:0},best:{ball:0,wand:0,hide:0},rounds:0,daily:{date:'1970-01-01',count:0},last:null};
export function unlockedDecor(state) {
  const pets=state.pets.map(training), xp=game=>pets.reduce((n,p)=>n+p.xp[game],0);
  return ['bed','plant', ...(xp('ball')>=8?['ball']:[]), ...(xp('wand')>=8?['wand']:[]), ...(xp('hide')>=8?['box']:[]), ...(pets.some(p=>p.bond>=12)?['cushion']:[]), ...(xp('hide')>=40?['curtain']:[]), ...(pets.some(p=>Object.values(p.xp).some(x=>x>=40))?['trophy']:[])];
}
export function unlockedThemes(state) {
  const xp=state.pets.reduce((sum,p)=>sum+Object.values(training(p).xp).reduce((n,x)=>n+x,0),0);
  return ['sage', ...(xp>=80?['sunset']:[]), ...(xp>=200?['night']:[])];
}
function target(round,rng,now) {
  const previous=round.target?.spot;
  const spots=training(round.pet).xp.hide>=40?6:4;
  const pick=rng(spots-1);
  round.target={x:32+rng(54),y:22+rng(43),spot:previous===undefined?rng(spots):(pick>=previous?pick+1:pick),at:now};
}
export function playTransition(state,command,{now,rng,id}) {
  switch(command.type) {
    case 'play-start': {
      const pet=housePets(state).find(p=>p.id===command.petId);
      if(!pet || !GAMES.includes(command.game))throw new Error('Choose a companion and a game.');
      if(state.playRound && now<state.playRound.endsAt)throw new Error('Finish or leave the current round first.');
      if(state.playRound)playTransition(state,{type:'play-finish',roundId:state.playRound.id},{now,rng,id});
      const profile=training(pet), energy=companionPersonality(pet).scores.energy;
      const round={id:id(),petId:pet.id,game:command.game,startedAt:now,endsAt:now+ROUND_MS,hits:0,attempts:0,lastAttempt:0,responseMs:Math.round(850-energy*350),spots:profile.xp.hide>=40?6:4};
      const draft={...round,pet};target(draft,rng,now);delete draft.pet;
      state.playRound=draft;break;
    }
    case 'play-attempt': {
      const r=state.playRound;
      if(!r || r.id!==command.roundId || now>=r.endsAt)throw new Error('This round has ended.');
      const pet=housePets(state).find(p=>p.id===r.petId);
      if(!pet)throw new Error('Bring this companion home first.');
      if(now-r.lastAttempt<1000)throw new Error('Give your cat a moment to react.');
      r.lastAttempt=now;r.attempts++;
      const hit=r.game==='hide'?Number.isInteger(command.spot)&&command.spot===r.target.spot:
        Number.isFinite(command.x)&&Number.isFinite(command.y)&&Math.hypot(command.x-r.target.x,command.y-r.target.y)<=10&&(r.game!=='wand'||now-r.target.at>=r.responseMs);
      r.feedback={hit,at:now,x:r.target.x,y:r.target.y,spot:r.target.spot};
      if(hit){r.hits++;const draft={...r,pet};target(draft,rng,now);delete draft.pet;state.playRound=draft;}
      break;
    }
    case 'play-finish': {
      const r=state.playRound;
      if(!r || r.id!==command.roundId)throw new Error('This round has already been saved.');
      if(now<r.endsAt && command.abandon!==true)throw new Error('Keep playing until the round ends.');
      const pet=state.pets.find(p=>p.id===r.petId);
      if(pet){
        const p=structuredClone(training(pet)),date=dayKey(now),completed=command.abandon!==true && pet.residence!=='garden';
        if(p.daily.date!==date)p.daily={date,count:0};
        const reward=completed&&r.hits>=3&&p.daily.count<DAILY_GROWTH;
        const gained=reward?Math.min(12,5+r.hits):0;
        if(reward){p.daily.count++;p.xp[r.game]=Math.min(300,p.xp[r.game]+gained);p.bond=Math.min(100,p.bond+4);recordInteraction(pet,'play',now);}
        if(completed){p.rounds++;p.best[r.game]=Math.max(p.best[r.game],r.hits);}
        p.last={game:r.game,hits:r.hits,at:now,gained,reward,abandoned:!completed};pet.training=p;
      }
      state.playRound=null;break;
    }
    case 'room-place': {
      if(!unlockedDecor(state).includes(command.item) || !Number.isFinite(command.x)||!Number.isFinite(command.y)||command.x<5||command.x>95||command.y<25||command.y>88)throw new Error('Choose an unlocked decoration and a position inside the room.');
      state.room ||= {theme:'sage',items:[{item:'bed',x:24,y:72},{item:'plant',x:82,y:52}]};
      const items=state.room.items.filter(p=>p.item!==command.item);
      items.push({item:command.item,x:Math.round(command.x),y:Math.round(command.y)});state.room.items=items;break;
    }
    case 'room-remove':
      state.room ||= {theme:'sage',items:[{item:'bed',x:24,y:72},{item:'plant',x:82,y:52}]};
      if(state.room)state.room.items=state.room.items.filter(p=>p.item!==command.item);break;
    case 'room-theme':
      if(!unlockedThemes(state).includes(command.theme))throw new Error('This room theme is still locked.');
      state.room ||= {theme:'sage',items:[{item:'bed',x:24,y:72},{item:'plant',x:82,y:52}]};state.room.theme=command.theme;break;
  }
  return state;
}
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
export function validPlayState(state) {
  for(const pet of state.pets){const p=pet.training;if(p===undefined)continue;
    if(p.version!==1||!integer(p.bond,100)||!GAMES.every(g=>integer(p.xp?.[g],300)&&integer(p.best?.[g],30))||!integer(p.rounds,Number.MAX_SAFE_INTEGER)||!/^\d{4}-\d{2}-\d{2}$/.test(p.daily?.date||'')||!integer(p.daily.count,DAILY_GROWTH))return false;
    if(p.last && (!GAMES.includes(p.last.game)||!integer(p.last.hits,30)||!integer(p.last.gained,12)||!Number.isFinite(p.last.at)||typeof p.last.reward!=='boolean'||typeof p.last.abandoned!=='boolean'))return false;
  }
  const room=state.room;
  if(room && (!['sage','sunset','night'].includes(room.theme)||!Array.isArray(room.items)||room.items.length>DECOR.length||new Set(room.items.map(p=>p.item)).size!==room.items.length||room.items.some(p=>!DECOR.includes(p.item)||!Number.isInteger(p.x)||p.x<5||p.x>95||!Number.isInteger(p.y)||p.y<25||p.y>88)))return false;
  const r=state.playRound;
  return !r || (typeof r.id==='string'&&state.pets.some(p=>p.id===r.petId)&&GAMES.includes(r.game)&&Number.isFinite(r.startedAt)&&r.endsAt===r.startedAt+ROUND_MS&&integer(r.hits,30)&&integer(r.attempts,30)&&Number.isFinite(r.lastAttempt)&&Number.isFinite(r.target?.at)&&Number.isInteger(r.target.x)&&r.target.x>=32&&r.target.x<=85&&Number.isInteger(r.target.y)&&r.target.y>=22&&r.target.y<=64&&integer(r.target.spot,5)&&[4,6].includes(r.spots)&&r.target.spot<r.spots&&Number.isInteger(r.responseMs)&&r.responseMs>=500&&r.responseMs<=850);
}
