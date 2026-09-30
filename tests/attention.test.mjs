import test from 'node:test';import assert from 'node:assert/strict';
import {CursorAttention} from '../core/attention.mjs';
const input={position:{x:-900,y:200},size:{width:220,height:242},area:{x:-1440,y:25,width:1440,height:875},pointer:{x:-500,y:150},enabled:true};
function stepTo(a,end,options={}){let result;for(let now=0;now<=end;now+=200)result=a.step({now,...input,...options});return result;}
test('passive attention is occasional, direction-aware and returns to rest',()=>{
 const a=new CursorAttention({random:()=>0});assert.equal(stepTo(a,7800),null);
 const gaze=a.step({now:8000,...input});assert.ok(gaze.x>0);assert.ok(gaze.y<0);assert.deepEqual(input.position,{x:-900,y:200});
 const left=a.step({now:8200,...input,pointer:{x:-1400,y:700}});assert.equal(left.x,-1);assert.equal(left.y,1);
 for(let now=8400;now<=11000;now+=200)a.step({now,...input});assert.equal(a.step({now:11200,...input}),null);
 assert.equal(a.step({now:11400,...input}),null);
});
test('opt-out, interruptions and a pointer on another display suppress attention',()=>{
 for(const options of [{enabled:false},{paused:true},{pointer:{x:500,y:100}},{pointer:{x:NaN,y:200}}]){
  const a=new CursorAttention({random:()=>0});assert.equal(stepTo(a,60000,options),null);
 }
 const a=new CursorAttention({random:()=>0});stepTo(a,8000);assert.equal(a.step({now:8200,...input,paused:true}),null);assert.equal(a.step({now:8400,...input}),null);
});
test('sleep does not resume a stale glance or erase a previous cooldown',()=>{
 const a=new CursorAttention({random:()=>0});stepTo(a,8000);const earliest=a.nextAt;
 a.step({now:8200,...input,paused:true});assert.ok(a.nextAt>=earliest);
 assert.equal(a.step({now:3600000,...input}),null);assert.equal(a.step({now:3600200,...input}),null);
});
test('wiggling over the cat triggers once; passing, jitter and dragging do not',async()=>{
 const {CursorTease}=await import('../core/attention.mjs');const position={x:100,y:100},size={width:220,height:242},t=new CursorTease();
 const moves=[190,220,190,220,190];let hit=false;for(let i=0;i<moves.length;i++)hit=t.step({now:i*150,pointer:{x:moves[i],y:190},position,size})||hit;assert.equal(hit,true);
 assert.equal(t.step({now:750,pointer:{x:220,y:190},position,size}),false);
 for(const [points,blocked] of [[[170,180,190,200,210],false],[[200,201,200,201,200],false],[moves,true]]){const d=new CursorTease();for(let i=0;i<points.length;i++)assert.equal(d.step({now:i*150,pointer:{x:points[i],y:190},position,size,blocked}),false);}
});
