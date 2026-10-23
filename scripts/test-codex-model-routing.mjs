// Native app-server + temporary profiles and loopback providers. No real
// credentials, paid inference, desktop access or user configuration changes.
import {spawn} from 'node:child_process';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {parse} from 'smol-toml';import {CodexAccounts} from '../electron/codex-accounts.mjs';import {CodexIdentityBridge} from '../electron/codex-identity-bridge.mjs';import {findCodexBinary} from '../electron/codex-provider-titles.mjs';
import {readTurnRoutes} from '../electron/codex-route-evidence.mjs';import {parseSession} from '../electron/usage/scanner.mjs';
import {readUsage} from '../electron/local-usage.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'paw-model-routing-')),dataDirectory=path.join(root,'paw'),requests=[],pending=new Map(),notifications=[];
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
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 await writeFile(path.join(root,'config.toml'),`model="gpt-6.1-sol"\nopenai_base_url="${url}/official/v1"\nchatgpt_base_url="${url}/backend-api"\ncli_auth_credentials_store="file"\n[features]\napps=false\nplugins=false\nremote_models=false\n[analytics]\nenabled=false\n`);
 const login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy-chatgpt',id_token:'dummy-identity'}});await writeFile(path.join(root,'auth.json'),login,{mode:0o600});
 const keychain={get:async()=> 'dummy-provider-key',set:async()=>{},remove:async()=>{}};
 bridge=new CodexIdentityBridge({dataDirectory,keychain});const manager=new CodexAccounts({directory:root,dataDirectory,keychain,identityBridge:bridge,platform:'darwin',running:async()=>false});await manager.load();
 const gpt=(await manager.add({name:'Native gateway',baseUrl:url+'/v1',model:'gpt-6.1-sol',apiKey:'dummy'})).providers[0].id;
 await manager.switch(gpt);assert.equal(await readFile(path.join(root,'auth.json'),'utf8'),login);
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-client-key'}));await start();
 assert.equal((await manager.status()).providers[0].modelSelection,'picker');
 const native=await call('thread/start',{cwd:root,model:'gpt-6-astra'});assert.equal(native.modelProvider,'openai');await turn(native);assert.equal(requests.at(-1).model,'gpt-6-astra');
 const nativeTitle=await call('thread/start',{cwd:root,model:'gpt-6-luna',ephemeral:true});await turn(nativeTitle);assert.equal(requests.at(-1).model,'gpt-6-luna');
 // Register MiMo only after the real native backend is already running.
 await writeFile(path.join(root,'auth.json'),login);
 const vendor=(await manager.add({name:'Other vendor',baseUrl:url+'/v1',model:'mimo-v2.6-pro',apiKey:'dummy'})).providers[1].id;
 await manager.switch(vendor);const managed=await readFile(manager.file,'utf8'),doc=parse(managed);
 assert.equal((await manager.status()).providers[1].modelSelection,'fixed');
 assert.equal(doc.model_provider,'openai');assert.equal(doc.model_providers[vendor].requires_openai_auth,true);assert.equal(doc.model_catalog_json,undefined);
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-client-key'}));await call('config/read',{includeLayers:false,cwd:null});
 const models=await call('model/list',{includeHidden:true,cursor:null,limit:100});
 assert.ok(!models.data.some(m=>m.model==='mimo-v2.6-pro'));
 // Simulate a stale GPT picker and the native GPT title-generation model.
 const custom=await call('thread/start',{cwd:root,model:'gpt-6.1-sol'});assert.equal(custom.modelProvider,'openai');assert.equal(custom.model,'gpt-6.1-sol');await turn(custom);assert.equal(requests.at(-1).model,'mimo-v2.6-pro');
 const title=await call('thread/start',{cwd:root,model:'gpt-6-luna',allowProviderModelFallback:true,ephemeral:true});await turn(title);assert.equal(requests.at(-1).model,'mimo-v2.6-pro');
 const compact=await fetch(bridge.baseUrl(vendor)+'/responses/compact',{method:'POST',body:JSON.stringify({model:'gpt-6.1-sol',input:[]})});assert.equal(compact.status,200);await compact.text();assert.equal(requests.at(-1).path,'/v1/responses/compact');assert.equal(requests.at(-1).model,'mimo-v2.6-pro');
 await writeFile(path.join(root,'auth.json'),login);await manager.switch('openai');assert.equal(parse(await readFile(manager.file,'utf8')).model_catalog_json,undefined);assert.equal(await readFile(path.join(root,'auth.json'),'utf8'),login);
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-client-key'}));
 const official=await call('thread/start',{cwd:root,model:'gpt-6-astra'});await turn(official);assert.equal(requests.at(-1).path,'/official/v1/responses');assert.equal(requests.at(-1).model,'gpt-6-astra');
 assert.ok(requests.every(r=>r.keyMatches));
 await bridge.routeEvidence.queue;const turnRoutes=await readTurnRoutes(dataDirectory);let metered;
 for(let i=0;i<50;i++){
  metered=await parseSession(custom.thread.path,{startMs:0,endMs:Date.now(),turnRoutes});if(metered.rows.length)break;await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(metered.rows.length,1);assert.equal(metered.rows[0].provider,vendor);assert.equal(metered.rows[0].model,'mimo-v2.6-pro');assert.equal(metered.rows[0].tokens,2);
 const cacheDirectory=path.join(root,'usage-cache');await mkdir(cacheDirectory);
 await writeFile(path.join(cacheDirectory,'model-prices.json'),JSON.stringify({fetchedAt:Date.now(),catalog:{openai:{models:Object.fromEntries(Array.from({length:11},(_,i)=>['fixture-'+i,{cost:{input:1,output:2}}]))},xiaomi:{models:{'mimo-v2.6-pro':{cost:{input:0.435,output:0.87}}}}}}));
 const imported=await readUsage({codexHome:root,cacheDirectory,routeDirectory:dataDirectory}),display=imported.days.at(-1).models.find(m=>m.provider===vendor);
 assert.equal(display.name,'mimo-v2.6-pro');assert.equal(display.tokens,2);assert.ok(display.referenceUSD>0);assert.equal(display.usd,null);
 console.log(JSON.stringify({passed:true,nativeProcessRestarts:0,clientListedMimo:false,pickerModel:custom.model,titleRequestedModel:title.model,nativeUsageAttribution:{model:display.name,tokens:display.tokens,referenceUSD:display.referenceUSD,workerImportVerified:true},requests},null,2));
}finally{
 for(const p of pending.values())clearTimeout(p.timer);
 if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});
 await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
