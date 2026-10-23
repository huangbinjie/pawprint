// Real native ChatGPT-auth transport with dummy JWTs and loopback-only mocks.
// No real login, provider key, user profile or model service is used.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {findCodexBinary} from '../electron/codex-provider-titles.mjs';

const {CodexIdentityBridge}=await import(process.env.PAWPRINT_BRIDGE_MODULE?pathToFileURL(process.env.PAWPRINT_BRIDGE_MODULE).href:'../electron/codex-identity-bridge.mjs');
const root=await mkdtemp(path.join(os.tmpdir(),'paw-native-compression-'));
const officialMode=process.env.PAWPRINT_TEST_OFFICIAL_ROUTE==='1';
const account='dummy-isolated-account',providerId='pawprint_'+'a'.repeat(32);
const incoming=[],forwarded=[];let child,bridge,timer;
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const body=Buffer.concat(chunks);
 if(req.url==='/upstream/v1/responses'){
  const request=JSON.parse(body.toString());
  forwarded.push({model:request.model,encoding:req.headers['content-encoding']??null,providerKey:req.headers.authorization==='Bearer dummy-provider-key',identityLeaked:JSON.stringify(req.headers).includes('dummy-isolated')||JSON.stringify(req.headers).includes('eyJhbGci')});
  const item={id:'msg_compression',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PAWPRINT_COMPRESSION_OK',annotations:[]}]};
  const response={id:'resp_compression',object:'response',created_at:Math.floor(Date.now()/1000),model:request.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'PAWPRINT_COMPRESSION_OK'},{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:'PAWPRINT_COMPRESSION_OK'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
  for(const [sequence_number,event] of events.entries())res.write(`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number})}\n\n`);
  res.end();return;
 }
 const origin=`http://127.0.0.1:${server.address().port}`;
 const record={id:account,account_id:account,name:'Isolated',plan_type:'plus',structure:'personal',is_deactivated:false,workspace_backend_origin:origin};
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify(req.url.includes('/accounts/check')?{accounts:[record],account_ordering:[account]}:{models:[],data:[]}));
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 bridge=new CodexIdentityBridge({dataDirectory:path.join(root,'pawprint'),keychain:{get:async()=> 'dummy-provider-key'}});
 bridge.configure([{id:providerId,baseUrl:origin+'/upstream/v1',model:'gpt-6.1-sol',modelSelection:'picker'}],{officialBaseUrl:origin+'/upstream/v1'});await bridge.start();
 await bridge.prepareBindings({directory:root,currentProviderId:officialMode?'openai':providerId});
 bridge.server.prependListener('request',req=>incoming.push({method:req.method,encoding:req.headers['content-encoding']??null}));
 await writeFile(path.join(root,'config.toml'),`model="gpt-6.1-sol"\nmodel_provider="openai"\nopenai_base_url="${bridge.baseUrl(officialMode?'openai':providerId)}"\nchatgpt_base_url="${origin}/backend-api"\ncli_auth_credentials_store="file"\n[features]\nenable_request_compression=true\nremote_models=false\napps=false\nplugins=false\n[analytics]\nenabled=false\n`);
 const claims={sub:'dummy-user',exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:account,chatgpt_user_id:'dummy-user',chatgpt_plan_type:'plus'}};
 const jwt='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.dummy';
 await writeFile(path.join(root,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt,id_token:jwt,refresh_token:'dummy',account_id:account},last_refresh:new Date().toISOString()}),{mode:0o600});
 const env={...process.env,CODEX_HOME:root};for(const k of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL'])delete env[k];
 child=spawn(await findCodexBinary(),['exec','--json','--ephemeral','--skip-git-repo-check','-C',root,'Reply with OK; do not use tools.'],{env,stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 const code=await Promise.race([new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native compression probe timed out')),20000);})]);
 assert.ok(incoming.some(r=>r.method==='POST'&&r.encoding==='zstd'),'Native ChatGPT client must send Zstd');
 assert.equal(code,0,output.slice(-800)+'\n'+errors.slice(-800));
 assert.match(output,/PAWPRINT_COMPRESSION_OK/);assert.ok(forwarded.length>0);
 assert.ok(forwarded.every(r=>r.encoding===null&&r.providerKey===!officialMode&&r.identityLeaked===officialMode&&r.model==='gpt-6.1-sol'));
 console.log(JSON.stringify({nativeAuth:'dummy-chatgpt',route:officialMode?'official':'third-party',incoming,forwarded,reply:'PAWPRINT_COMPRESSION_OK',passed:true},null,2));
}finally{
 clearTimeout(timer);
 if(child?.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
 await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
}
