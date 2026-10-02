import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition} from '../core/game.mjs';
import {workTarget} from '../core/work.mjs';
import {validateState} from '../core/store.mjs';
const ids=Array.from({length:8},(_,i)=>`01a0f1ea-4534-7651-b950-045a233fe63${i}`);
const now=Date.now();
test('pinning stabilizes the return target; recent list stays bounded with the pin retained',()=>{
 let state=initialState(now);const act=command=>state=transition(state,command,{now});act({type:'_work-observe',recent:[{threadId:ids[0],at:now,kind:'unknown'}]});act({type:'work-pin',threadId:ids[0]});act({type:'_work-observe',recent:ids.slice(1).map((threadId,i)=>({threadId,at:now+i+1,kind:'running'}))});assert.equal(state.work.recent.length,6);assert.equal(workTarget(state,{target:{threadId:ids[7]}}).threadId,ids[0]);act({type:'work-pin',threadId:null});assert.equal(workTarget(state,{target:{threadId:ids[7]}}).threadId,ids[7]);assert.equal(workTarget(state,null).threadId,ids[7]);validateState(state);
});
test('bookmarks and unread replies persist through later observations; reading is explicit',()=>{
 let state=initialState(now);const act=command=>state=transition(state,command,{now});act({type:'_work-observe',recent:[{threadId:ids[0],at:now,kind:'running'}]});act({type:'work-bookmark',threadId:ids[0],text:'Next: test login'});act({type:'_work-observe',recent:[{threadId:ids[0],at:now+1,kind:'completed'}],completed:{threadId:ids[0]}});assert.equal(state.work.recent[0].unread,true);act({type:'_work-observe',recent:[{threadId:ids[0],at:now+2,kind:'unknown'}]});assert.equal(state.work.recent[0].unread,true);assert.equal(state.work.recent[0].bookmark,'Next: test login');act({type:'work-read',threadId:ids[0]});assert.equal(state.work.recent[0].unread,false);validateState(state);
 assert.throws(()=>act({type:'work-bookmark',threadId:ids[0],text:'a\nb'}),/160/);assert.throws(()=>act({type:'work-pin',threadId:'codex://evil'}),/recent/);assert.throws(()=>act({type:'work-bookmark',threadId:ids[0],text:'x'.repeat(161)}),/160/);
});
test('reminders preserve explicit silence and do-not-disturb preferences',()=>{
 let state=initialState(now);state=transition(state,{type:'work-settings',reminder:'quiet',dnd:true},{now});assert.equal(state.settings.workReminder,'quiet');assert.equal(state.settings.workDnd,true);assert.throws(()=>transition(state,{type:'work-settings',reminder:'loud',dnd:false},{now}),/valid/);validateState(state);
});
