import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';import {CodexSessionBindings} from '../electron/codex-session-bindings.mjs';import {CodexRouteEvidence} from '../electron/codex-route-evidence.mjs';
const a='pawprint_'+'a'.repeat(32),b='pawprint_'+'b'.repeat(32),id=n=>'01a0f1ea-4534-7651-b950-'+String(n).padStart(12,'0');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'paw-bindings-'));t.after(()=>rm(root,{recursive:true,force:true}));const bindings=new CodexSessionBindings(root);return {root,bindings};}
test('first dispatch pins a service durably across default changes and restarts',async t=>{
 const {root,bindings}=await fixture(t);await bindings.prepare({directory:root,currentProviderId:'openai'});
 assert.equal(await bindings.resolve(id(1),a),a);assert.equal(await bindings.resolve(id(1),b),a);
 const restarted=new CodexSessionBindings(root);assert.equal(await restarted.resolve(id(1),'openai'),a);
 assert.equal(await restarted.resolve(id(2),'openai'),'openai');assert.equal(await restarted.resolve(id(2),b),'openai');
 if(process.platform!=='win32')assert.equal((await stat(bindings.file)).mode&0o777,0o600);
 await assert.rejects(restarted.bind(id(1),b),/已绑定/);
});
test('first migration uses observations and explicitly assigns unobserved old chats to OpenAI',async t=>{
 const {root,bindings}=await fixture(t),db=new DatabaseSync(path.join(root,'state_5.sqlite'));
 db.exec('CREATE TABLE threads(id TEXT, model_provider TEXT)');for(const n of [1,2,3,5])db.prepare('INSERT INTO threads VALUES(?,?)').run(id(n),'openai');
 const routes=new CodexRouteEvidence(root);await routes.record({threadId:id(1),providerId:a,model:'gpt-test'});await routes.recordTurn({threadId:id(2),turnId:id(20),providerId:b,model:'mimo-test'});
 await routes.record({threadId:id(5),providerId:b,model:'mimo-test'});await bindings.bind(id(5),'openai');
 await bindings.prepare({directory:root,currentProviderId:b});
 assert.equal(await bindings.resolve(id(5),b),'openai');assert.equal(await bindings.resolve(id(1),b),a);assert.equal(await bindings.resolve(id(2),'openai'),b);assert.equal(await bindings.resolve(id(3),b),'openai');
 db.prepare('INSERT INTO threads VALUES(?,?)').run(id(4),'openai');db.close();
 await bindings.prepare({directory:root,currentProviderId:b});assert.equal(await bindings.resolve(id(4),'openai'),b);
 // A later route snapshot cannot rewrite any already established binding.
 await routes.record({threadId:id(3),providerId:b,model:'mimo-test'});await bindings.prepare({directory:root,currentProviderId:b});assert.equal(await bindings.resolve(id(3),b),'openai');
});
test('concurrent first requests choose one durable service and corrupt metadata fails closed',async t=>{
 const {root,bindings}=await fixture(t);const choices=await Promise.all([bindings.resolve(id(1),a),bindings.resolve(id(1),b)]);assert.deepEqual(choices,[a,a]);
 await writeFile(bindings.file,'broken');await assert.rejects(new CodexSessionBindings(root).resolve(id(1),b),/停止转发/);
 assert.equal(await readFile(bindings.file,'utf8'),'broken');await assert.rejects(bindings.resolve('bad-id',a),/有效的会话标识/);
});
test('a durable-write failure does not keep an uncommitted binding in memory',async t=>{
 const {bindings}=await fixture(t);await bindings.load();const save=bindings.save.bind(bindings);bindings.save=async()=>{throw Error('disk unavailable');};
 await assert.rejects(bindings.resolve(id(1),a),/disk/);bindings.save=save;assert.equal(await bindings.resolve(id(1),b),b);
});

test('missing durable metadata after activation fails instead of rebuilding bindings from new defaults',async t=>{
 const {root,bindings}=await fixture(t);await assert.rejects(bindings.prepare({directory:root,currentProviderId:b,requireExisting:true}),/停止转发/);
 await bindings.prepare({directory:root,currentProviderId:b});await bindings.resolve(id(1),a);await rm(bindings.file);
 await assert.rejects(new CodexSessionBindings(root).prepare({directory:root,currentProviderId:b,requireExisting:true}),/停止转发/);
});
test('legacy title-index-only chats are included in the initial migration',async t=>{
 const {root,bindings}=await fixture(t);await writeFile(path.join(root,'session_index.jsonl'),JSON.stringify({id:id(1),thread_name:'Private title'})+'\n');
 await bindings.prepare({directory:root,currentProviderId:b});assert.equal(await bindings.resolve(id(1),b),'openai');assert.ok(!(await readFile(bindings.file,'utf8')).includes('Private'));
});
