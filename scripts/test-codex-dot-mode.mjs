// Isolated built-in OpenAI routing probe. Uses temporary profiles and dummy keys.
// No real login is copied and all inference is answered by the loopback mock.
// Dummy API authentication tests the transport; real ChatGPT/Dot UI acceptance
// is deliberately separate and must not be inferred from this probe.
import {spawn} from 'node:child_process';
import {CodexAccounts} from '../electron/codex-accounts.mjs';
import {CodexIdentityBridge} from '../electron/codex-identity-bridge.mjs';
import {readRouteEvidence} from '../electron/codex-route-evidence.mjs';
import {parse} from 'smol-toml';
import {findCodexBinary} from '../electron/codex-provider-titles.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'paw-dot-builtin-'));
const bin=await findCodexBinary();
let bridge;const records=[],notifications=[];const pending=new Map();let child,buffer='',sequence=0;const realChatGPT=false;
const server=http.createServer((req,res)=>{
 let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  let request={};try{request=JSON.parse(body)}catch{}
  records.push({path:req.url,authDummy:req.headers.authorization==='Bearer dummy-provider-key',model:request.model||null,containsIdentity:JSON.stringify(req.headers).includes('dummy-pawprint-access'),headerNames:Object.keys(req.headers)});
  if(!req.url.includes('/responses')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url.includes('accounts/check')?{accounts:{'pawprint-test-account':{account:{account_id:'pawprint-test-account',name:'Test',plan_type:'plus',structure:'personal',is_deactivated:false,workspace_backend_origin:`http://127.0.0.1:${server.address().port}`},workspace_backend_origin:`http://127.0.0.1:${server.address().port}`,account_user_role:'account-owner'}},account_ordering:['pawprint-test-account']}:req.url.includes('/models')?{models:[]}:{object:'list',data:[]}));return;}
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
server.on('upgrade',(req,socket)=>{socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
const summary={};
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await writeFile(path.join(root,'config.toml'),'model="gpt-6.1-sol"\nmodel_provider="openai"\ncli_auth_credentials_store="file"\n');
 const login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy-pawprint-access',id_token:'dummy-identity'}});
 await writeFile(path.join(root,'auth.json'),login,{mode:0o600});
 const keychain={get:async()=> 'dummy-provider-key',set:async()=>{},remove:async()=>{}};
 const dataDirectory=path.join(root,'paw');bridge=new CodexIdentityBridge({dataDirectory,keychain});
 const manager=new CodexAccounts({directory:root,dataDirectory,keychain,identityBridge:bridge,platform:'darwin',running:async()=>false});await manager.load();
 const provider=(await manager.add({name:'Dot mock gateway',model:'gpt-6.1-sol',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'dummy-provider-key'})).providers[0];
 await manager.switch(provider.id);
 const routedConfig=parse(await readFile(path.join(root,'config.toml'),'utf8'));
 assert.equal(routedConfig.model_provider,'openai');assert.equal(routedConfig.openai_base_url,bridge.baseUrl(provider.id));
 assert.equal(await readFile(path.join(root,'auth.json'),'utf8'),login);
 summary.originalLoginUnchanged=true;summary.selectedProvider=(await manager.status()).selected;
 // The real inference probe uses a dummy API login: fake ChatGPT JWTs cannot
 // satisfy workspace routing discovery. This tests routing, not real entitlement.
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-pawprint-access'}),{mode:0o600});
 const env={...process.env,CODEX_HOME:root,OPENAI_API_KEY:'dummy-pawprint-access'};delete env.OPENAI_BASE_URL;
 child=spawn(bin,['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line)}catch{continue}if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else notifications.push(m);}});
 await call('initialize',{clientInfo:{name:'pawprint_dot_builtin_probe',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const config=(await call('config/read')).config;summary.configProvider=config.model_provider;summary.configUrl=config.openai_base_url;
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-pawprint-access'}));summary.account=await call('account/read',{refreshToken:false});
 const a=await call('thread/start',{cwd:root});summary.threadProvider=a.modelProvider;summary.reply=await turn(a);summary.requests=records;
 await new Promise(r=>setTimeout(r,100));summary.routeEvidence=await readRouteEvidence(dataDirectory);assert.equal(summary.routeEvidence[a.thread.id]?.providerId,provider.id);assert.ok(records.filter(r=>r.model).every(r=>r.authDummy&&!r.containsIdentity));
 assert.equal(a.modelProvider,'openai');assert.equal(summary.account.account.type,'apiKey');assert.match(summary.reply,/PAWPRINT_MOCK_OK/);
 console.log(JSON.stringify(summary,null,2));
}catch(error){console.log(JSON.stringify({error:error.message,records,summary},null,2));throw error;}finally{for(const p of pending.values())clearTimeout(p.timer);if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
