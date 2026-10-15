// Isolated running app-server test; never changes the user's config or login.
// --chatgpt additionally copies auth.json into a private temporary home, sends
// one authorized test message to OpenAI, then deletes the temporary credentials.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile,copyFile,chmod} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import http from 'node:http';
import assert from 'node:assert/strict';
import {CodexAccounts,MacKeychain} from '../electron/codex-accounts.mjs';
const realChatGPT=process.argv.includes('--chatgpt');
const originalHome=process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
const root=await mkdtemp(path.join(os.tmpdir(),'paw-live-switch-'));
const bin=execFileSync('/bin/zsh',['-lc','command -v codex'],{encoding:'utf8'}).trim();
const records=[],notifications=[];const pending=new Map();let child,buffer='',sequence=0;
const summary={version:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),desktopUI:'not verified: Computer Use denies com.openai.codex'};
const keychain=new MacKeychain();let providerIds=[];
const server=http.createServer((req,res)=>{
 let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  let request={};try{request=JSON.parse(body)}catch{}
  records.push({path:req.url,keyMatched:req.headers.authorization==='Bearer dummy-pawprint-live-test',model:request.model||null});
  if(!req.url.includes('/responses')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({object:'list',data:[]}));return;}
  const text='PAWPRINT_MOCK_OK',id='resp_paw_'+Date.now();
  const item={id:'msg_'+Date.now(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  const response={id,object:'response',created_at:Math.floor(Date.now()/1000),model:request.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:text},{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
  for(const [sequence_number,event] of events.entries())res.write(`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number})}\n\n`);
  res.end();
 });
});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
async function waitTurn(threadId,from){const start=Date.now();while(Date.now()-start<45000){const messages=notifications.slice(from).filter(n=>n.params?.threadId===threadId);const done=messages.find(n=>n.method==='turn/completed');if(done){assert.equal(done.params.turn.status,'completed',JSON.stringify(done.params.turn.error));return messages.filter(n=>n.method==='item/agentMessage/delta').map(n=>n.params.delta).join('') || messages.filter(n=>n.method==='item/completed' && n.params.item?.type==='agentMessage').map(n=>n.params.item.text).join('');}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for completed turn');}
async function turn(thread){const from=notifications.length;await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:realChatGPT&&thread.modelProvider==='openai'?'Reply with exactly PAWPRINT_CHATGPT_OK. Do not use tools.':'Reply with PAWPRINT_MOCK_OK. Do not use tools.'}]});return waitTurn(thread.thread.id,from);}
try {
 await server.listen(0,'127.0.0.1');if(!server.listening)await new Promise(r=>server.once('listening',r));
 await writeFile(path.join(root,'config.toml'),'model = "gpt-6.1-sol"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n',{mode:0o600});
 if(realChatGPT){await copyFile(path.join(originalHome,'auth.json'),path.join(root,'auth.json'));await chmod(path.join(root,'auth.json'),0o600);}
 const manager=new CodexAccounts({directory:root,dataDirectory:path.join(root,'paw'),keychain,running:async()=>!!child});await manager.load();
 for(const suffix of ['a','b']){const status=await manager.add({name:'Pawprint Live '+suffix,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'paw-model-'+suffix,apiKey:'dummy-pawprint-live-test'});providerIds.push(status.providers.at(-1).id);}
 const env={...process.env,CODEX_HOME:root};delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
 child=spawn(bin,['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line)}catch{continue}if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else notifications.push(m);}});
 await call('initialize',{clientInfo:{name:'pawprint_live_switch_test',version:'2'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const pid=child.pid;
 summary.initialProvider=(await call('config/read')).config.model_provider;
 await manager.switch(providerIds[0]);const a=await call('thread/start',{cwd:root});assert.equal(a.modelProvider,providerIds[0]);assert.equal(a.model,'paw-model-a');assert.match(await turn(a),/PAWPRINT_MOCK_OK/);
 await manager.switch(providerIds[1]);const b=await call('thread/start',{cwd:root});assert.equal(b.modelProvider,providerIds[1]);assert.equal(b.model,'paw-model-b');assert.match(await turn(b),/PAWPRINT_MOCK_OK/);
 await manager.switch('openai');const restored=await call('thread/start',{cwd:root});assert.equal(restored.modelProvider,'openai');assert.equal(restored.model,'gpt-6.1-sol');
 // An existing provider A chat must continue to work after switching defaults back.
 assert.match(await turn(a),/PAWPRINT_MOCK_OK/);
 await call('thread/name/set',{threadId:a.thread.id,name:'Provider A title'});
 await call('thread/name/set',{threadId:b.thread.id,name:'[Bug] Provider B title'});
 await call('thread/name/set',{threadId:restored.thread.id,name:'OpenAI title'});
 const {CodexProviderTitles}=await import('../electron/codex-provider-titles.mjs');
 const {readWorkTitles}=await import('../electron/work-titles.mjs');
 const labeler=new CodexProviderTitles({directory:root,dataDirectory:path.join(root,'paw')});await labeler.load();await labeler.refresh();
 const titles=new Map((await readWorkTitles(root,[a.thread.id,b.thread.id,restored.thread.id])).map(r=>[r.threadId,r.title]));
 summary.providerTitles={a:titles.get(a.thread.id),b:titles.get(b.thread.id),openai:titles.get(restored.thread.id),status:labeler.snapshot()};
 assert.equal(titles.get(a.thread.id),'[Pawprint Live a] Provider A title');assert.equal(titles.get(b.thread.id),'[Pawprint Live b] [Bug] Provider B title');assert.equal(titles.get(restored.thread.id),'OpenAI title');
 await labeler.refresh();assert.equal(labeler.snapshot().updated,2);await labeler.close();
 summary.sameBackendProcess=child.pid===pid;summary.providerACompleted=true;summary.providerBCompleted=true;summary.existingACompletedAfterSwitchBack=true;summary.restoredProvider=restored.modelProvider;summary.restoredModel=restored.model;
 if(realChatGPT){summary.chatgptReply=await turn(restored);assert.match(summary.chatgptReply,/PAWPRINT_CHATGPT_OK/);summary.chatgptCompleted=true;}
 summary.responses=records.filter(r=>r.path.includes('/responses'));assert.ok(summary.responses.every(r=>r.keyMatched));
 console.log(JSON.stringify(summary,null,2));
} catch(e){console.log(JSON.stringify({...summary,error:e.message},null,2));process.exitCode=1;}
finally {
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test cleanup'));}pending.clear();
 if(child){const c=child;await new Promise(r=>{c.once('exit',r);c.kill();setTimeout(()=>{c.kill('SIGKILL');r();},2000).unref();});}
 for(const id of providerIds)await keychain.remove(id);
 await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
