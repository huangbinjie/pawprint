import test from 'node:test';import assert from 'node:assert/strict';
import {readCodexModelList,modelSelection} from '../electron/codex-model-policy.mjs';

test('native model/list uses complete IDs, paginates and excludes hidden entries',async()=>{
 const calls=[];let closed=false;
 const list=await readCodexModelList({directory:'/unused',clientFactory:async()=>({connect:async()=>{},close:async()=>{closed=true;},request:async(method,params)=>{
  calls.push({method,params});return params.cursor==null?{data:[{model:'gpt-listed',hidden:false},{model:'hidden',hidden:true}],nextCursor:'page-2'}:{data:[{model:'vendor-listed',hidden:false}],nextCursor:null};
 }})});
 assert.deepEqual(list,{status:'available',models:['gpt-listed','vendor-listed']});assert.equal(closed,true);
 assert.deepEqual(calls.map(c=>[c.method,c.params.cursor,c.params.includeHidden]),[['model/list',null,false],['model/list','page-2',false]]);
 for(const [model,expected] of [['gpt-listed','picker'],['vendor-listed','picker'],['gpt-listed-alias','fixed'],['GPT-listed','fixed'],['mimo-v2.6-pro','fixed']])assert.equal(modelSelection({model},list),expected);
});
test('failed, malformed and incomplete lists do not classify a connection as fixed',async()=>{
 for(const result of [null,{data:[{id:'alias-only'}]},{data:[{model:'gpt-listed'}],nextCursor:'repeated'}]){
  let closed=false;
  const list=await readCodexModelList({directory:'/unused',clientFactory:async()=>({connect:async()=>{},close:async()=>{closed=true;},request:async()=>result})});
  assert.equal(list.status,'unavailable');assert.equal(modelSelection({model:'mimo-v2.6-pro'},list),'unknown');assert.equal(closed,true);
 }
 const list=await readCodexModelList({directory:'/unused',clientFactory:async()=>{throw Error('PRIVATE_FAILURE');}});assert.deepEqual(list,{status:'unavailable',models:[]});
});
test('an authoritative empty list differs from a missing list',()=>{
 assert.equal(modelSelection({model:'gpt-anything'},{status:'available',models:[]}),'fixed');
 assert.equal(modelSelection({model:'gpt-anything'},{status:'unavailable',models:[]}),'unknown');
});
