import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {readCodexSessionSources} from '../electron/codex-session-sources.mjs';
const id=n=>`01a0f1ea-4534-7651-b950-${String(n).padStart(12,'0')}`;
test('session providers come from metadata before a message; unknown stays unknown and prompts stay private',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-sources-')),db=new DatabaseSync(path.join(directory,'state_5.sqlite'));t.after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, name TEXT, cwd TEXT, model_provider TEXT, model TEXT, updated_at INTEGER, archived INTEGER, source TEXT, title TEXT, first_user_message TEXT)');
 const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const [n,provider,source,archived] of [[1,'openai','cli',0],[2,'custom-demo','cli',0],[3,null,'cli',0],[4,'custom-demo','remote',0],[5,'custom-demo','subagent',0],[6,'custom-demo','cli',1]])insert.run(id(n),n===1?'Official chat':null,'/PRIVATE/PATH',provider,n===3?null:'test-model',n,archived,source,'PRIVATE PROMPT','PRIVATE CONTENT');
 await writeFile(path.join(directory,'session_index.jsonl'),JSON.stringify({id:id(2),thread_name:'Custom chat'})+'\n');
 const result=await readCodexSessionSources(directory);assert.equal(result.status,'available');assert.equal(result.items.length,3);assert.equal(result.items.find(r=>r.id===id(2)).title,'Custom chat');assert.equal(result.items.find(r=>r.id===id(1)).providerId,'openai');assert.equal(result.items.find(r=>r.id===id(3)).providerId,null);assert.equal(result.items.find(r=>r.id===id(3)).title,null);assert.ok(result.items.every(r=>r.requestVerified===false));assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing or unsupported metadata never creates a database or invents an OpenAI source',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-sources-missing-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 assert.deepEqual(await readCodexSessionSources(directory),{status:'unavailable',items:[]});await assert.rejects(access(path.join(directory,'state_5.sqlite')));
 const db=new DatabaseSync(path.join(directory,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,updated_at INTEGER)');db.close();assert.deepEqual(await readCodexSessionSources(directory),{status:'unavailable',items:[]});
});

test('bound service is shown separately from the last observed destination',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-sources-bound-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const db=new DatabaseSync(path.join(directory,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT, name TEXT, cwd TEXT, model_provider TEXT, updated_at INTEGER)');db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(id(1),'Chat','/private','openai',1);db.close();
 const {CodexSessionBindings}=await import('../electron/codex-session-bindings.mjs'),{CodexRouteEvidence}=await import('../electron/codex-route-evidence.mjs');
 const vendor='pawprint_'+'a'.repeat(32);await new CodexRouteEvidence(directory).record({threadId:id(1),providerId:vendor,model:'mimo-test'});await new CodexSessionBindings(directory).bind(id(1),'openai');
 const result=await readCodexSessionSources(directory,directory);assert.equal(result.items[0].providerId,vendor);assert.equal(result.items[0].boundProviderId,'openai');
});
