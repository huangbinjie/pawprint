import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,appendFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {AttentionBridge} from '../electron/attention.mjs';
import relay from '../electron/attention-hook.cjs';
import {ActivityTracker,CodexActivity} from '../electron/activity.mjs';
import {initialState,transition} from '../core/game.mjs';
import {validateState} from '../core/store.mjs';
const id='01a0f1ea-4534-7651-b950-045a233fe631',other='01a0f5f7-5a51-7483-9fe6-9e028bc08226',now=Date.now();
const permission={session_id:id,turn_id:'turn',hook_event_name:'PermissionRequest',tool_name:'Bash',tool_input:{command:'echo PRIVATE_SECRET',description:'PRIVATE_DESCRIPTION'},transcript_path:'/PRIVATE_PATH'};
test('hook relay emits only IDs and state and cannot decide an approval',()=>{
 const wait=relay.normalizeHook(permission,now);assert.equal(wait.kind,'approval');assert.equal(wait.action,'waiting');assert.ok(!JSON.stringify(wait).includes('PRIVATE'));assert.equal(wait.threadId,id);assert.equal(wait.requestId.length,64);
 const done=relay.normalizeHook({...permission,hook_event_name:'PostToolUse',tool_response:{output:'PRIVATE'}},now+1);assert.equal(done.requestId,wait.requestId);assert.equal(done.action,'resolved');assert.equal(relay.normalizeHook({...permission,session_id:'evil://prompt'},now),null);
 const question={...permission,tool_name:'request_user_input_async',tool_use_id:'call-one',hook_event_name:'PreToolUse',tool_input:{questions:[{title:'PRIVATE_QUESTION'}]}};
 assert.equal(relay.normalizeHook(question,now),null);const q=relay.normalizeHook({...question,hook_event_name:'PostToolUse',tool_response:JSON.stringify({accepted:true})},now);assert.equal(q.kind,'question');assert.equal(q.action,'waiting');assert.equal(relay.normalizeHook({...question,hook_event_name:'PostToolUse',tool_response:{answers:{q:'PRIVATE_ANSWER'}}},now).requestId,q.requestId);
});
test('structured question records ignore async acknowledgements and clear only explicit answers',()=>{
 const t=new ActivityTracker({since:now});t.bind('file',id);
 const row=(type,payload,at=now)=>JSON.stringify({type,payload,timestamp:new Date(at).toISOString()});
 t.attentionRecord(row('response_item',{type:'function_call',name:'request_user_input_async',call_id:'call-one',arguments:JSON.stringify({questions:[{title:'PRIVATE_QUESTION'}]})}),'file',now);
 assert.deepEqual(t.takeAttentionEvents(),[]);
 t.attentionRecord(row('response_item',{type:'function_call_output',call_id:'call-one',output:JSON.stringify({accepted:true})}),'file',now);const wait=t.takeAttentionEvents();assert.equal(wait[0].action,'waiting');assert.ok(!JSON.stringify(wait).includes('PRIVATE'));
 t.attentionRecord(row('event_msg',{type:'user_message',message:'A normal PRIVATE message'}),'file',now);assert.deepEqual(t.takeAttentionEvents(),[]);
 t.attentionRecord(row('event_msg',{type:'user_message',message:`<send_user_message_question_reply>${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async','call-one',0]),answer:'PRIVATE_ANSWER'}])}</send_user_message_question_reply>`}),'file',now);const resolved=t.takeAttentionEvents();assert.equal(resolved[0].requestId,wait[0].requestId);assert.equal(resolved[0].action,'resolved');assert.ok(!JSON.stringify(resolved).includes('PRIVATE'));
});
test('connecting recovers an explicit unanswered question without replaying work history',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-question-recover-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'sessions'));const file=path.join(dir,'sessions','root.jsonl'),batches=[];
 const row=(type,payload,at)=>JSON.stringify({type,payload,timestamp:new Date(at).toISOString()})+'\n';
 await writeFile(file,JSON.stringify({type:'session_meta',payload:{id}})+'\n'+row('event_msg',{type:'task_started',turn_id:'old'},now-600000)+row('response_item',{type:'function_call',name:'request_user_input_async',call_id:'recover',arguments:JSON.stringify({questions:[{title:'PRIVATE'}]})},now-500000)+row('response_item',{type:'function_call_output',call_id:'recover',output:JSON.stringify({accepted:true})},now-499000));
 const activity=new CodexActivity({onChange:()=>{},onAttention:e=>batches.push(e),now:()=>now});t.after(()=>activity.close());await activity.configure({directory:dir,enabled:true,topics:false});assert.equal(activity.snapshot().status,'idle');await activity.refreshAttention();assert.equal(batches[0][0].action,'waiting');assert.equal(activity.snapshot().event,null);assert.ok(!JSON.stringify(batches).includes('PRIVATE'));
 await appendFile(file,row('event_msg',{type:'task_complete',turn_id:'old'},now));await activity.poll();assert.equal(batches.at(-1).at(-1).action,'clear');
});
test('attention preserves pinning and pending requests even when newer recent chats arrive',()=>{
 let s=initialState(now);const act=c=>s=transition(s,c,{now});act({type:'_work-observe',recent:[{threadId:other,at:now,kind:'running'}]});act({type:'work-pin',threadId:other});const wait=relay.normalizeHook(permission,now);act({type:'_work-attention',events:[wait]});assert.equal(s.work.pinned,other);assert.equal(s.work.recent.find(r=>r.threadId===id).attention.seen,false);
 act({type:'work-read',threadId:id});assert.equal(s.work.recent.find(r=>r.threadId===id).attention.seen,true);act({type:'_work-attention',events:[wait]});assert.equal(s.work.recent.find(r=>r.threadId===id).attention.seen,true);
 act({type:'_work-attention',events:[{...wait,action:'resolved',requestId:'f'.repeat(64)}]});assert.ok(s.work.recent.find(r=>r.threadId===id).attention);act({type:'_work-attention',events:[{...wait,action:'resolved',at:now+1}]});assert.equal(s.work.recent.find(r=>r.threadId===id).attention,undefined);assert.equal(s.balance,0);validateState(s);
});
test('resolving one request cannot hide another approval or question in the same chat',()=>{
 let s=initialState(now);const act=events=>s=transition(s,{type:'_work-attention',events},{now});const first=relay.normalizeHook(permission,now),second=relay.normalizeHook({...permission,tool_input:{command:'different PRIVATE'}},now+1);
 act([first,second]);assert.equal(s.work.recent[0].attentions.length,2);act([{...second,action:'resolved',at:now+2}]);assert.equal(s.work.recent[0].attention.id,first.requestId);assert.equal(s.work.recent[0].attentions.length,1);validateState(s);
});
test('installation preserves user hook rules, runs the relay silently, and disconnect removes only Pawprint',{skip:process.platform==='win32'},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"paw-hook-'quoted-"));t.after(()=>rm(dir,{recursive:true,force:true}));const client=path.join(dir,'client');await mkdir(client);const old={description:'KEEP',hooks:{PermissionRequest:[{matcher:'Bash',hooks:[{type:'command',command:'echo KEEP',timeout:2}]}],SessionStart:[{hooks:[{type:'command',command:'echo --pawprint-attention-v1 START'}]}]}};await writeFile(path.join(client,'hooks.json'),JSON.stringify(old));const batches=[];
 const bridge=new AttentionBridge({dataDirectory:dir,directory:client,execPath:process.execPath,relayPath:path.resolve('electron/attention-hook.cjs'),onEvents:e=>batches.push(e),platform:'darwin',now:()=>now});t.after(()=>bridge.close());const installed=await bridge.install();const rules=JSON.parse(await readFile(installed.file,'utf8'));assert.equal(rules.description,'KEEP');assert.equal(rules.hooks.PermissionRequest[0].hooks[0].command,'echo KEEP');assert.ok(rules.hooks.SessionStart);
 const result=await new Promise((resolve,reject)=>{const child=spawn('/bin/sh',['-c',installed.command]);let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify(permission));});assert.deepEqual(result,{code:0,out:'',err:''});await bridge.poll();assert.equal(batches[0][0].kind,'approval');assert.ok(!(await readFile(bridge.journal,'utf8')).includes('PRIVATE'));
 await bridge.uninstall();assert.deepEqual(JSON.parse(await readFile(installed.file,'utf8')),old);
});
test('broken hook configuration is left untouched and incomplete journal records are held until complete',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-hook-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'client'));const file=path.join(dir,'client/hooks.json');await writeFile(file,'BROKEN');const batches=[],bridge=new AttentionBridge({dataDirectory:dir,directory:path.dirname(file),execPath:process.execPath,relayPath:path.resolve('electron/attention-hook.cjs'),platform:'darwin',onEvents:e=>batches.push(e),now:()=>now});t.after(()=>bridge.close());await assert.rejects(bridge.install(),/not been changed/);assert.equal(await readFile(file,'utf8'),'BROKEN');await mkdir(bridge.root,{recursive:true});const event=JSON.stringify(relay.normalizeHook(permission,now));await writeFile(bridge.journal,event.slice(0,50));await bridge.poll();assert.equal(batches.length,0);await appendFile(bridge.journal,event.slice(50)+'\n');await bridge.poll();assert.equal(batches.length,1);await appendFile(bridge.journal,event+'\n');await bridge.poll();assert.equal(batches.length,1);
});

test('automatic hooks preserve unrelated rules, avoid repeat installs and leave malformed config untouched',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-auto-hook-'));t.after(()=>rm(dir,{recursive:true,force:true}));const client=path.join(dir,'client');
 const bridge=new AttentionBridge({dataDirectory:dir,directory:client,execPath:process.execPath,relayPath:path.resolve('electron/attention-hook.cjs'),platform:'darwin'});t.after(()=>bridge.close());await bridge.configure(true);await bridge.prepareDefaults();assert.equal(bridge.snapshot().status,'question-only');
 await mkdir(client);const old={hooks:{SessionStart:[{hooks:[{type:'command',command:'echo KEEP'}]}]}};await writeFile(path.join(client,'hooks.json'),JSON.stringify(old));await bridge.prepareDefaults();const first=await readFile(path.join(client,'hooks.json'),'utf8');assert.equal(JSON.parse(first).hooks.SessionStart[0].hooks[0].command,'echo KEEP');assert.equal(bridge.snapshot().status,'installed');await bridge.prepareDefaults();assert.equal(await readFile(path.join(client,'hooks.json'),'utf8'),first);
 await writeFile(path.join(client,'hooks.json'),'BROKEN');await bridge.prepareDefaults();assert.equal(bridge.snapshot().status,'error');assert.equal(await readFile(path.join(client,'hooks.json'),'utf8'),'BROKEN');
});
