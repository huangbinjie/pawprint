import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, stat, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';
import {CodexAccounts, MacKeychain, validateProvider, patchConfig} from '../electron/codex-accounts.mjs';
const input = {name:'My Provider',baseUrl:'https://example.com/v1',model:'example-model',apiKey:'test-secret'};
async function fixture(t, original = '# My settings\nmodel = "gpt-original" # keep\nmodel_provider = "openai"\napproval_policy = "on-request"\n[projects."/my/project"]\ntrust_level = "trusted"\n') {
  const root = await mkdtemp(path.join(os.tmpdir(),'paw-accounts-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const directory = path.join(root,'codex'), dataDirectory = path.join(root,'data'); await mkdir(directory);
  await writeFile(path.join(directory,'config.toml'),original); await writeFile(path.join(directory,'auth.json'),'login-do-not-touch');
  const secrets = new Map(), keychain = {set:async(id,key)=>secrets.set(id,key),get:async id=>{if(!secrets.has(id))throw Error('keychain unavailable');return secrets.get(id);},remove:async id=>secrets.delete(id)};
  let running = false;
  const manager = new CodexAccounts({directory,dataDirectory,keychain,running:async()=>running,platform:'darwin'});await manager.load();
  return {manager,directory,dataDirectory,secrets,setRunning:value=>running=value,original};
}
test('switch round trip preserves unrelated settings, comments, login and excludes secrets',async t=>{
  const f=await fixture(t), added=await f.manager.add(input), id=added.providers[0].id;
  const switched=await f.manager.switch(id), text=await readFile(f.manager.file,'utf8'), config=parse(text);
  assert.equal(config.model_provider,id);assert.equal(config.model,'example-model');assert.equal(config.model_providers[id].auth.command,'/usr/bin/security');
  assert.ok(text.includes('[projects."/my/project"]\ntrust_level = "trusted"'));assert.ok(!text.includes(input.apiKey));
  assert.equal(await readFile(switched.backupPath,'utf8'),f.original);assert.equal((await stat(switched.backupPath)).mode & 0o777,0o600);
  assert.ok(!(await readFile(f.manager.stateFile,'utf8')).includes(input.apiKey));
  await f.manager.switch('openai');const restored=parse(await readFile(f.manager.file,'utf8'));assert.ok(restored.model_providers[id]);delete restored.model_providers;assert.deepEqual(restored,parse(f.original));assert.ok((await readFile(f.manager.file,'utf8')).includes('model = "gpt-original" # keep'));
  assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),'login-do-not-touch');
});
test('switch defaults while Codex runs and reject external managed changes',async t=>{
  const f=await fixture(t), id=(await f.manager.add(input)).providers[0].id;f.setRunning(true);
  assert.equal((await f.manager.switch(id)).selected,id);assert.equal((await f.manager.switch('openai')).selected,'openai');
  await f.manager.switch(id);await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('example-model','manual-edit'));
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
  const second = new CodexAccounts({directory:f.directory,dataDirectory:f.dataDirectory,keychain:f.manager.keychain,running:async()=>false,platform:'darwin'});await second.load();assert.equal((await second.status()).selected,id);
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
  assert.deepEqual(parse(await readFile(f.manager.file,'utf8')),parse(f.original));assert.equal(await readFile(path.join(f.directory,'auth.json'),'utf8'),'login-do-not-touch');
});
test('selected provider deletion refuses external config changes and preserves credentials',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  await writeFile(f.manager.file,(await readFile(f.manager.file,'utf8')).replace('example-model','manual-model'));
  await assert.rejects(f.manager.remove(id),/外部修改/);assert.equal(f.secrets.has(id),true);assert.equal(f.manager.state.providers.length,1);
});
test('failed Keychain deletion restores the selected provider for retry',async t=>{
  const f=await fixture(t),id=(await f.manager.add(input)).providers[0].id;await f.manager.switch(id);
  f.manager.keychain.remove=async()=>{throw Error('keychain locked');};await assert.rejects(f.manager.remove(id),/locked/);
  assert.equal((await f.manager.status()).selected,id);assert.equal(f.manager.state.providers.length,1);assert.equal(f.secrets.has(id),true);
});
test('unsupported platforms can read metadata without invoking macOS process inspection',async t=>{
 const f=await fixture(t);const manager=new CodexAccounts({directory:f.directory,dataDirectory:f.dataDirectory,platform:'win32',running:async()=>{throw Error('must not inspect macOS processes');}});
 await manager.load();const status=await manager.status();assert.equal(status.supported,false);assert.equal(status.running,false);assert.equal(status.selected,'openai');
});
