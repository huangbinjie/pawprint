import test from 'node:test';import assert from 'node:assert/strict';
import net from 'node:net';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {ApprovalRequests,ApprovalObserver,approvalId} from '../electron/approval-observer.mjs';
import {initialState,transition} from '../core/game.mjs';import {validateState} from '../core/store.mjs';
const id='01a0f1ea-4534-7651-b950-045a233fe631',other='01a0f5f7-5a51-7483-9fe6-9e028bc08226';
const request=(n=81,threadId=id)=>({id:n,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn',command:'PRIVATE_COMMAND',reason:'PRIVATE_REASON'}});
const snapshot=(requests,revision=0)=>({type:'snapshot',revision,conversationState:{id,requests,turns:[{items:[{type:'automaticApprovalReview',status:'inProgress'}]}],currentPermissions:{approvalsReviewer:'auto_review'}}});
test('manual requests, not reviewer mode or automatic review items, decide approval signs',()=>{
 const state=new ApprovalRequests(id);assert.equal(state.consume(snapshot([])).size,0);
 assert.deepEqual([...state.consume(snapshot([request(),{id:82,method:'item/tool/requestUserInput',params:{threadId:id}},request(83,other)],1))],[approvalId(id,request())]);
 assert.ok(!JSON.stringify(state).includes('PRIVATE'));
 assert.equal(state.consume({type:'patches',baseRevision:1,revision:2,patches:[{op:'remove',path:['requests',0]}]}).size,0);
});
test('request patches preserve concurrent approvals and ignore unrelated conversation changes',()=>{
 const state=new ApprovalRequests(id);state.consume(snapshot([request()]));
 let pending=state.consume({type:'patches',baseRevision:0,revision:1,patches:[{op:'add',path:['requests',1],value:request(82)},{op:'replace',path:['turns',0,'items'],value:[{type:'automaticApprovalReview'}]}]});assert.equal(pending.size,2);
 pending=state.consume({type:'patches',baseRevision:1,revision:2,patches:[{op:'remove',path:['requests',0]}]});assert.deepEqual([...pending],[approvalId(id,request(82))]);
 assert.equal(state.consume({type:'patches',baseRevision:2,revision:3,patches:[{op:'replace',path:['requests'],value:[]}]}).size,0);
});
test('missing patches and incompatible snapshots fail closed',()=>{
 const state=new ApprovalRequests(id);assert.throws(()=>state.consume({type:'patches',baseRevision:0,revision:1,patches:[]}));state.consume(snapshot([request()]));
 assert.throws(()=>state.consume({type:'patches',baseRevision:2,revision:3,patches:[]}));assert.throws(()=>state.consume({...snapshot([]),conversationState:{id:other,requests:[]}}));
 assert.throws(()=>state.consume({type:'patches',baseRevision:0,revision:1,patches:[{op:'add',path:['requests','__proto__'],value:{}}]}));assert.equal({}.polluted,undefined);
});
test('owner/version checks and disconnect clear only tracked approvals, preserving questions',async()=>{
 let s=initialState();const events=[];const observer=new ApprovalObserver({getDirectory:()=>'/none',getThreads:()=>[id],onEvents:batch=>{events.push(...batch);s=transition(s,{type:'_work-attention',events:batch},{now:Date.now()});}});
 const q={version:1,eventId:'question',threadId:id,at:Date.now(),kind:'question',action:'waiting',requestId:'f'.repeat(64)};s=transition(s,{type:'_work-attention',events:[q]},{now:Date.now()});observer.client='self';observer.following.set(id,{owner:'owner',state:new ApprovalRequests(id),ids:new Set()});
 const message={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',targetClientIds:['self'],params:{hostId:'local',conversationId:id,change:snapshot([request()])}};
 observer.message({...message,sourceClientId:'other'});await observer.eventQueue;assert.equal(events.length,0);
 observer.message(message);await observer.eventQueue;assert.equal(s.work.recent[0].attentions.length,2);
 observer.message({...message,params:{...message.params,change:{type:'patches',baseRevision:0,revision:1,patches:[{op:'remove',path:['requests',0]}]}}});await observer.eventQueue;assert.equal(s.work.recent[0].attention.kind,'question');
 observer.message(message);await observer.eventQueue;observer.message({...message,version:12});await observer.eventQueue;assert.equal(s.work.recent[0].attention.kind,'question');assert.equal(observer.status,'unavailable');validateState(s);
});

test('real framed IPC subscribes read-only, reconnects, and withdraws signs on disconnect',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-ipc-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const socketPath=process.platform==='win32'?`\\\\.\\pipe\\pawprint-test-${process.pid}-${Date.now()}`:path.join(dir,'ipc.sock');const seen=[],events=[],sockets=new Set();let activeSocket;
 function frame(v){const bytes=Buffer.from(JSON.stringify(v)),h=Buffer.alloc(4);h.writeUInt32LE(bytes.length);return Buffer.concat([h,bytes]);}
 function send(socket,v){const bytes=frame(v);socket.write(bytes.subarray(0,2));socket.write(bytes.subarray(2));}
 const server=net.createServer(socket=>{sockets.add(socket);activeSocket=socket;let data=Buffer.alloc(0);socket.on('close',()=>sockets.delete(socket));socket.on('data',b=>{data=Buffer.concat([data,b]);while(data.length>=4){const n=data.readUInt32LE(0);if(data.length<n+4)return;const m=JSON.parse(data.subarray(4,n+4));data=data.subarray(n+4);seen.push(m);if(m.type==='request')send(socket,{type:'response',requestId:m.requestId,method:m.method,resultType:'success',handledByClientId:'owner',result:m.method==='initialize'?{clientId:'self'}:{}});if(m.type==='broadcast'&&m.params.following)send(socket,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:id,change:snapshot([request()])}});}});});
 await new Promise(resolve=>server.listen(socketPath,resolve));const observer=new ApprovalObserver({getDirectory:()=>dir,getThreads:()=>[id],socketPath,onEvents:e=>events.push(...e)});
 t.after(async()=>{await observer.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
 async function until(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Timed out');}
 await observer.configure(true);await until(()=>events.some(e=>e.action==='waiting'));
 assert.equal(observer.snapshot().status,'connected');send(activeSocket,{type:'client-discovery-request',requestId:'discovery',request:{method:'thread-follower-command-approval-decision'}});await until(()=>seen.some(m=>m.type==='client-discovery-response'));assert.equal(seen.find(m=>m.type==='client-discovery-response').response.canHandle,false);
 activeSocket.destroy();await until(()=>events.some(e=>e.action==='resolved'));await observer.refresh();await until(()=>events.filter(e=>e.action==='waiting').length===2);await observer.close();assert.equal(events.filter(e=>e.action==='resolved').length,2);
 assert.deepEqual([...new Set(seen.filter(m=>m.type==='request').map(m=>m.method))].sort(),['initialize','thread-owner-discovery']);await until(()=>seen.some(m=>m.type==='broadcast'&&m.params.following===false));assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
