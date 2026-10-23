// Native app-server + temporary profiles and loopback providers. No real
// credentials, paid inference, desktop access or user configuration changes.
import {spawn} from 'node:child_process';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {parse} from 'smol-toml';import {CodexAccounts} from '../electron/codex-accounts.mjs';import {CodexIdentityBridge} from '../electron/codex-identity-bridge.mjs';import {findCodexBinary} from '../electron/codex-provider-titles.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'paw-session-binding-')),dataDirectory=path.join(root,'paw'),requests=[],pending=new Map(),notifications=[];
let child,bridge,sequence=0,buffer='';
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const b of req)chunks.push(b);
 if(!/\/responses(?:\/compact)?$/.test(req.url)){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({models:[],data:[]}));return;}
 const request=JSON.parse(Buffer.concat(chunks));requests.push({path:req.url,model:request.model,keyMatches:req.headers.authorization===`Bearer ${req.url.startsWith('/official/')?'dummy-client-key':'dummy-provider-key'}`,reasoning:request.reasoning??null});
 if(req.url.endsWith('/compact')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;}
 const item={id:'msg_model_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'MODEL_ROUTING_OK',annotations:[]}]};
 const response={id:'resp_model_'+requests.length,object:'response',created_at:Math.floor(Date.now()/1000),model:request.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end();
});
server.on('upgrade',(_,socket)=>socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},10000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
async function start(){
 const env={...process.env,CODEX_HOME:root};delete env.OPENAI_BASE_URL;delete env.OPENAI_API_KEY;
 child=spawn(await findCodexBinary(),['app-server','--stdio'],{env,stdio:['pipe','pipe','ignore']});
 child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m;try{m=JSON.parse(line)}catch{continue}const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else notifications.push(m);}});
 await call('initialize',{clientInfo:{name:'paw_model_routing',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
}
async function turn(thread){
 const from=notifications.length;await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Reply with OK without tools.'}]});
 for(let i=0;i<500;i++){const done=notifications.slice(from).find(m=>m.method==='turn/completed'&&m.params?.threadId===thread.thread.id);if(done){assert.equal(done.params.turn.status,'completed',JSON.stringify(done.params.turn.error));return;}await new Promise(r=>setTimeout(r,20));}throw Error('Turn timed out');
}
async function stop(){if(child?.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}buffer='';notifications.length=0;}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 await writeFile(path.join(root,'config.toml'),`model="gpt-6.1-sol"\nopenai_base_url="${url}/official/v1"\nchatgpt_base_url="${url}/backend-api"\ncli_auth_credentials_store="file"\n[features]\napps=false\nplugins=false\nremote_models=false\n[analytics]\nenabled=false\n`);
 const login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy-chatgpt',id_token:'dummy-identity'}}),nativeAuth=JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-client-key'});
 await writeFile(path.join(root,'auth.json'),nativeAuth);await start();
 const original=await call('thread/start',{cwd:root,model:'gpt-6-astra'});await turn(original);assert.equal(requests.at(-1).path,'/official/v1/responses');
 await stop();await writeFile(path.join(root,'auth.json'),login);
 const keychain={get:async()=> 'dummy-provider-key',set:async()=>{},remove:async()=>{}};
 bridge=new CodexIdentityBridge({dataDirectory,keychain});const manager=new CodexAccounts({directory:root,dataDirectory,keychain,identityBridge:bridge,platform:'darwin',running:async()=>false});await manager.load();
 const vendor=(await manager.add({name:'MiMo mock',baseUrl:url+'/vendor/v1',model:'mimo-v2.6-pro',apiKey:'dummy'})).providers[0].id;
 const select=async id=>{await writeFile(path.join(root,'auth.json'),login);await manager.switch(id);await writeFile(path.join(root,'auth.json'),nativeAuth);};
 await select(vendor);await start();
 const resumed=await call('thread/resume',{threadId:original.thread.id});await turn(resumed);
 assert.equal(requests.at(-1).path,'/official/v1/responses');assert.equal(requests.at(-1).model,'gpt-6-astra');
 const mimo=await call('thread/start',{cwd:root,model:'gpt-6.1-sol'});await turn(mimo);assert.equal(requests.at(-1).path,'/vendor/v1/responses');assert.equal(requests.at(-1).model,'mimo-v2.6-pro');
 await stop();
 await select('openai');assert.equal(parse(await readFile(manager.file,'utf8')).openai_base_url,bridge.baseUrl('openai'));await start();
 const official=await call('thread/start',{cwd:root,model:'gpt-6-astra'});await turn(official);assert.equal(requests.at(-1).path,'/official/v1/responses');
 for(const row of [mimo]){const restored=await call('thread/resume',{threadId:row.thread.id});await turn(restored);assert.equal(requests.at(-1).path,'/vendor/v1/responses');assert.equal(requests.at(-1).model,'mimo-v2.6-pro');}
 await stop();await bridge.close();
 bridge=new CodexIdentityBridge({dataDirectory,keychain});manager.identityBridge=bridge;await manager.load();await writeFile(path.join(root,'auth.json'),login);await manager.prepareIdentityConnection();await writeFile(path.join(root,'auth.json'),nativeAuth);await start();
 for(const row of [original,mimo,official]){const restored=await call('thread/resume',{threadId:row.thread.id});await turn(restored);assert.equal(requests.at(-1).path,row===mimo?'/vendor/v1/responses':'/official/v1/responses');}
 assert.ok(requests.every(r=>r.keyMatches));
 console.log(JSON.stringify({passed:true,nativeBackendRestarts:3,bridgeRestarts:1,officialChatsRemainOfficial:true,vendorChatsRemainVendor:true,credentialsSeparated:true,requests},null,2));
}finally{
 for(const p of pending.values())clearTimeout(p.timer);await stop();await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
