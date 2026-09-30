import test from 'node:test';import assert from 'node:assert/strict';
import {recordInteraction,companionPersonality,personalityDescription,CompanionInitiative} from '../core/personality.mjs';
import {initialState,transition} from '../core/game.mjs';
import {Store} from '../core/store.mjs';import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const DAY=86400000,at=new Date(2026,8,1,12).getTime();
function pet(id='test-cat'){return {id,activeDays:[],genome:{coat:[1,1]},skills:{idle:'box',social:'duet'},talent:{id:'wave',level:1}};}
test('temperament is stable per pet and changes through distinct interaction days',()=>{
 const a=pet('a'),b=pet('b');assert.deepEqual(companionPersonality(a),companionPersonality(a));assert.notDeepEqual(companionPersonality(a).scores,companionPersonality(b).scores);
 const before=structuredClone(a),base=companionPersonality(a);for(let day=0;day<20;day++)recordInteraction(a,'touch',at+day*DAY);
 const grown=companionPersonality(a);assert.ok(grown.scores.affection>base.scores.affection);assert.equal(grown.days,20);assert.equal(grown.stage,'默契伙伴');
 for(const field of ['genome','skills','talent'])assert.deepEqual(a[field],before[field]);
 assert.match(personalityDescription(a),/不催促熬夜/);
});
test('repeated actions cannot grind growth and each interaction kind counts at most once per day',()=>{
 const a=pet();for(let i=0;i<100;i++){recordInteraction(a,'touch',at+i*1000);recordInteraction(a,'play',at+i*1000);}
 assert.deepEqual(a.companion.counts,{touch:1,play:1,chat:0,night:0});assert.equal(a.companion.days.length,1);
 recordInteraction(a,'chat',at);recordInteraction(a,'chat',at+DAY);assert.equal(a.companion.counts.chat,2);assert.equal(a.companion.days.length,2);
 assert.throws(()=>recordInteraction(a,'automatic-motion',at));
});
test('night preference uses interaction times, not elapsed age or invented app history',()=>{
 const a=pet();const late=new Date(2026,8,1,23).getTime();recordInteraction(a,'touch',late);recordInteraction(a,'chat',late+1000);assert.equal(a.companion.counts.night,1);
 const empty=companionPersonality(pet());assert.equal(empty.days,0);assert.ok(!empty.traits.includes('夜猫子'));
});
test('interaction and proactive settings preserve the economy and original birth traits',()=>{
 let state=initialState(at);state.pets=[pet()];state.activePetId=state.pets[0].id;
 const next=transition(state,{type:'pet-interact',petId:'test-cat',kind:'play'},{now:at});
 for(const field of ['balance','ledger','eggs','capacity'])assert.deepEqual(next[field],state[field]);for(const field of ['genome','skills','talent'])assert.deepEqual(next.pets[0][field],state.pets[0][field]);
 const disabled=transition(next,{type:'companion-settings',enabled:false},{now:at});assert.equal(disabled.settings.companionProactive,false);
 assert.throws(()=>transition(disabled,{type:'_companion-note',petId:'test-cat'},{now:at}));assert.throws(()=>transition(state,{type:'pet-interact',petId:'visitor',kind:'touch'},{now:at}));
});
test('initiative is low frequency, capped across restarts and stops during work or recent interaction',()=>{
 const a=pet(),d=new CompanionInitiative({random:()=>0});let event;
 for(let now=at;now<=at+20*60000;now+=1000)event=d.step({now,pet:a,enabled:true,blocked:false});assert.ok(event);
 let state=initialState(at);state.pets=[a];state.activePetId=a.id;
 state=transition(state,{type:'_companion-note',petId:a.id},{now:at});assert.throws(()=>transition(state,{type:'_companion-note',petId:a.id},{now:at+1000}));
 state=transition(state,{type:'_companion-note',petId:a.id},{now:at+45*60000});assert.throws(()=>transition(state,{type:'_companion-note',petId:a.id},{now:at+90*60000}));
 const restarted=new CompanionInitiative({random:()=>0});for(let now=at;now<=at+3*3600000;now+=1000)assert.equal(restarted.step({now,pet:a,enabled:true,blocked:false,history:state.companionNotes}),null);
 const quiet=new CompanionInitiative({random:()=>0});for(let now=at;now<=at+3600000;now+=1000)assert.equal(quiet.step({now,pet:a,enabled:true,blocked:true}),null);
 recordInteraction(a,'touch',at+3600000);assert.equal(d.step({now:at+3600000,pet:a,enabled:true,blocked:false}),null);
});
test('disabling proactive behavior does not erase learned temperament',()=>{
 let s=initialState(at);s.pets=[pet()];s.activePetId='test-cat';s=transition(s,{type:'pet-interact',petId:'test-cat',kind:'touch'},{now:at});const before=companionPersonality(s.pets[0]);s=transition(s,{type:'companion-settings',enabled:false},{now:at});assert.deepEqual(companionPersonality(s.pets[0]),before);
});
test('learned profile and explicit opt-outs persist across store reloads',async()=>{
 const {seedMatureCompanion}=await import('./fixtures/game.mjs');
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-personality-store-'));let state=await seedMatureCompanion(dir,at);
 state=transition(state,{type:'pet-interact',petId:state.activePetId,kind:'touch'},{now:at});state=transition(state,{type:'companion-settings',enabled:false},{now:at});
 const store=new Store(dir);await store.load(at);await store.save(state);const again=new Store(dir);await again.load(at+DAY);
 assert.deepEqual(again.state.pets[0].companion,state.pets[0].companion);assert.equal(again.state.settings.companionProactive,false);
});
test('nighttime is quiet even for a night-owl temperament',()=>{
 const p=pet(),d=new CompanionInitiative({random:()=>0});const late=new Date(2026,8,1,23).getTime();
 for(let now=late;now<=late+3600000;now+=1000)assert.equal(d.step({now,enabled:true,blocked:false,pet:p}),null);
});
test('learned energy changes the idle action mix without granting an unowned skill',async()=>{
 const {IdleDirector}=await import('../core/idle.mjs');
 const run=energy=>{const d=new IdleDirector({random:()=>.55});let p={x:300,y:100},r;for(let now=0;now<=8100;now+=100){r=d.step({now,position:p,area:{x:0,y:0,width:1200,height:800},enabled:true,toys:true,skill:'box',talent:'wave',preferences:{energy,curiosity:0,talkative:0}});p=r.position;}return r.visual.mode;};
 assert.notEqual(run(0),run(1));assert.equal(run(1),'walk');
});
test('normal movement pauses a due greeting but does not restart its twenty-minute timer',()=>{
 const p=pet(),d=new CompanionInitiative({random:()=>0});let event;
 for(let now=at;now<=at+21*60000;now+=1000){const result=d.step({now,pet:p,enabled:true,blocked:(now-at)%30000>10000});if(result)event=result;}
 if(!event)event=d.step({now:at+21*60000+1000,pet:p,enabled:true,blocked:false});assert.ok(event);
});
test('proactive lines use recorded life statistics, vary with temperament and do not invent chat memories',async()=>{
 const {companionLine}=await import('../core/personality.mjs');const p=pet();for(let i=0;i<14;i++)recordInteraction(p,'touch',at+i*DAY);
 assert.match(companionLine(p),/14|摸摸/);assert.match(companionLine(p,'en'),/14|petted/);
 assert.notEqual(companionLine(p,'zh',0),companionLine(p,'zh',1));assert.match(personalityDescription(p),/没有聊天内容记忆/);
});
