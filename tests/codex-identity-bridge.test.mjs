import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import path from 'node:path';import os from 'node:os';
import {zstdCompressSync,gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {CodexIdentityBridge,hasFileChatGPTLogin} from '../electron/codex-identity-bridge.mjs';
import {readRouteEvidence} from '../electron/codex-route-evidence.mjs';
const id='pawprint_'+ 'a'.repeat(32);
test('stale file credentials do not override an explicitly selected system or ephemeral credential store',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-login-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(path.join(directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy',id_token:'dummy'}}));
 for(const store of ['keyring','ephemeral','file']){await writeFile(path.join(directory,'config.toml'),`cli_auth_credentials_store="${store}"\n`);assert.equal(await hasFileChatGPTLogin(directory),store==='file');}
});
async function setup(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-identity-test-')),seen=[];
 const upstream=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{seen.push({headers:req.headers,path:req.url,body});if(req.url.includes('redirect')){res.writeHead(302,{Location:'https://never.example'});res.end();return;}res.writeHead(200,{'Content-Type':req.url.endsWith('compact')?'application/json':'text/event-stream','Set-Cookie':'UPSTREAM_COOKIE'});res.end(req.url.endsWith('compact')?'{}':'event: response.completed\ndata: {"ok":true}\n\n');});});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const keychain={get:async account=>{assert.equal(account,id);return 'THIRD_PARTY_KEY';}};
 const bridge=new CodexIdentityBridge({dataDirectory:directory,keychain});
 const provider={id,name:'Local test provider',model:'test-model',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`};bridge.configure([provider]);await bridge.start();
 t.after(async()=>{await bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(directory,{recursive:true,force:true});});
 return {directory,seen,bridge,provider,keychain};
}
test('local bridge replaces provider authentication and never forwards ChatGPT identity or cookies',async t=>{
 const f=await setup(t);
 const response=await fetch(f.bridge.baseUrl(id)+'/responses',{method:'POST',headers:{Authorization:'Bearer PRIVATE_CHATGPT_TOKEN','ChatGPT-Account-ID':'PRIVATE_ACCOUNT',Cookie:'PRIVATE_COOKIE','X-Private':'PRIVATE_HEADER'},body:JSON.stringify({model:'test-model',input:'user-request'})});
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
