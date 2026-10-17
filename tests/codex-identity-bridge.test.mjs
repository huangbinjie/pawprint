import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import path from 'node:path';import os from 'node:os';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {CodexIdentityBridge,hasFileChatGPTLogin} from '../electron/codex-identity-bridge.mjs';
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
