// Isolated capability probe: two clients share one daemon and use dummy credentials.
// Never opens Desktop, copies real login data, or edits the user's configuration.
// All inference is handled by the loopback mock; no paid model request is sent.
// Requires a Codex CLI supporting app-server --listen unix:// and Unix sockets.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ws:WebSocket}=require(require.resolve('playwright-core').replace(/index\.js$/,'lib/utilsBundle.js'));
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'paw-shared-thread-'));
import {findCodexBinary} from '../electron/codex-provider-titles.mjs';
import {execFileSync} from 'node:child_process';
const bin=await findCodexBinary();
const records=[];let daemon;const clients=[];
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
class Client {
 constructor(label,env,socket){
  this.label=label;this.pending=new Map();this.events=[];this.buffer='';this.sequence=0;
  this.socket=new WebSocket('ws+unix://'+socket+':/');
  this.ready=new Promise((resolve,reject)=>{this.socket.once('open',resolve);this.socket.once('error',reject);});
  this.socket.on('error',error=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();});
  this.socket.on('message',bytes=>{const m=JSON.parse(bytes.toString());const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else this.events.push(m);});
 }
 call(method,params={}) {return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(this.label+' timeout '+method));},12000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
 async init(){await this.ready;await this.call('initialize',{clientInfo:{name:'pawprint_shared_'+this.label,version:'1'},capabilities:{experimentalApi:true}});this.socket.send(JSON.stringify({method:'initialized'}));}
 async turn(id,model){const from=this.events.length;const count=records.length;await this.call('turn/start',{threadId:id,input:[{type:'text',text:'Reply with PAWPRINT_MOCK_OK. Do not use tools.'}],...(model?{model}: {})});const until=Date.now()+15000;while(Date.now()<until){const completed=this.events.slice(from).find(m=>m.method==='turn/completed'&&m.params?.threadId===id);if(completed){assert.equal(completed.params.turn.status,'completed');return records.slice(count);}await new Promise(r=>setTimeout(r,30));}throw Error('Turn timeout');}
 close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('closing'));}this.pending.clear();this.socket.terminate();}
}

const summary={version:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),scope:'Two mock clients sharing one isolated app-server daemon; localhost inference only',checks:[]};
function record(name,data){const row={name,...data};summary.checks.push(row);console.log(JSON.stringify(row));}
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const definitions=`\n[model_providers.provider_a]\nname="Provider A"\nbase_url="http://127.0.0.1:${server.address().port}/a/v1"\nwire_api="responses"\nenv_key="PAWPRINT_DUMMY_TOKEN"\n[model_providers.provider_b]\nname="Provider B"\nbase_url="http://127.0.0.1:${server.address().port}/b/v1"\nwire_api="responses"\nenv_key="PAWPRINT_DUMMY_TOKEN"\n`;
 const config=async id=>writeFile(path.join(root,'config.toml'),`model="model-${id}"\nmodel_provider="provider_${id}"\ncli_auth_credentials_store="file"\n`+definitions,{mode:0o600});
 await config('a');
 const env={...process.env,CODEX_HOME:root,PAWPRINT_DUMMY_TOKEN:'dummy-pawprint-live-test'};delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
 const socket=path.join(root,'control.sock');
 daemon=spawn(bin,['app-server','--listen','unix://'+socket],{env,stdio:['ignore','ignore','pipe']});daemon.stderr.resume();
 let ready=false;for(let i=0;i<80;i++){try{ready=(await stat(socket)).isSocket();if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Socket did not start');
 const desktop=new Client('desktop',env,socket),paw=new Client('pawprint',env,socket);clients.push(desktop,paw);await desktop.init();await paw.init();
 const thread=await desktop.call('thread/start',{cwd:root});const id=thread.thread.id;await desktop.turn(id);
 await config('b');
 let resumed=await paw.call('thread/resume',{threadId:id,modelProvider:'provider_b',model:'model-b',excludeTurns:true});
 let requests=await desktop.turn(id);record('second_client_cannot_switch_loaded_thread',{provider:resumed.modelProvider,model:resumed.model,requests});assert.equal(resumed.modelProvider,'provider_a');assert.ok(requests.every(r=>r.path.includes('/a/')));
 const unsubPaw=await paw.call('thread/unsubscribe',{threadId:id});
 resumed=await paw.call('thread/resume',{threadId:id,modelProvider:'provider_b',model:'model-b',excludeTurns:true});
 requests=await desktop.turn(id);record('unsubscribing_pawprint_only_keeps_desktop_provider',{unsubPaw,provider:resumed.modelProvider,requests});assert.equal(resumed.modelProvider,'provider_a');assert.ok(requests.every(r=>r.path.includes('/a/')));
 await paw.call('thread/unsubscribe',{threadId:id});const unsubDesktop=await desktop.call('thread/unsubscribe',{threadId:id});await new Promise(r=>setTimeout(r,500));
 resumed=await paw.call('thread/resume',{threadId:id,modelProvider:'provider_b',model:'model-b',excludeTurns:true});
 const reopened=await desktop.call('thread/resume',{threadId:id,excludeTurns:true});requests=await desktop.turn(id);
 record('all_clients_unsubscribe_then_both_resume_b',{unsubDesktop,provider:resumed.modelProvider,desktopProvider:reopened.modelProvider,model:reopened.model,requests});assert.equal(resumed.modelProvider,'provider_b');assert.equal(reopened.modelProvider,'provider_b');assert.ok(requests.every(r=>r.path.includes('/b/')));
 requests=await desktop.turn(id,'model-a');record('stale_desktop_model_override_remains_possible',{requests});assert.ok(requests.every(r=>r.path.includes('/b/')&&r.model==='model-a'));
 const history=await desktop.call('thread/read',{threadId:id,includeTurns:true});record('history_preserved',{threadIdSame:history.thread.id===id,turns:history.thread.turns.length,provider:history.thread.modelProvider});assert.ok(history.thread.turns.length>=5);
 console.log(JSON.stringify({summary},null,2));
} finally {
 for(const client of clients)client.close();
 if(daemon&&daemon.exitCode===null){const stopped=new Promise(resolve=>daemon.once('exit',resolve));daemon.kill();const timer=setTimeout(()=>daemon.kill('SIGKILL'),2000);await stopped;clearTimeout(timer);}
 server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
