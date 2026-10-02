import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition} from '../core/game.mjs';
import {validateState,Store} from '../core/store.mjs';
import {training,unlockedDecor,unlockedThemes} from '../core/play.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const start=Date.parse('2026-10-01T03:00:00Z');
function fixture(){let seq=0,state=initialState(start);const act=(c,now=start)=>state=transition(state,c,{now,rng:()=>0,id:()=>`play-${++seq}`});act({type:'free-egg'});act({type:'hatch',eggId:state.eggs[0].id});return {act,get state(){return state},petId:state.activePetId};}
function round(f,game,now=start,hits=3){f.act({type:'play-start',petId:f.petId,game},now);const id=f.state.playRound.id;for(let i=1;i<=hits;i++){const r=f.state.playRound;f.act({type:'play-attempt',roundId:id,...(game==='hide'?{spot:r.target.spot}:{x:r.target.x,y:r.target.y})},now+i*1500);}f.act({type:'play-finish',roundId:id},now+30_000);return id;}
test('all three games earn capped growth without changing genes, skills, wallet, or ledger',()=>{
 const f=fixture(),before=structuredClone(f.state);for(const [i,game] of ['ball','wand','hide'].entries())round(f,game,start+i*40_000);
 const p=training(f.state.pets[0]);assert.equal(p.bond,12);assert.deepEqual(p.xp,{ball:8,wand:8,hide:8});assert.equal(p.daily.count,3);assert.equal(p.rounds,3);assert.deepEqual(f.state.ledger,before.ledger);assert.equal(f.state.balance,before.balance);assert.deepEqual(f.state.pets[0].genome,before.pets[0].genome);assert.deepEqual(f.state.pets[0].skills,before.pets[0].skills);assert.deepEqual(unlockedDecor(f.state),['bed','plant','ball','wand','box','cushion']);validateState(f.state);
 round(f,'ball',start+130_000,5);assert.equal(training(f.state.pets[0]).xp.ball,8);assert.equal(training(f.state.pets[0]).best.ball,5);assert.equal(training(f.state.pets[0]).daily.count,3);
 round(f,'ball',start+86400000);assert.equal(training(f.state.pets[0]).xp.ball,16);assert.equal(training(f.state.pets[0]).daily.count,1);
});
test('missing catches, abandoned rounds, early completion, replay, and rapid attempts grant no rewards',()=>{
 const f=fixture();f.act({type:'play-start',petId:f.petId,game:'ball'});const id=f.state.playRound.id;
 assert.throws(()=>f.act({type:'play-start',petId:f.petId,game:'wand'}),/current round/);assert.throws(()=>f.act({type:'play-finish',roundId:id},start+5000),/until/);
 f.act({type:'play-attempt',roundId:id,x:0,y:0},start+1100);assert.equal(f.state.playRound.hits,0);assert.throws(()=>f.act({type:'play-attempt',roundId:id,x:32,y:22},start+1500),/moment/);
 f.act({type:'play-finish',roundId:id,abandon:true},start+8000);assert.equal(training(f.state.pets[0]).daily.count,0);assert.equal(training(f.state.pets[0]).bond,0);assert.throws(()=>f.act({type:'play-finish',roundId:id},start+31_000),/already/);
 round(f,'hide',start+40_000,2);assert.equal(training(f.state.pets[0]).daily.count,0);assert.equal(training(f.state.pets[0]).last.reward,false);assert.throws(()=>f.act({type:'play-attempt',roundId:id,x:32,y:22},start+80_000),/ended/);
});
test('wand needs reaction time; hide spots change and stay in range; progress unlocks room furniture and themes',()=>{
 const f=fixture();f.act({type:'play-start',petId:f.petId,game:'wand'});let r=f.state.playRound;f.act({type:'play-attempt',roundId:r.id,x:r.target.x,y:r.target.y},start+100);assert.equal(f.state.playRound.hits,0);
 r=f.state.playRound;f.act({type:'play-attempt',roundId:r.id,x:r.target.x,y:r.target.y},start+1500);assert.equal(f.state.playRound.hits,1);f.act({type:'play-finish',roundId:r.id,abandon:true},start+2000);
 for(let day=0;day<4;day++)for(let i=0;i<3;i++)round(f,'hide',start+day*86400000+i*40_000,8);
 assert.ok(training(f.state.pets[0]).xp.hide>=120);assert.ok(unlockedDecor(f.state).includes('curtain'));assert.ok(unlockedDecor(f.state).includes('trophy'));assert.ok(unlockedThemes(f.state).includes('sunset'));
 f.act({type:'play-start',petId:f.petId,game:'hide'},start+5*86400000);r=f.state.playRound;assert.equal(r.spots,6);const old=r.target.spot;f.act({type:'play-attempt',roundId:r.id,spot:old},start+5*86400000+2000);assert.notEqual(f.state.playRound.target.spot,old);validateState(f.state);
});
test('room decoration is bounded, unlock-gated, movable and removable; no payment is involved',()=>{
 const f=fixture();assert.throws(()=>f.act({type:'room-place',item:'trophy',x:50,y:50}),/unlocked/);assert.throws(()=>f.act({type:'room-place',item:'bed',x:Infinity,y:50}),/position/);
 f.act({type:'room-place',item:'bed',x:40.2,y:60.7});assert.deepEqual(f.state.room.items,[{item:'plant',x:82,y:52},{item:'bed',x:40,y:61}]);f.act({type:'room-place',item:'bed',x:70,y:65});assert.equal(f.state.room.items.length,2);f.act({type:'room-remove',item:'plant'});assert.equal(f.state.room.items.length,1);assert.throws(()=>f.act({type:'room-theme',theme:'night'}),/locked/);assert.equal(f.state.balance,0);validateState(f.state);
 const corrupted=structuredClone(f.state);corrupted.pets[0].training={...training(corrupted.pets[0]),bond:-1};assert.throws(()=>validateState(corrupted),/play/);
});
test('legacy saves and an interrupted game reload without data loss',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-play-save-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture(),store=new Store(directory);await store.load(start);await store.save(f.state);const legacy=new Store(directory);await legacy.load(start);assert.deepEqual(legacy.state,f.state);
 f.act({type:'play-start',petId:f.petId,game:'ball'});await store.save(f.state);const resume=new Store(directory);await resume.load(start+40000);assert.equal(resume.state.playRound.id,f.state.playRound.id);const next=transition(resume.state,{type:'play-finish',roundId:resume.state.playRound.id},{now:start+40000});validateState(next);assert.equal(next.pets[0].training.daily.count,0);assert.equal(next.playRound,null);
});
test('starting after a break settles an expired round exactly once before the next game',()=>{
 const f=fixture();f.act({type:'play-start',petId:f.petId,game:'ball'});const id=f.state.playRound.id;for(let i=1;i<=3;i++){const r=f.state.playRound;f.act({type:'play-attempt',roundId:id,x:r.target.x,y:r.target.y},start+i*1500);}
 f.act({type:'play-start',petId:f.petId,game:'hide'},start+60000);assert.equal(training(f.state.pets[0]).xp.ball,8);assert.equal(training(f.state.pets[0]).daily.count,1);assert.notEqual(f.state.playRound.id,id);assert.throws(()=>f.act({type:'play-finish',roundId:id},start+61000),/already/);validateState(f.state);
});
