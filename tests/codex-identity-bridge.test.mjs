import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import path from 'node:path';import os from 'node:os';
import {zstdCompressSync,gzipSync,deflateSync,brotliCompressSync,zstdDecompressSync,gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {CodexIdentityBridge,hasFileChatGPTLogin} from '../electron/codex-identity-bridge.mjs';
import {readRouteEvidence,readTurnRoutes,nativeTurnId} from '../electron/codex-route-evidence.mjs';
const id='pawprint_'+ 'a'.repeat(32);
test('stale file credentials do not override an explicitly selected system or ephemeral credential store',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-login-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(path.join(directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy',id_token:'dummy'}}));
 for(const store of ['keyring','ephemeral','file']){await writeFile(path.join(directory,'config.toml'),`cli_auth_credentials_store="${store}"\n`);assert.equal(await hasFileChatGPTLogin(directory),store==='file');}
});
async function setup(t,respond){
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-identity-test-')),seen=[];
 const upstream=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{seen.push({headers:req.headers,path:req.url,body});if(respond){respond(req,res,body);return;}if(req.url.includes('redirect')){res.writeHead(302,{Location:'https://never.example'});res.end();return;}res.writeHead(200,{'Content-Type':req.url.endsWith('compact')?'application/json':'text/event-stream','Set-Cookie':'UPSTREAM_COOKIE'});res.end(req.url.endsWith('compact')?'{}':'event: response.completed\ndata: {"ok":true}\n\n');});});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const keychain={get:async account=>{assert.equal(account,id);return 'THIRD_PARTY_KEY';}};
 const bridge=new CodexIdentityBridge({dataDirectory:directory,keychain});
 const provider={id,name:'Local test provider',model:'test-model',modelSelection:'fixed',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`};bridge.configure([provider]);await bridge.start();
 t.after(async()=>{await bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(directory,{recursive:true,force:true});});
 return {directory,seen,bridge,provider,keychain};
}
function postRaw(url,headers,body){return new Promise((resolve,reject)=>{const req=http.request(url,{method:'POST',headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);});req.on('error',reject);req.end(body);});}
test('additional-tools and future protocol headers survive without individual allowlisting',async t=>{
 const f=await setup(t,(req,res,body)=>{
  if(body.includes('additional_tools')&&req.headers['x-openai-internal-codex-responses-lite']!=='true'){res.writeHead(400,{'Content-Type':'application/json'});res.end('additional_tools requires x-openai-internal-codex-responses-lite=true.');return;}
  res.writeHead(200,{'Content-Type':'application/json','X-Request-ID':'request-1','X-Models-Etag':'catalog-1','Retry-After':'2','X-Future-Response-Feature':'enabled'});res.end('{"ok":true}');
 });
 const body=JSON.stringify({model:'test-model',input:[{type:'additional_tools',tools:[]}]});
 const rejected=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body});assert.equal(rejected.status,400);assert.match(await rejected.text(),/requires/);
 const headers={'Content-Encoding':'zstd','Content-Type':'application/json','Accept':'application/json','x-openai-internal-codex-responses-lite':'true','x-codex-beta-features':'tool-search','x-future-request-feature':'enabled'};
 const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers,body:zstdCompressSync(Buffer.from(body))});assert.equal(r.status,200);assert.equal(await r.text(),'{"ok":true}');
 for(const name of ['x-openai-internal-codex-responses-lite','x-codex-beta-features','x-future-request-feature','accept'])assert.equal(f.seen.at(-1).headers[name],headers[name]??headers.Accept);
 assert.equal(r.headers.get('x-request-id'),'request-1');assert.equal(r.headers.get('x-models-etag'),'catalog-1');assert.equal(r.headers.get('retry-after'),'2');assert.equal(r.headers.get('x-future-response-feature'),'enabled');
});
test('request framing is recomputed and Connection-nominated headers are removed in both directions',async t=>{
 const f=await setup(t,(req,res)=>{res.writeHead(200,{'Content-Type':'application/json','Connection':'keep-alive, X-Hop-Response','X-Hop-Response':'PRIVATE_HOP','Set-Cookie':['PRIVATE_COOKIE=1','PRIVATE_COOKIE=2'],'X-Provider-Token':'PRIVATE_TOKEN','X-Request-ID':'visible'});res.end('{}');});
 const body=gzipSync(Buffer.from(JSON.stringify({model:'a-much-longer-picker-model',input:'中文'})));
 const r=await postRaw(f.bridge.baseUrl(id)+'/responses',{'Connection':'keep-alive, X-Hop-Request','X-Hop-Request':'PRIVATE_HOP','Proxy-Authorization':'PRIVATE_PROXY','OpenAI-Project':'PRIVATE_PROJECT','X_API_KEY':'PRIVATE_KEY','Content-Encoding':'gzip','Content-Length':body.length,'Content-MD5':'stale-digest'},body);
 assert.equal(r.status,200);const upstream=f.seen.at(-1);assert.equal(upstream.headers.host,new URL(f.provider.baseUrl).host);assert.equal(Number(upstream.headers['content-length']),Buffer.byteLength(upstream.body));assert.equal(JSON.parse(upstream.body).model,'test-model');
 for(const name of ['x-hop-request','proxy-authorization','openai-project','x_api_key','content-encoding','content-md5'])assert.equal(upstream.headers[name],undefined);
 assert.equal(upstream.headers.authorization,'Bearer THIRD_PARTY_KEY');assert.ok(!JSON.stringify(upstream.headers).includes('PRIVATE_'));
 for(const name of ['x-hop-response','set-cookie','x-provider-token'])assert.equal(r.headers[name],undefined);assert.equal(r.headers['x-request-id'],'visible');assert.equal(r.headers['cache-control'],'no-store');
});
test('compressed provider responses retain matching encoded bytes and framing',async t=>{
 const plain=Buffer.from('{"reply":"包含中文的响应"}');let encoded,codec;
 const f=await setup(t,(_,res)=>{res.writeHead(200,{'Content-Type':'application/json','Content-Encoding':codec,'Content-Length':encoded.length,'X-Request-ID':'compressed'});res.end(encoded);});
 for(const [encoding,compress,decompress] of [['gzip',gzipSync,gunzipSync],['deflate',deflateSync,inflateSync],['br',brotliCompressSync,brotliDecompressSync],['zstd',zstdCompressSync,zstdDecompressSync]]){
  codec=encoding;encoded=compress(plain);
  const r=await postRaw(f.bridge.baseUrl(id)+'/responses',{'Accept-Encoding':encoding},Buffer.from('{}'));
  assert.equal(r.status,200);assert.equal(r.headers['content-encoding'],encoding);assert.equal(Number(r.headers['content-length']),encoded.length);assert.deepEqual(r.body,encoded);assert.deepEqual(decompress(r.body),plain);assert.equal(f.seen.at(-1).headers['accept-encoding'],encoding);
 }
 // A fetch client decodes the response once, after the proxy preserves it.
 codec='gzip';encoded=gzipSync(plain);const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'});assert.equal(await r.text(),plain.toString());
});
test('SSE chunks reach the client before the provider finishes its response',{timeout:3000},async t=>{
 let finish;
 const f=await setup(t,(_,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream','X-Future-Streaming-Feature':'on'});res.write('data: first\n\n');finish=()=>res.end('data: last\n\n');});
 const response=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'}),reader=response.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));
 assert.equal(response.headers.get('x-future-streaming-feature'),'on');assert.match(Buffer.from((await reader.read()).value).toString(),/first/);finish();let rest='';for(;;){const chunk=await reader.read();if(chunk.done)break;rest+=Buffer.from(chunk.value);}assert.match(rest,/last/);
});
test('a disconnected streaming client cancels the actual upstream HTTP response',{timeout:3000},async t=>{
 let disconnected;const closed=new Promise(r=>disconnected=r);
 const f=await setup(t,(_,res)=>{res.on('close',disconnected);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: first\n\n');});
 const controller=new AbortController();const response=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}',signal:controller.signal}),reader=response.body.getReader();
 t.after(()=>reader.cancel().catch(()=>{}));await reader.read();controller.abort();await closed;
});
test('local bridge replaces provider authentication and never forwards ChatGPT identity or cookies',async t=>{
 const f=await setup(t);
 const response=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{Authorization:'Bearer PRIVATE_CHATGPT_TOKEN','ChatGPT-Account-ID':'PRIVATE_ACCOUNT',Cookie:'PRIVATE_COOKIE','X-Custom-Access-Token':'PRIVATE_HEADER','OpenAI-Organization':'PRIVATE_ORG','OpenAI-Project':'PRIVATE_PROJECT','X-Agent-Identity':'PRIVATE_IDENTITY'},body:JSON.stringify({model:'test-model',input:'user-request'})});
 assert.equal(response.status,200);assert.match(await response.text(),/response.completed/);assert.equal(response.headers.get('set-cookie'),null);assert.equal(f.seen.length,1);assert.equal(f.seen[0].headers.authorization,'Bearer THIRD_PARTY_KEY');assert.equal(f.seen[0].path,'/v1/responses');assert.ok(!JSON.stringify(f.seen).includes('PRIVATE_'));
 assert.ok(!(await readFile(f.bridge.file,'utf8')).includes('TOKEN'));assert.ok(!(await readFile(f.bridge.file,'utf8')).includes('THIRD_PARTY_KEY'));if(process.platform!=='win32')assert.equal((await stat(f.bridge.file)).mode&0o777,0o600);
 const compact=await fetch(f.bridge.baseUrl(id)+'/responses/compact',{method:'POST',body:'{}'});assert.equal(compact.status,200);assert.equal(await compact.text(),'{}');assert.equal(f.seen[1].path,'/v1/responses/compact');
});
test('observed routes retain only thread/provider/model metadata for native OpenAI-labelled chats',async t=>{
 const f=await setup(t),threadId='01a0f1ea-4534-7651-b950-000000000001';
 const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'thread-id':threadId,Authorization:'Bearer PRIVATE_LOGIN',Cookie:'PRIVATE_COOKIE'},body:JSON.stringify({model:'test-model',input:'PRIVATE_CONVERSATION'})});await r.text();
 for(let i=0;i<30&&!Object.keys(await readRouteEvidence(f.directory)).length;i++)await new Promise(r=>setTimeout(r,10));
 const evidence=await readRouteEvidence(f.directory);assert.equal(evidence[threadId].providerId,id);assert.equal(evidence[threadId].model,'test-model');assert.ok(Number.isSafeInteger(evidence[threadId].at));assert.ok(!JSON.stringify(evidence).includes('PRIVATE'));assert.ok(!JSON.stringify(evidence).includes(f.bridge.capability));
 await f.bridge.routeEvidence.record({threadId:'not-a-thread',providerId:id,model:'test'});assert.equal(Object.keys(await readRouteEvidence(f.directory)).length,1);
});
test('completed native turns retain their actual route without persisting other turn metadata',async t=>{
 const f=await setup(t),threadId='01a0f1ea-4534-7651-b950-000000000010',turnId='01a0f1ea-4534-7651-b950-000000000011';
 const headers={'thread-id':threadId,'x-codex-turn-metadata':JSON.stringify({thread_id:threadId,turn_id:turnId,installation_id:'PRIVATE_INSTALLATION',unrelated:'PRIVATE_METADATA'})};
 const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers,body:JSON.stringify({model:'picker-model'})});await r.text();await f.bridge.routeEvidence.queue;
 const routes=await readTurnRoutes(f.directory);assert.equal(routes[threadId+':'+turnId].model,'test-model');assert.equal(routes[threadId+':'+turnId].providerId,id);assert.ok(!JSON.stringify(routes).includes('PRIVATE'));
 assert.equal(nativeTurnId({...headers,'thread-id':turnId}),null);assert.equal(nativeTurnId({...headers,'x-codex-turn-metadata':'invalid'}),null);
 await f.bridge.routeEvidence.recordTurn({threadId,turnId,providerId:id,model:'different-model'});assert.equal((await readTurnRoutes(f.directory))[threadId+':'+turnId].ambiguous,true);
});
test('failed HTTP attempts label titles without becoming successful-turn usage mappings',async t=>{
 const f=await setup(t,(_,res)=>{res.writeHead(400);res.end('Rejected');}),threadId='01a0f1ea-4534-7651-b950-000000000012',turnId='01a0f1ea-4534-7651-b950-000000000013';
 const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'thread-id':threadId,'x-codex-turn-metadata':JSON.stringify({thread_id:threadId,turn_id:turnId})},body:'{}'});assert.equal(r.status,400);await r.text();await f.bridge.routeEvidence.queue;
 assert.equal((await readRouteEvidence(f.directory))[threadId].providerId,id);assert.deepEqual(await readTurnRoutes(f.directory),{});
});
test('route observation is published before the provider sends any response headers', {timeout:3000},async t=>{
 const f=await setup(t),threadId='01a0f1ea-4534-7651-b950-000000000002';
 let dispatched=false,release,routeReady;const routed=new Promise(r=>routeReady=r);
 f.bridge.onRoute=()=>routeReady();
 f.bridge.fetchImpl=(_,options)=>{dispatched=true;return new Promise((resolve,reject)=>{release=()=>resolve(new Response('mock-stream'));options.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});};
 const response=fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'thread-id':threadId},body:JSON.stringify({model:'test-model'})});
 t.after(()=>response.catch(()=>{}));
 await routed;assert.equal(dispatched,true);
 const evidence=await readRouteEvidence(f.directory);assert.equal(evidence[threadId].providerId,id);
 release();assert.equal(await (await response).text(),'mock-stream');
});
test('a failed provider response still identifies the attempted destination for the chat title',async t=>{
 const f=await setup(t),threadId='01a0f1ea-4534-7651-b950-000000000003';
 let ready;const routed=new Promise(r=>ready=r);f.bridge.onRoute=()=>ready();f.bridge.fetchImpl=async()=>new Response('Service unavailable',{status:503});
 const response=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'thread-id':threadId},body:JSON.stringify({model:'test-model'})});assert.equal(response.status,503);await response.text();await routed;
 assert.equal((await readRouteEvidence(f.directory))[threadId].providerId,id);
});
test('compressed native ChatGPT requests are decoded before JSON parsing and provider forwarding',async t=>{
 const f=await setup(t),body=JSON.stringify({model:'test-model',input:'压缩后的请求',stream:true});
 for(const [encoding,compress] of [['zstd',zstdCompressSync],['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]]){
  const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'Content-Encoding':encoding,Authorization:'Bearer PRIVATE_CHATGPT_TOKEN','ChatGPT-Account-ID':'PRIVATE_ACCOUNT'},body:compress(Buffer.from(body))});
  assert.equal(r.status,200,encoding+': '+await r.text());
  const upstream=f.seen.at(-1);assert.equal(upstream.body,body);assert.equal(upstream.headers['content-encoding'],undefined);assert.equal(upstream.headers.authorization,'Bearer THIRD_PARTY_KEY');assert.ok(!JSON.stringify(upstream).includes('PRIVATE_'));
 }
 const compact=await fetch(f.bridge.baseUrl(id)+'/responses/compact',{method:'POST',headers:{'Content-Encoding':'zstd'},body:zstdCompressSync(Buffer.from(body))});assert.equal(compact.status,200);await compact.text();assert.equal(f.seen.at(-1).path,'/v1/responses/compact');assert.equal(f.seen.at(-1).body,body);
});
test('connection model overrides the picker, titles and compaction, including compressed requests',async t=>{
 const f=await setup(t),threadId='01a0f1ea-4534-7651-b950-000000000004';
 f.bridge.configure([{...f.provider,model:'mimo-v2.6-pro'}]);
 const original={model:'gpt-6.1-sol',input:[{role:'user',content:'hello'}],stream:true,tools:[],reasoning:{effort:'low'}};
 for(const [endpoint,model,compressed] of [['responses','gpt-6.1-sol',false],['responses','gpt-6-luna',true],['responses/compact','gpt-6.1-sol',true]]){
  const request={...original,model},body=JSON.stringify(request);
  const r=await fetch(f.bridge.baseUrl(id)+'/'+endpoint,{method:'POST',headers:{'thread-id':threadId,...(compressed?{'Content-Encoding':'zstd'}:{})},body:compressed?zstdCompressSync(Buffer.from(body)):body});
  assert.equal(r.status,200);await r.text();assert.deepEqual(JSON.parse(f.seen.at(-1).body),{...request,model:'mimo-v2.6-pro'});
 }
 await f.bridge.routeEvidence.queue;assert.equal((await readRouteEvidence(f.directory))[threadId].model,'mimo-v2.6-pro');
});
test('listed models and unknown list status retain the picker, title and compaction model',async t=>{
 const f=await setup(t);
 for(const modelSelection of ['picker','unknown']){
  f.bridge.configure([{...f.provider,model:'gpt-6.1-sol',modelSelection}]);
  for(const [endpoint,model] of [['responses','gpt-6-astra'],['responses','gpt-6-luna'],['responses/compact','gpt-6-astra']]){
   const body=JSON.stringify({model,input:'hello',reasoning:{effort:'high'}});
   const r=await fetch(f.bridge.baseUrl(id)+'/'+endpoint,{method:'POST',headers:{'Content-Encoding':'zstd'},body:zstdCompressSync(Buffer.from(body))});assert.equal(r.status,200);await r.text();assert.equal(f.seen.at(-1).body,body);
  }
 }
});
test('an in-flight request retains its captured connection model across configuration updates',async t=>{
 const f=await setup(t);let release,started;
 const ready=new Promise(r=>started=r);f.bridge.keychain.get=async()=>{started();return new Promise(r=>release=()=>r('THIRD_PARTY_KEY'));};
 const request=fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:JSON.stringify({model:'picker-model'})});
 await ready;f.bridge.configure([{...f.provider,model:'updated-model'}]);release();
 const r=await request;assert.equal(r.status,200);await r.text();assert.equal(JSON.parse(f.seen.at(-1).body).model,'test-model');
 f.bridge.keychain.get=async()=> 'THIRD_PARTY_KEY';const next=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'});await next.text();assert.equal(JSON.parse(f.seen.at(-1).body).model,'updated-model');
});
test('each provider route keeps its own model when more connections are registered',async t=>{
 const f=await setup(t),second={...f.provider,id:'pawprint_'+'b'.repeat(32),model:'mimo-v2.6-pro'};
 f.bridge.configure([f.provider,second]);f.bridge.keychain.get=async()=> 'THIRD_PARTY_KEY';
 for(const provider of [second,f.provider]){const r=await fetch(f.bridge.baseUrl(provider.id)+'/responses',{method:'POST',body:JSON.stringify({model:'gpt-6-luna'})});assert.equal(r.status,200);await r.text();assert.equal(JSON.parse(f.seen.at(-1).body).model,provider.model);}
});
test('non-object JSON cannot be forwarded or billed as a model request',async t=>{
 const f=await setup(t);let keyReads=0;f.bridge.keychain.get=async()=>{keyReads++;return 'THIRD_PARTY_KEY';};
 for(const body of ['null','[]','1','"text"']){const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body});assert.equal(r.status,400);await r.text();}
 assert.equal(keyReads,0);assert.equal(f.seen.length,0);
});
test('invalid, unsupported and oversized compressed requests never reach the provider',async t=>{
 const f=await setup(t);let keyReads=0;f.keychain.get=async()=>{keyReads++;return 'THIRD_PARTY_KEY';};
 const cases=[
  ['zstd',Buffer.from('not-compressed'),400],
  ['zstd',zstdCompressSync(Buffer.from('not-json')),400],
  ['unknown',Buffer.from('{}'),415],
  ['gzip, zstd',Buffer.from('{}'),415],
  ['zstd',zstdCompressSync(Buffer.alloc(32*1024*1024+1,32)),413],
 ];
 for(const [encoding,body,status] of cases){const r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'Content-Encoding':encoding},body});assert.equal(r.status,status);assert.ok(!(await r.text()).includes('THIRD_PARTY_KEY'));}
 assert.equal(f.seen.length,0);assert.equal(keyReads,0);
});
test('unknown routes, websites and removed providers cannot use the bridge',async t=>{
 const f=await setup(t),url=f.bridge.baseUrl(id)+'/responses';
 for(const [target,options,status] of [[url.replace(f.bridge.capability,'0'.repeat(64)),{method:'POST',body:'{}'},404],[url,{method:'GET'},404],[url,{method:'POST',headers:{Origin:'https://website.example'},body:'{}'},403],[url,{method:'POST',body:'not-json'},400]]){
  const r=await fetch(target,options);assert.equal(r.status,status);await r.text();
 }
 f.bridge.configure([]);const r=await fetch(url,{method:'POST',body:'{}'});assert.equal(r.status,404);await r.text();assert.equal(f.seen.length,0);
});
test('bridge address survives Pawprint restarts and an occupied port is never silently replaced',async t=>{
 const f=await setup(t),url=f.bridge.baseUrl(id);
 const occupied=new CodexIdentityBridge({dataDirectory:f.directory,keychain:f.keychain});await assert.rejects(occupied.start(),/未能启动/);
 await f.bridge.close();const restarted=new CodexIdentityBridge({dataDirectory:f.directory,keychain:f.keychain});t.after(()=>restarted.close());restarted.configure([f.provider]);await restarted.start();assert.equal(restarted.baseUrl(id),url);
 const r=await fetch(url+'/responses',{method:'POST',body:'{}'});assert.equal(r.status,200);await r.text();
});
test('redirects and credential errors do not leak keys or follow an unapproved destination',async t=>{
 const f=await setup(t);f.bridge.configure([{...f.provider,baseUrl:f.provider.baseUrl+'/redirect'}]);
 let r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'});assert.equal(r.status,502);assert.match(await r.text(),/redirects/);assert.equal(f.seen.length,1);
 f.bridge.keychain.get=async()=>{throw Error('PRIVATE_KEYCHAIN_DETAIL');};r=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('PRIVATE'));assert.equal(f.seen.length,1);
});
test('closing Pawprint aborts an in-flight upstream request instead of leaving it running',async t=>{
 const f=await setup(t);let started,aborted=false;const ready=new Promise(r=>started=r);
 f.bridge.fetchImpl=async(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});started();});
 const request=fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',body:'{}'}).catch(()=>null);await ready;await f.bridge.close();await request;assert.equal(aborted,true);assert.equal(f.seen.length,0);
});
