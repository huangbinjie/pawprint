// Isolated real app-server title changes while a loopback model response is held.
// No user login, real provider, user chat or desktop UI is accessed.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readWorkTitles} from '../electron/work-titles.mjs';
const moduleRoot=process.env.PAWPRINT_RUNTIME_MODULE_ROOT||path.resolve('electron');
const {CodexIdentityBridge}=await import(pathToFileURL(path.join(moduleRoot,'codex-identity-bridge.mjs')));
const {CodexProviderTitles,CodexTitleClient,findCodexBinary}=await import(pathToFileURL(path.join(moduleRoot,'codex-provider-titles.mjs')));
const root=await mkdtemp(path.join(os.tmpdir(),'paw-title-latency-')),dataDirectory=path.join(root,'pawprint');
const providerId='pawprint_'+'b'.repeat(32),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bridge,titles,client,child,heldResponse,heldRequest,threadId,output='',errors='';
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 if(req.url==='/upstream/v1/responses'){heldResponse=res;heldRequest=JSON.parse(Buffer.concat(chunks));return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({models:[],data:[]}));
});
async function until(check,label){const start=Date.now();while(Date.now()-start<12000){const value=await check();if(value)return value;await sleep(20);}throw Error('Timed out: '+label+' '+errors.slice(-300));}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 titles=new CodexProviderTitles({directory:root,dataDirectory});
 bridge=new CodexIdentityBridge({dataDirectory,keychain:{get:async()=> 'dummy-provider-key'},onRoute:()=>void titles.refresh()});
 bridge.configure([{id:providerId,baseUrl:origin+'/upstream/v1'}]);await bridge.start();
 await writeFile(path.join(root,'config.toml'),`model="gpt-6.1-sol"\nmodel_provider="openai"\nopenai_base_url="${bridge.baseUrl(providerId)}"\nchatgpt_base_url="${origin}/backend-api"\ncli_auth_credentials_store="file"\n[features]\napps=false\nplugins=false\nremote_models=false\n[analytics]\nenabled=false\n`);
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'dummy-isolated-login'}),{mode:0o600});
 await writeFile(path.join(dataDirectory,'codex-accounts.json'),JSON.stringify({providers:[{id:providerId,name:'Test gateway'}]}));
 await titles.load();titles.start();
 const env={...process.env,CODEX_HOME:root};delete env.OPENAI_BASE_URL;delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
 child=spawn(await findCodexBinary(),['exec','--json','--skip-git-repo-check','-C',root,'Reply with OK; do not use tools.'],{env,stdio:['ignore','pipe','pipe']});
 const exited=new Promise(r=>child.once('exit',r));
 let buffer='';child.stdout.on('data',b=>{output+=b;buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const event=JSON.parse(line);if(event.type==='thread.started')threadId=event.thread_id;}catch{}}});child.stderr.on('data',b=>errors+=b);
 await until(()=>threadId&&heldResponse,'native model request');
 client=await new CodexTitleClient({binary:await findCodexBinary(),directory:root}).connect();
 const started=Date.now();await client.request('thread/name/set',{threadId,name:'Immediate title'});
 const title=await until(async()=>(await readWorkTitles(root,[threadId]))[0]?.title?.startsWith('[Test gateway] ')?(await readWorkTitles(root,[threadId]))[0].title:null,'early provider prefix');
 const latencyMs=Date.now()-started;assert.equal(title,'[Test gateway] Immediate title');assert.equal(heldResponse.headersSent,false);assert.ok(latencyMs<3000);
 const item={id:'msg_early',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PAWPRINT_EARLY_TITLE_OK',annotations:[]}]};
 const response={id:'resp_early',object:'response',created_at:Math.floor(Date.now()/1000),model:heldRequest.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 heldResponse.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])heldResponse.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
 heldResponse.end();assert.equal(await exited,0);assert.match(output,/PAWPRINT_EARLY_TITLE_OK/);
 console.log(JSON.stringify({passed:true,title,latencyMs,prefixedBeforeAnyProviderResponse:true},null,2));
}finally{
 if(child?.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
 await client?.close();await titles?.close();await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
