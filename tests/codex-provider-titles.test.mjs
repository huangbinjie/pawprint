import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {providerTitle,readProviderTitleCandidates,CodexProviderTitles} from '../electron/codex-provider-titles.mjs';
import {CodexRouteEvidence} from '../electron/codex-route-evidence.mjs';
const id='e8d6ae33-8b42-4b27-97de-a7b29757484c',other='4a400d04-67fd-4163-993b-6d3dbbb3067e';
async function directory(t){const p=await mkdtemp(path.join(os.tmpdir(),'paw-provider-titles-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('prefix only known custom providers, preserve user prefixes and avoid duplicate labels',()=>{
 assert.equal(providerTitle('Title','openai','GPT'),null);assert.equal(providerTitle('Title',null,'API'),null);
 assert.equal(providerTitle('Title','sample','Example API'),'[Example API] Title');assert.equal(providerTitle('[Example API] Title','sample','Example API'),null);
 assert.equal(providerTitle('[Bug] Title','sample','Example API'),'[Example API] [Bug] Title');assert.equal(providerTitle('','sample','API'),null);
 assert.equal(providerTitle('Title','sample','[bad]\nlabel'),'[bad label] Title');
});
test('read actual per-thread provider with explicit names; exclude OpenAI, subagents, archived and missing title',async t=>{
 const dir=await directory(t),db=new DatabaseSync(path.join(dir,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,model_provider TEXT,name TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,source TEXT,title TEXT)');
 const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)');insert.run(id,'sample','Explicit title',dir,1,0,'vscode','PRIVATE USER PROMPT');insert.run(other,'openai','GPT',dir,2,0,'vscode','PRIVATE');
 insert.run('474d2d13-f95a-4b94-9edc-3a2116ad1e1d','sample','Guardian',dir,3,0,'{"subagent":{}}','PRIVATE');
 insert.run('63cbcdcd-8891-492f-929d-4b92af8a3c4f','sample',null,dir,4,0,'vscode','PRIVATE');
 insert.run('8c41d1d9-4cd6-4de1-85b6-a72cb4b44fd6','sample','Archived',dir,5,1,'vscode','PRIVATE');
 db.close();assert.deepEqual(await readProviderTitleCandidates(dir),[{id,providerId:'sample',title:'Explicit title'}]);
});
test('metadata-only supported RPC verifies provider, persists title and remains idempotent across restarts',async t=>{
 const dir=await directory(t);await writeFile(path.join(dir,'config.toml'),'model_provider="openai"\n[model_providers.sample]\nname="Example API"\n');
 let rows=[{id,providerId:'sample',title:'Original'},{id:other,providerId:'openai',title:'GPT'}],calls=[];
 const factory=async()=>({request:async(method,params)=>{calls.push({method,params});if(method==='thread/read')return {thread:{id:params.threadId,modelProvider:rows.find(r=>r.id===params.threadId).providerId}};if(method==='thread/name/set')rows=rows.map(r=>r.id===params.threadId?{...r,title:params.name}:r);return {};},close:async()=>{}});
 const make=()=>new CodexProviderTitles({directory:dir,dataDirectory:dir,readCandidates:async()=>rows,clientFactory:factory});const service=make();await service.load();await service.refresh();
 assert.equal(rows[0].title,'[Example API] Original');assert.equal(rows[1].title,'GPT');assert.ok(calls.every(c=>['thread/read','thread/name/set'].includes(c.method)));assert.equal(calls[0].params.includeTurns,false);
 const after=calls.length;await service.refresh();assert.equal(calls.length,after);const restarted=make();await restarted.load();await restarted.refresh();assert.equal(calls.length,after);
 await writeFile(path.join(dir,'config.toml'),'[model_providers.sample]\nname="New name"\n');await restarted.refresh();assert.equal(rows[0].title,'[New name] Original');const renamed=calls.length;await restarted.refresh();assert.equal(calls.length,renamed);
 assert.equal(JSON.parse(await readFile(service.file,'utf8')).edits[id].before,'Original');
});
test('skip threads with changed or unverifiable provider and disabling prevents writes',async t=>{
 const dir=await directory(t);await writeFile(path.join(dir,'config.toml'),'');let writes=0;
 const service=new CodexProviderTitles({directory:dir,dataDirectory:dir,readCandidates:async()=>[{id,providerId:'sample',title:'Original'}],clientFactory:async()=>({request:async(method)=>{if(method==='thread/name/set')writes++;return {thread:{id,modelProvider:'openai'}};},close:async()=>{}})});
 await service.refresh();assert.equal(writes,0);await service.configure(false);await service.refresh();assert.equal(writes,0);assert.equal(service.snapshot().enabled,false);
});
test('native OpenAI-labelled chats are marked only after an observed third-party request',async t=>{
 const dir=await directory(t),db=new DatabaseSync(path.join(dir,'state_5.sqlite'));
 db.exec('CREATE TABLE threads(id TEXT,model_provider TEXT,name TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,source TEXT)');db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(id,'openai','My chat',dir,1,0,'cli');db.close();
 assert.deepEqual(await readProviderTitleCandidates(dir,dir),[]);
 const providerId='pawprint_'+'a'.repeat(32);await new CodexRouteEvidence(dir).record({threadId:id,providerId,model:'test-model'});
 const rows=await readProviderTitleCandidates(dir,dir);assert.equal(rows[0].providerId,providerId);assert.equal(rows[0].runtimeProviderId,'openai');
 await writeFile(path.join(dir,'config.toml'),`[model_providers.${providerId}]\nname="My gateway"\n`);let renamed;
 const service=new CodexProviderTitles({directory:dir,dataDirectory:dir,clientFactory:async()=>({request:async(method,p)=>method==='thread/read'?{thread:{id,modelProvider:'openai'}}:(renamed=p.name,{}),close:async()=>{}})});await service.refresh();assert.equal(renamed,'[My gateway] My chat');await service.close();
});
test('a title created after route discovery is prefixed through index events before the polling interval', {timeout:4000},async t=>{
 const dir=await directory(t),db=new DatabaseSync(path.join(dir,'state_5.sqlite'));
 let service;
 try{
 db.exec('CREATE TABLE threads(id TEXT,model_provider TEXT,name TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,source TEXT)');db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(id,'openai',null,dir,1,0,'cli');
 const providerId='pawprint_'+'a'.repeat(32);await new CodexRouteEvidence(dir).record({threadId:id,providerId,model:'test-model'});
 await writeFile(path.join(dir,'config.toml'),`[model_providers.${providerId}]\nname="Fast gateway"\n`);
 let finished;const renamed=new Promise(r=>finished=r);
 service=new CodexProviderTitles({directory:dir,dataDirectory:dir,clientFactory:async()=>({request:async(method,p)=>{
  if(method==='thread/read')return {thread:{id,modelProvider:'openai'}};
  db.prepare('UPDATE threads SET name=? WHERE id=?').run(p.name,id);finished(p.name);return {};
 },close:async()=>{}})});service.start();service.watcher.ref();await service.refresh();
 assert.deepEqual(await readProviderTitleCandidates(dir,dir),[]);
 db.prepare('UPDATE threads SET name=? WHERE id=?').run('Early title',id);
 await writeFile(path.join(dir,'session_index.jsonl'),JSON.stringify({id,thread_name:'Early title',updated_at:new Date().toISOString()})+'\n');
 assert.equal(await renamed,'[Fast gateway] Early title');await service.close();
 const before=service.snapshot().updated;await writeFile(path.join(dir,'session_index.jsonl'),'');assert.equal(service.snapshot().updated,before);
 }finally{await service?.close();db.close();}
});
test('a refresh event during an active scan is drained instead of waiting for the next poll',async t=>{
 const dir=await directory(t);await writeFile(path.join(dir,'config.toml'),'');let reads=0,release;
 const paused=new Promise(r=>release=r);
 const service=new CodexProviderTitles({directory:dir,dataDirectory:dir,readCandidates:async()=>{reads++;if(reads===1)await paused;return [];}});t.after(()=>service.close());
 const first=service.refresh();service.refresh();release();await first;assert.equal(reads,2);
});
