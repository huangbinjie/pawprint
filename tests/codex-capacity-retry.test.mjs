import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexCapacityRetry,retryCapacityTurn,CAPACITY_RETRY_DELAY} from '../electron/codex-capacity-retry.mjs';
import {CodexActivity} from '../electron/activity.mjs';
import {initialState,transition} from '../core/game.mjs';
import {validateState} from '../core/store.mjs';

const threadId='01a0f1ea-4534-7651-b950-045a233fe631',at=Date.parse('2026-10-27T03:00:00Z');
const start=(turnId='turn',trigger)=>({threadId,turnId,at,type:'task_started',trigger});
const fail=(turnId='turn',errorCode='server_overloaded')=>({threadId,turnId,at,type:'task_complete',failed:true,errorCode});

test('overloads retry immediately five times per round, wait exactly 30 seconds between rounds, and stop after fifteen retries',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});const calls=[];
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async e=>{calls.push(e);return {status:'retried'};}});t.after(()=>retry.close());
  retry.configure({enabled:true,directory:'/client'});
  for(let n=0;n<=15;n++){
    const error={...fail('turn-'+n),at:Date.now()};
    retry.consume(start('turn-'+n,n?'capacity_retry_automatic':undefined));retry.consume(error);retry.consume(error);
    const delay=n>0&&n%5===0?30_000:0;
    assert.deepEqual(retry.snapshot().scheduled,n<15?[{threadId,turnId:'turn-'+n,retryAt:error.at+delay,attempt:n%5+1,maxAttempts:5,round:Math.floor(n/5)+1,maxRounds:3}]:[]);
    if(n===15){t.mock.timers.tick(120_000);assert.equal(calls.length,15);break;}
    if(delay){t.mock.timers.tick(delay-1);assert.equal(calls.length,n);t.mock.timers.tick(1);}else t.mock.timers.tick(0);
    await Promise.resolve();assert.equal(calls.length,n+1);
    assert.equal(retry.snapshot().lastAttempt.round,Math.floor(n/5)+1);assert.equal(retry.snapshot().lastAttempt.attempt,n%5+1);
  }
  assert.equal(CAPACITY_RETRY_DELAY,30_000);assert.equal(retry.snapshot().status,'exhausted');
  retry.consume(start('manual','capacity_retry_manual'));retry.consume({...fail('manual'),at:Date.now()});t.mock.timers.tick(0);await Promise.resolve();
  assert.equal(calls.length,16);assert.equal(retry.snapshot().lastAttempt.round,1);assert.equal(retry.snapshot().lastAttempt.attempt,1);
});

test('manual continuation, stop, disabling and other errors do not trigger retries',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});let calls=0;
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async()=>{calls++;return {status:'retried'};}});t.after(()=>retry.close());
  retry.configure({enabled:true,directory:'/client'});
  retry.consume(start());retry.consume(fail());retry.consume(start('manual'));
  assert.deepEqual(retry.snapshot().scheduled,[]);
  t.mock.timers.tick(30_000);assert.equal(calls,0);
  retry.consume(fail('manual'));retry.consume({...fail('manual'),type:'turn_aborted'});
  t.mock.timers.tick(30_000);assert.equal(calls,0);
  retry.consume(start('other'));retry.consume(fail('other','usage_limit_reached'));
  t.mock.timers.tick(30_000);assert.equal(calls,0);
  retry.consume(start('off'));retry.consume(fail('off'));retry.configure({enabled:false,directory:'/client'});
  t.mock.timers.tick(30_000);assert.equal(calls,0);
});

test('each chat has its own round cooldown and dispatch removes only its countdown',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async()=>({status:'retried'})});t.after(()=>retry.close());
  retry.configure({enabled:true,directory:'/client'});
  const exhaustRound=async id=>{
    for(let n=0;n<5;n++){
      retry.consume({...start(id+n,n?'capacity_retry_automatic':undefined),threadId:id});retry.consume({...fail(id+n),threadId:id,at:Date.now()});t.mock.timers.tick(0);await Promise.resolve();
    }
    retry.consume({...start(id+5,'capacity_retry_automatic'),threadId:id});retry.consume({...fail(id+5),threadId:id,at:Date.now()});
  };
  await exhaustRound(threadId);t.mock.timers.tick(4000);const other='01a0f5f7-5a51-7483-9fe6-9e028bc08226';await exhaustRound(other);
  assert.deepEqual(retry.snapshot().scheduled.map(e=>[e.threadId,e.retryAt]),[[threadId,at+30_000],[other,at+34_000]]);
  t.mock.timers.tick(26_000);await Promise.resolve();assert.deepEqual(retry.snapshot().scheduled.map(e=>e.threadId),[other]);
  retry.consume({...start('manual'),threadId:other});assert.equal(retry.snapshot().pending,0);
});

test('polling delay does not extend the round cooldown',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at+2000});let calls=0;
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async()=>{calls++;return {status:'retried'};}});t.after(()=>retry.close());
  retry.configure({enabled:true,directory:'/client'});
  for(let n=0;n<5;n++){retry.consume(start('turn'+n,n?'capacity_retry_automatic':undefined));retry.consume(fail('turn'+n));t.mock.timers.tick(0);await Promise.resolve();}
  retry.consume(start('turn5','capacity_retry_automatic'));retry.consume(fail('turn5'));
  assert.equal(retry.snapshot().scheduled[0].retryAt,at+30_000);
  t.mock.timers.tick(27_999);assert.equal(calls,5);t.mock.timers.tick(1);await Promise.resolve();assert.equal(calls,6);
});

test('request acceptance, actual start and completion are separate observable outcomes',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async()=>({status:'retried'})});t.after(()=>retry.close());
  retry.configure({enabled:true,directory:'/client'});retry.consume(start());retry.consume(fail());t.mock.timers.tick(0);await Promise.resolve();
  assert.equal(retry.snapshot().lastAttempt.status,'requested');
  retry.consume(start('automatic','capacity_retry_automatic'));assert.equal(retry.snapshot().lastAttempt.status,'started');
  retry.consume({threadId,turnId:'automatic',at:Date.now(),type:'task_complete',failed:false});assert.equal(retry.snapshot().lastAttempt.status,'completed');
});

test('an already-started automatic retry is counted and failures without an error code are not success',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});
  const retry=new CodexCapacityRetry({platform:'darwin'});t.after(()=>retry.close());retry.configure({enabled:true,directory:'/client'});
  retry.consume(start('resumed','capacity_retry_automatic'));assert.equal(retry.snapshot().lastAttempt.attempt,1);
  retry.consume(fail('resumed'));assert.equal(retry.snapshot().scheduled[0].attempt,2);
  retry.consume(start('second','capacity_retry_automatic'));retry.consume({...fail('second'),errorCode:undefined});assert.equal(retry.snapshot().lastAttempt.status,'failed');
});

test('session reading emits only new root lifecycle metadata without retaining error text',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paw-capacity-events-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'sessions'));const file=path.join(directory,'sessions','root.jsonl');
  const row=(payload)=>JSON.stringify({type:'event_msg',timestamp:new Date(at).toISOString(),payload})+'\n';
  await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:threadId}})+'\n'+row({type:'task_started',turn_id:'old'})+row({type:'task_complete',turn_id:'old',error:{codex_error_info:'server_overloaded'}}));
  const events=[],activity=new CodexActivity({now:()=>at,onChange:()=>{},onTurn:e=>events.push(e)});t.after(()=>activity.close());
  await activity.configure({directory,enabled:true,topics:false});assert.equal(events.length,0);
  await appendFile(file,row({type:'task_started',turn_id:'new',turn_attribution:{turn_trigger:'capacity_retry_automatic'}})+row({type:'task_complete',turn_id:'new',error:{codex_error_info:'server_overloaded',message:'PRIVATE_ERROR'}}));
  await activity.poll();assert.deepEqual(events.map(e=>[e.type,e.errorCode]),[['task_started',undefined],['task_complete','server_overloaded']]);assert.equal(events[0].trigger,'capacity_retry_automatic');assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  await activity.poll();assert.equal(events.length,2);
});
test('startup recovery preserves a recent high-demand failure for retry',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paw-capacity-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'sessions'));const file=path.join(directory,'sessions','root.jsonl');
  const row=(payload,when)=>JSON.stringify({type:'event_msg',timestamp:new Date(when).toISOString(),payload})+'\n',when=Date.now()-1000;
  await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:threadId}})+'\n'+row({type:'task_started',turn_id:'old'},when)+row({type:'task_complete',turn_id:'old',error:{codex_error_info:'internal_server_error',message:'We’re currently experiencing high demand, which may cause temporary errors.'}},when));
  const events=[],activity=new CodexActivity({now:Date.now,onChange:()=>{},onTurn:e=>events.push(e)});t.after(()=>activity.close());
  await activity.configure({directory,enabled:true,topics:false});
  assert.deepEqual(events.map(e=>[e.type,e.errorCode]),[['task_started',undefined],['task_complete','server_overloaded']]);
});

async function ipcFixture(t,{status='systemError',currentTurn='turn',error='serverOverloaded',errorMessage,pendingRequests=[]}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'paw-capacity-ipc-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const socketPath=process.platform==='win32'?`\\\\.\\pipe\\paw-capacity-${process.pid}-${Math.random()}`:path.join(directory,'ipc.sock');
  const seen=[],sockets=new Set();
  const frame=value=>{const b=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);return Buffer.concat([h,b]);};
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);
    const send=m=>{const bytes=frame(m);socket.write(bytes.subarray(0,2));socket.write(bytes.subarray(2));};
    socket.on('data',bytes=>{
      buffer=Buffer.concat([buffer,bytes]);while(buffer.length>=4){
        const n=buffer.readUInt32LE(0);if(buffer.length<n+4)return;const m=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);seen.push(m);
        if(m.type==='request')send({type:'response',method:m.method,requestId:m.requestId,resultType:'success',handledByClientId:'owner',result:m.method==='initialize'?{clientId:'self'}:{}});
        if(m.method==='thread-stream-following-changed'){
          const state={id:threadId,requests:pendingRequests,threadRuntimeStatus:{type:status},turnHistory:{kind:'canonical',history:{islands:[{entries:[{value:'latest'}]}],entitiesByKey:{latest:{turnId:currentTurn,status:'failed',error:{codexErrorInfo:error,...(errorMessage?{message:errorMessage}:{})}}}}}};
          const message={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',targetClientIds:['self'],params:{hostId:'local',conversationId:threadId,change:{type:'snapshot',conversationState:state}}};
          send({...message,sourceClientId:'unrelated-client'});send(message);
        }
      }
    });
  });
  await new Promise(resolve=>server.listen(socketPath,resolve));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
  return {directory,socketPath,seen};
}

test('a real desktop systemError snapshot can retry with empty input and no model or permission overrides',async t=>{
  const f=await ipcFixture(t),controller=new AbortController();
  const result=await retryCapacityTurn({...f,threadId,turnId:'turn',signal:controller.signal});assert.equal(result.status,'retried');
  const request=f.seen.find(m=>m.method==='thread-follower-start-turn');
  assert.equal(request.targetClientId,'owner');assert.equal(request.version,2);
  assert.deepEqual(request.params,{conversationId:threadId,turnStart:{request:{threadId,input:[],turnTrigger:'capacity_retry_automatic'}}});
  assert.deepEqual(f.seen.filter(m=>m.type==='request').map(m=>m.method),['initialize','thread-owner-discovery','thread-follower-start-turn']);
});
test('high-demand internal server errors retry, while generic internal errors stay skipped',async t=>{
  const demand=await ipcFixture(t,{error:'internalServerError',errorMessage:'We’re currently experiencing high demand, which may cause temporary errors.'});
  assert.equal((await retryCapacityTurn({...demand,threadId,turnId:'turn',signal:new AbortController().signal})).status,'retried');
  const generic=await ipcFixture(t,{error:'internalServerError',errorMessage:'backend failed'});
  assert.equal((await retryCapacityTurn({...generic,threadId,turnId:'turn',signal:new AbortController().signal})).status,'skipped');
});

for(const [name,state] of [['active chat',{status:'active'}],['manual continuation',{currentTurn:'new-turn'}],['other failure',{error:'usageLimitExceeded'}],['pending approval',{pendingRequests:[{id:1}]}]])test(`native retry skips ${name}`,async t=>{
  const f=await ipcFixture(t,state),result=await retryCapacityTurn({...f,threadId,turnId:'turn',signal:new AbortController().signal});
  assert.equal(result.status,'skipped');assert.ok(!f.seen.some(m=>m.method==='thread-follower-start-turn'));
});

test('automatic retry defaults on and can be disabled with a validated saved setting',()=>{
  const state=initialState(at);assert.equal(state.settings.capacityRetryEnabled,true);
  const next=transition(state,{type:'capacity-retry',enabled:false},{now:at});validateState(next);assert.equal(next.settings.capacityRetryEnabled,false);
  assert.throws(()=>transition(state,{type:'capacity-retry',enabled:'yes'},{now:at}));
  assert.throws(()=>validateState({...state,settings:{...state.settings,capacityRetryEnabled:'yes'}}));
});


test('a user retry cancels the round cooldown and restores all three rounds',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:at});let calls=0;
  const retry=new CodexCapacityRetry({platform:'darwin',retry:async()=>{calls++;return {status:'retried'};}});t.after(()=>retry.close());retry.configure({enabled:true,directory:'/client'});
  for(let n=0;n<5;n++){retry.consume(start('old'+n,n?'capacity_retry_automatic':undefined));retry.consume({...fail('old'+n),at:Date.now()});t.mock.timers.tick(0);await Promise.resolve();}
  retry.consume(start('old5','capacity_retry_automatic'));retry.consume({...fail('old5'),at:Date.now()});assert.equal(retry.snapshot().scheduled[0].round,2);
  t.mock.timers.tick(10_000);retry.consume(start('user-clicked-retry','capacity_retry_manual'));assert.equal(retry.snapshot().pending,0);
  t.mock.timers.tick(30_000);assert.equal(calls,5,'the old cooldown was cancelled');
  for(let n=0;n<15;n++){
    const turn=n?'new'+n:'user-clicked-retry';if(n)retry.consume(start(turn,'capacity_retry_automatic'));
    retry.consume({...fail(turn),at:Date.now()});const pending=retry.snapshot().scheduled[0];assert.equal(pending.round,Math.floor(n/5)+1);assert.equal(pending.attempt,n%5+1);
    t.mock.timers.tick(n>0&&n%5===0?30_000:0);await Promise.resolve();assert.equal(calls,6+n);
  }
  retry.consume(start('new15','capacity_retry_automatic'));retry.consume({...fail('new15'),at:Date.now()});assert.equal(retry.snapshot().status,'exhausted');assert.equal(retry.snapshot().pending,0);
});
