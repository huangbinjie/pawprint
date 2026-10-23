import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, stat, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';
import {CodexAccounts, MacKeychain, validateProvider, patchConfig} from '../electron/codex-accounts.mjs';
const login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'PRIVATE_ACCESS',id_token:'PRIVATE_ID'}});
const readModels=async()=>({status:'available',models:['gpt-6.1-sol','gpt-6-astra','gpt-6-luna']});
const input = {name:'My Provider',baseUrl:'https://example.com/v1',model:'example-model',apiKey:'test-secret'};
async function fixture(t, original = '# My settings\nmodel = "gpt-original" # keep\nmodel_provider = "openai"\napproval_policy = "on-request"\n[projects."/my/project"]\ntrust_level = "trusted"\n') {
  const root = await mkdtemp(path.join(os.tmpdir(),'paw-accounts-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const directory = path.join(root,'codex'), dataDirectory = path.join(root,'data'); await mkdir(directory);
  await writeFile(path.join(directory,'config.toml'),original); await writeFile(path.join(directory,'auth.json'),login);
  const secrets = new Map(), keychain = {set:async(id,key)=>secrets.set(id,key),get:async id=>{if(!secrets.has(id))throw Error('keychain unavailable');return secrets.get(id);},remove:async id=>secrets.delete(id)};
  let running = false;
  const bridge={sessionRouting:true,prepareBindings:async()=>{},start:async()=>{},configure:()=>{},baseUrl:id=>`http://127.0.0.1:12345/local/${id}/v1`};
  const manager = new CodexAccounts({readModels,directory,dataDirectory,keychain,identityBridge:bridge,running:async()=>running,platform:'darwin'});await manager.load();
  return {manager,directory,dataDirectory,secrets,setRunning:value=>running=value,original};
}
test('switch round trip preserves unrelated settings, comments, login and excludes secrets',async t=>{
  const f=await fixture(t), added=await f.manager.add(input), id=added.providers[0].id;
  const switched=await f.manager.switch(id), text=await readFile(f.manager.file,'utf8'), config=parse(text);
  assert.equal(config.model_provider,'openai');assert.equal(config.model,'example-model');assert.equal(config.model_providers[id].requires_openai_auth,true);assert.equal(config.openai_base_url,f.manager.identityBridge.baseUrl(id));
  assert.ok(text.includes('[projects."/my/project"]\ntrust_level = "trusted"'));assert.ok(!text.includes(input.apiKey));
  assert.equal(await readFile(switched.backupPath,'utf8'),f.original);if(process.platform!=='win32')assert.equal((await stat(switched.backupPath)).mode & 0o777,0o600);
  assert.ok(!(await readFile(f.manager.stateFile,'utf8')).includes(input.apiKey));
  await f.manager.switch('openai');const restored=parse(await readFile(f.manager.file,'utf8'));assert.ok(restored.model_providers[id]);delete restored.model_providers;assert.equal(restored.openai_base_url,f.manager.identityBridge.baseUrl('openai'));delete restored.openai_base_url;assert.deepEqual(restored,parse(f.original));assert.ok((await readFile(f.manager.file,'utf8')).includes('model = "gpt-original" # keep'));
  assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
});
test('model policy follows exact native list membership without changing OpenAI identity or adding settings',async t=>{
 const f=await fixture(t);let configured;f.manager.identityBridge.configure=providers=>configured=providers;
 const native=(await f.manager.add({...input,model:'gpt-6.1-sol'})).providers[0];
 await f.manager.switch(native.id);assert.equal((await f.manager.status()).providers[0].modelSelection,'picker');assert.equal(configured[0].modelSelection,'picker');
 const vendor=(await f.manager.add({...input,name:'MiMo',model:'mimo-v2.6-pro'})).providers[1];await f.manager.switch(vendor.id);
 let status=await f.manager.status();assert.equal(status.runtimeProvider,'openai');assert.equal(status.providers[1].modelSelection,'fixed');assert.equal(configured[1].modelSelection,'fixed');
 assert.ok(!JSON.stringify(f.manager.state.providers).includes('modelSelection'));
 f.manager.readModels=async()=>{throw Error('unavailable');};status=await f.manager.status({refreshModels:true});assert.ok(status.providers.every(p=>p.modelSelection==='unknown'));assert.ok(configured.every(p=>p.modelSelection==='unknown'));
 f.manager.readModels=async()=>({status:'available',models:['mimo-v2.6-pro']});status=await f.manager.status({refreshModels:true});assert.equal(status.providers[0].modelSelection,'fixed');assert.equal(status.providers[1].modelSelection,'picker');
 assert.equal(parse(await readFile(f.manager.file,'utf8')).model_catalog_json,undefined);
});
test('switch defaults while Codex runs and reject external managed changes',async t=>{
  const f=await fixture(t), id=(await f.manager.add(input)).providers[0].id;f.setRunning(true);
  assert.equal((await f.manager.switch(id)).selected,id);assert.equal((await f.manager.switch('openai')).selected,'openai');
  await f.manager.switch(id);await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('name = "My Provider"','name = "Changed"'));
  await assert.rejects(f.manager.switch('openai'),/外部修改/);
});
test('preserve external changes outside managed fields and handle multiple providers and deletion',async t=>{
  const f=await fixture(t), a=(await f.manager.add(input)).providers[0].id,b=(await f.manager.add({...input,name:'Second'})).providers[1].id;
  await f.manager.switch(a);
  await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('on-request','never'));
  await f.manager.switch(b);const changed=parse(await readFile(f.manager.file,'utf8'));assert.equal(changed.approval_policy,'never');assert.ok(changed.model_providers[a]);assert.ok(changed.model_providers[b]);
  await f.manager.remove(a);assert.equal(f.secrets.has(a),false);await f.manager.switch('openai');assert.equal(parse(await readFile(f.manager.file,'utf8')).approval_policy,'never');
});
test('refuse profiles, existing external providers, malformed TOML and unsafe URLs',async t=>{
  for(const config of ['profile = "work"\n','model_provider = "custom"\n']) {
    const f=await fixture(t,config);await f.manager.add(input);await assert.rejects(f.manager.switch(f.manager.state.providers[0].id));assert.equal(await readFile(f.manager.file,'utf8'),config);
  }
  const malformed=await fixture(t,'bad = [\n');await assert.rejects(malformed.manager.add(input),/格式无效/);assert.equal(malformed.secrets.size,0);
  for(const baseUrl of ['http://remote.example/v1','https://user:secret@example.com','https://example.com?key=secret','file:///tmp/secret'])assert.throws(()=>validateProvider({...input,baseUrl}));
  assert.equal(validateProvider({...input,baseUrl:'http://127.0.0.1:1234/v1/'}).baseUrl,'http://127.0.0.1:1234/v1');
});
test('restart reload and missing credentials do not overwrite config',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  const second = new CodexAccounts({readModels,directory:f.directory,dataDirectory:f.dataDirectory,keychain:f.manager.keychain,identityBridge:f.manager.identityBridge,running:async()=>false,platform:'darwin'});await second.load();assert.equal((await second.status()).selected,id);
  await second.switch('openai');f.secrets.clear();await assert.rejects(second.switch(id),/keychain/);assert.equal(parse(await readFile(second.file,'utf8')).model_provider,'openai');
});
test('quoted roots and deceptive multiline TOML cannot overwrite unrelated content',()=>{
  assert.throws(()=>patchConfig('"model" = "foo"\n',null,{model:null,model_provider:null}),/复杂/);
  assert.throws(()=>patchConfig('text = """\nmodel = "fake"\n"""\n',null,{model:null,model_provider:null}));
});
test('real macOS Keychain stdin storage and credential-command retrieval', {skip:process.env.PAWPRINT_KEYCHAIN_TEST!=='1'},async t=>{
  const keychain=new MacKeychain(),id='pawprint_'+(await import('node:crypto')).randomUUID().replaceAll('-','');
  t.after(()=>keychain.remove(id));await keychain.set(id,'dummy-test-key');assert.equal(await keychain.get(id),'dummy-test-key');
});
test('symbolic link config is rejected and lock protects concurrent manager processes',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;
  const {symlink}=await import('node:fs/promises');await rm(f.manager.file);const target=path.join(f.directory,'other.toml');await writeFile(target,f.original);await symlink(target,f.manager.file);
  await assert.rejects(f.manager.switch(id),/普通文件/);assert.equal(await readFile(target,'utf8'),f.original);
  await rm(f.manager.file);await writeFile(f.manager.file,f.original);await mkdir(path.join(f.directory,'.pawprint-account-lock'));
  await assert.rejects(f.manager.switch(id),/另一个切换/);
});
test('pending interrupted transaction resolves both before and after atomic config replacement',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;
  const before=await readFile(f.manager.file,'utf8'),next={...f.manager.state,backupPath:'recovered'};
  const after=patchConfig(before,f.manager.state.providers[0],{model:'model = "gpt-original" # keep\n',model_provider:'model_provider = "openai"\n'});
  await writeFile(f.manager.stateFile,JSON.stringify({...f.manager.state,pending:{before,after,next}}));
  await f.manager.load();assert.equal(f.manager.state.pending,undefined);assert.equal(f.manager.state.backupPath,undefined);
  await writeFile(f.manager.stateFile,JSON.stringify({...f.manager.state,pending:{before,after,next}}));await writeFile(f.manager.file,after);
  await f.manager.load();assert.equal(f.manager.state.backupPath,'recovered');assert.equal((await f.manager.status()).selected,id);
});
test('deleting selected provider restores ChatGPT and removes config definition and secret',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  const state=await f.manager.remove(id);assert.equal(state.selected,'openai');assert.equal(state.providers.length,0);assert.equal(state.providerNames[id],input.name);assert.equal(f.secrets.has(id),false);
  const restored=parse(await readFile(f.manager.file,'utf8'));assert.equal(restored.openai_base_url,f.manager.identityBridge.baseUrl('openai'));delete restored.openai_base_url;assert.deepEqual(restored,parse(f.original));assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
});
test('selected provider deletion refuses external config changes and preserves credentials',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('name = "My Provider"','name = "Changed"'));
  await assert.rejects(f.manager.remove(id),/外部修改/);assert.equal(f.secrets.has(id),true);assert.equal(f.manager.state.providers.length,1);
});
test('failed Keychain deletion restores the selected provider for retry',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  f.manager.keychain.remove=async()=>{throw Error('keychain locked');};await assert.rejects(f.manager.remove(id),/locked/);
  assert.equal((await f.manager.status()).selected,id);assert.equal(f.manager.state.providers.length,1);assert.equal(f.secrets.has(id),true);
});
test('unsupported platforms can read metadata without invoking macOS process inspection',async t=>{
 const f=await fixture(t);const manager=new CodexAccounts({readModels,directory:f.directory,dataDirectory:f.dataDirectory,platform:'win32',running:async()=>{throw Error('must not inspect macOS processes');}});
 await manager.load();const status=await manager.status();assert.equal(status.supported,false);assert.equal(status.running,false);assert.equal(status.selected,'openai');
});
test('Codex model picker changes do not block switching back to ChatGPT while running',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;f.setRunning(true);await f.manager.switch(id);
 await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('model = "example-model"','model = "gpt-from-picker"'));
 assert.equal((await f.manager.switch('openai')).selected,'openai');assert.equal(parse(await readFile(f.manager.file,'utf8')).model,'gpt-original');
 // Remember the most recently selected OpenAI model for the next round trip.
 await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('gpt-original','new-official-model'));
 await f.manager.switch(id);await f.manager.switch('openai');assert.equal(parse(await readFile(f.manager.file,'utf8')).model,'new-official-model');
});
test('an externally changed provider still prevents accidental overwrites',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 const modified=(await readFile(f.manager.file,'utf8')).replace('model_provider = "openai"','model_provider = "external-provider"');await writeFile(f.manager.file,modified);
 await assert.rejects(f.manager.switch('openai'),/外部修改/);assert.equal(await readFile(f.manager.file,'utf8'),modified);
});
test('equivalent provider formatting from the client does not count as a connection change',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('name = "My Provider"','name  =  "My Provider" # client formatting').replace('model_provider = "openai"','model_provider  =  "openai" # unchanged identity'));
 assert.equal((await f.manager.switch('openai')).selected,'openai');
});
test('switch readback precedes a scoped client refresh, including no-op retries and return to ChatGPT',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id,seen=[];
 f.manager.refreshClient=async({directory})=>{assert.equal(directory,f.directory);seen.push(parse(await readFile(f.manager.file,'utf8')).model_provider);return {status:'requested',indicatorVerified:true};};
 let status=await f.manager.switch(id);assert.equal(status.clientRefresh.status,'requested');assert.equal(status.clientRefresh.configurationVerified,true);assert.equal(status.clientRefresh.indicatorVerified,false);
 await f.manager.switch(id);status=await f.manager.switch('openai');assert.deepEqual(seen,['openai','openai','openai']);assert.equal(status.clientRefresh.providerId,'openai');
 assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
});
test('notification failure leaves a successful switch intact and reports an unconfirmed indicator',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;
 f.manager.refreshClient=async()=>{throw Error('private socket path');};
 const status=await f.manager.switch(id);assert.equal(status.selected,id);assert.equal(status.clientRefresh.status,'unavailable');assert.equal(status.clientRefresh.indicatorVerified,false);assert.match(status.clientRefresh.notice,/无法通知/);assert.ok(!JSON.stringify(status.clientRefresh).includes('private socket path'));
});
test('failed switches never notify, and a changed readback cannot claim a verified configuration',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;let calls=0;f.manager.refreshClient=async()=>{calls++;return {status:'requested'};};
 await f.manager.switch(id);const expected=await readFile(f.manager.file,'utf8'),changed=expected.replace('model_provider = "openai"','model_provider = "external-provider"');
 await writeFile(f.manager.file,changed);await assert.rejects(f.manager.switch('openai'),/外部修改/);assert.equal(calls,1);
 const result=await f.manager.finishSelection(id,expected);assert.equal(calls,1);assert.equal(result.selected,'external-provider');assert.equal(result.clientRefresh.status,'config-changed');assert.equal(result.clientRefresh.configurationVerified,false);
});
test('reviewed conflict recovery backs up the changed config and preserves login and unrelated settings',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 const changed=(await readFile(f.manager.file,'utf8')).replace('name = "My Provider"','name = "Changed"').replace('requires_openai_auth = true','requires_openai_auth = false').replace('on-request','never');await writeFile(f.manager.file,changed);
 const conflict=(await f.manager.status()).conflict;assert.deepEqual(new Set(conflict.fields),new Set(['连接名称','其他连接设置']));assert.equal(conflict.recoverable,true);assert.ok(!JSON.stringify(conflict).includes('private'));
 assert.equal(await readFile(f.manager.file,'utf8'),changed);await assert.rejects(f.manager.switch('openai'),/外部修改/);
 const result=await f.manager.switch('openai',{reviewId:conflict.reviewId});assert.equal(result.selected,'openai');assert.equal(result.conflict,null);assert.equal(await readFile(result.backupPath,'utf8'),changed);
 const restored=parse(await readFile(f.manager.file,'utf8'));assert.equal(restored.approval_policy,'never');assert.equal(restored.model_providers[id].base_url,f.manager.identityBridge.baseUrl(id));assert.equal(restored.model_providers[id].requires_openai_auth,true);assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
});
test('a stale recovery review cannot overwrite newer configuration or added connections',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('name = "My Provider"','name = "Changed"'));
 let conflict=(await f.manager.status()).conflict;await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8'))+'\n# external update\n');const current=await readFile(f.manager.file,'utf8');
 await assert.rejects(f.manager.switch('openai',{reviewId:conflict.reviewId}),/确认期间/);assert.equal(await readFile(f.manager.file,'utf8'),current);
 conflict=(await f.manager.status()).conflict;await f.manager.add({...input,name:'Another connection'});await assert.rejects(f.manager.switch('openai',{reviewId:conflict.reviewId}),/确认期间/);
});
test('reviewed default recovery retains outside provider definitions without adopting their login baseline',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 const changed=(await readFile(f.manager.file,'utf8')).replace('model_provider = "openai"','model_provider = "external"')+'\n[model_providers.external]\nname="External"\nbase_url="https://external.example/v1"\n';await writeFile(f.manager.file,changed);
 const conflict=(await f.manager.status()).conflict;assert.deepEqual(conflict.fields,['默认连接选择']);await f.manager.switch('openai',{reviewId:conflict.reviewId});
 const config=parse(await readFile(f.manager.file,'utf8'));assert.equal(config.model,'gpt-original');assert.equal(config.model_providers.external.name,'External');
});
test('recovery is unavailable for profiles or unrelated settings embedded inside the managed block',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);const base=await readFile(f.manager.file,'utf8');
 for(const changed of ['profile="work"\n'+base.replace('name = "My Provider"','name = "Changed"'),base.replace('# END Pawprint Codex Provider','[unrelated]\nkeep=true\n# END Pawprint Codex Provider')]){
  await writeFile(f.manager.file,changed);const conflict=(await f.manager.status()).conflict;assert.equal(conflict.recoverable,false);await assert.rejects(f.manager.switch('openai',{reviewId:conflict.reviewId}));assert.equal(await readFile(f.manager.file,'utf8'),changed);
 }
});
test('account services are always preserved without a setting or entitlement lookup',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;
 const status=await f.manager.switch(id),config=parse(await readFile(f.manager.file,'utf8'));
 assert.equal(status.selected,id);assert.equal(status.dotCompatible,true);assert.equal(config.model_provider,'openai');assert.equal(config.openai_base_url,f.manager.identityBridge.baseUrl(id));
 for(const key of ['preserveDot','connectionMode','dotAccess'])assert.equal(Object.hasOwn(status,key),false);
 assert.equal(typeof f.manager.setPreserveDot,'undefined');assert.equal(typeof f.manager.setConnectionMode,'undefined');assert.equal(typeof f.manager.refreshDotAccess,'undefined');
 assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
});
test('official selection keeps the original upstream behind the session router after picker edits and deletion',async t=>{
 const f=await fixture(t,'model="official-model"\nopenai_base_url="https://original.example/v1"\n[features]\nmemories=true\n');
 const id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('example-model','changed-custom-model'));
 await f.manager.switch('openai');const config=parse(await readFile(f.manager.file,'utf8'));
 assert.equal(config.model,'official-model');assert.equal(config.openai_base_url,f.manager.identityBridge.baseUrl('openai'));assert.equal(f.manager.state.officialBaseUrl,'https://original.example/v1');assert.equal(config.features.memories,true);
 await f.manager.switch(id);await f.manager.remove(id);assert.equal(parse(await readFile(f.manager.file,'utf8')).openai_base_url,f.manager.identityBridge.baseUrl('openai'));assert.equal(f.manager.state.officialBaseUrl,'https://original.example/v1');
});
test('missing login or failed bridge never silently switches to direct provider authentication',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id,before=await readFile(f.manager.file,'utf8');
 await writeFile(path.join(f.directory,'auth.json'),'no-login');await assert.rejects(f.manager.switch(id),/登录 ChatGPT/);assert.equal(await readFile(f.manager.file,'utf8'),before);
 await writeFile(path.join(f.directory,'auth.json'),login);f.manager.identityBridge.start=async()=>{throw Error('occupied');};
 await assert.rejects(f.manager.switch(id),/occupied/);assert.equal(await readFile(f.manager.file,'utf8'),before);
 await assert.rejects(f.manager.switch('openai'),/occupied/);
});
test('legacy opt-outs migrate on startup without changing login, selected upstream or official baseline',async t=>{
 for(const mode of ['api','identity','dot']){
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;
  const baseline={model:'model = "gpt-original" # keep\n',model_provider:'model_provider = "openai"\n',openai_base_url:null};
  const legacy=patchConfig(f.original,f.manager.state.providers[0],baseline);
  await writeFile(f.manager.file,legacy);
  const state={...f.manager.state,preserveDot:false,connectionMode:mode,baseline,managed:{selected:id,roots:{model:`model = "example-model"\n`,model_provider:`model_provider = "${id}"\n`,openai_base_url:null},block:legacy.slice(legacy.indexOf('# BEGIN Pawprint Codex Provider'))}};
  await writeFile(f.manager.stateFile,JSON.stringify(state));
  await f.manager.load();await f.manager.prepareIdentityConnection();
  const config=parse(await readFile(f.manager.file,'utf8')),saved=JSON.parse(await readFile(f.manager.stateFile,'utf8'));
  assert.equal(config.model_provider,'openai');assert.equal((await f.manager.status()).selected,id);assert.equal(config.model_providers[id].auth,undefined);
  assert.equal(saved.preserveDot,undefined);assert.equal(saved.connectionMode,undefined);assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),login);
  await f.manager.switch('openai');assert.equal(parse(await readFile(f.manager.file,'utf8')).model,'gpt-original');
 }
});
test('startup migration leaves external native-route changes intact',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 const changed=(await readFile(f.manager.file,'utf8')).replace('openai_base_url = "http://127.0.0.1:12345/','openai_base_url = "http://127.0.0.1:54321/');await writeFile(f.manager.file,changed);
 await f.manager.prepareIdentityConnection();assert.equal(await readFile(f.manager.file,'utf8'),changed);
 assert.ok((await f.manager.status()).conflict.fields.includes('内置 OpenAI 转发地址'));
});
test('startup removes legacy preferences without resetting an already compatible model-picker choice',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
 const edited=(await readFile(f.manager.file,'utf8')).replace('model = "example-model"','model = "client-picked-model"');await writeFile(f.manager.file,edited);
 await writeFile(f.manager.stateFile,JSON.stringify({...f.manager.state,preserveDot:true,connectionMode:'dot'}));await f.manager.load();await f.manager.prepareIdentityConnection();
 assert.equal(await readFile(f.manager.file,'utf8'),edited);assert.equal((await f.manager.status()).selected,id);
 const saved=JSON.parse(await readFile(f.manager.stateFile,'utf8'));assert.equal(saved.preserveDot,undefined);assert.equal(saved.connectionMode,undefined);
});
test('verified selection is published before a slow client refresh and failed switches keep the last selection',async t=>{
 const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id,seen=[];let release,entered;
 const refreshing=new Promise(r=>entered=r);
 f.manager.onSelection=result=>seen.push(result.selected);
 f.manager.refreshClient=async()=>{entered();await new Promise(r=>release=r);return {status:'requested'};};
 const changing=f.manager.switch(id);await refreshing;assert.deepEqual(seen,[id]);assert.equal(parse(await readFile(f.manager.file,'utf8')).model_provider,'openai');
 release();await changing;
 f.secrets.clear();await assert.rejects(f.manager.switch(id),/keychain/);assert.deepEqual(seen,[id]);
});
