import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {readWorkTitles,readRecentWorkChats} from '../electron/work-titles.mjs';
import {initialState,transition} from '../core/game.mjs';
import {validateState} from '../core/store.mjs';
const id='01a0f1ea-4534-7651-b950-045a233fe631';
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'paw-title-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('explicit index titles are read without creating a database or deriving prompts',async t=>{
 const dir=await fixture(t);await writeFile(path.join(dir,'session_index.jsonl'),'{partial}\n'+JSON.stringify({id,thread_name:'Fix login error',preview:'PRIVATE',updated_at:'2026-10-02'})+'\n');const rows=await readWorkTitles(dir,[id,'bad?prompt']);assert.deepEqual(rows,[{threadId:id,title:'Fix login error'}]);await assert.rejects(access(path.join(dir,'state_5.sqlite')));assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});
test('read-only WAL database names match the sidebar and override stale index names',async t=>{
 const dir=await fixture(t),file=path.join(dir,'state_5.sqlite'),db=new DatabaseSync(file);t.after(()=>db.close());db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, cwd TEXT, title TEXT, first_user_message TEXT)');db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,'今日消耗的token为什么对不上','/projects/pawprint','PRIVATE full prompt','PRIVATE transcript');await writeFile(path.join(dir,'session_index.jsonl'),JSON.stringify({id,thread_name:'Old title'})+'\n');await writeFile(path.join(dir,'.codex-global-state.json'),JSON.stringify({'electron-workspace-root-labels':{'/projects/pawprint':'爪印'},private:'PRIVATE credential'}));
 const before=await readFile(file),rows=await readWorkTitles(dir,[id]);assert.deepEqual(rows,[{threadId:id,title:'今日消耗的token为什么对不上',project:'爪印'}]);assert.deepEqual(await readFile(file),before);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
 db.prepare('UPDATE threads SET name=? WHERE id=?').run('Renamed chat',id);assert.equal((await readWorkTitles(dir,[id]))[0].title,'Renamed chat');
});
test('old or damaged metadata retains an explicit index name and cleans title control characters',async t=>{
 const dir=await fixture(t);await writeFile(path.join(dir,'state_5.sqlite'),'not SQLite');await writeFile(path.join(dir,'session_index.jsonl'),JSON.stringify({id,thread_name:'  My\nnext\tstep\u0000  '})+'\n');assert.deepEqual(await readWorkTitles(dir,[id]),[{threadId:id,title:'My next step'}]);await writeFile(path.join(dir,'session_index.jsonl'),JSON.stringify({id,first_user_message:'PRIVATE',title:'PRIVATE'}));assert.deepEqual(await readWorkTitles(dir,[id]),[]);
});
test('metadata updates do not replace bookmarks, pinning, unread results or the wallet',()=>{
 let state=initialState(Date.now());state=transition(state,{type:'_work-observe',recent:[{threadId:id,at:Date.now(),kind:'completed'}],completed:{threadId:id}},{now:Date.now()});state=transition(state,{type:'work-bookmark',threadId:id,text:'Next: test login'},{now:Date.now()});state=transition(state,{type:'work-pin',threadId:id},{now:Date.now()});const before=structuredClone(state);state=transition(state,{type:'_work-metadata',rows:[{threadId:id,title:'Login fix',project:'Pawprint'}]},{now:Date.now()});assert.equal(state.work.recent[0].title,'Login fix');assert.equal(state.work.recent[0].bookmark,'Next: test login');assert.equal(state.work.recent[0].unread,true);assert.equal(state.work.pinned,id);assert.deepEqual(state.ledger,before.ledger);validateState(state);
});

test('startup metadata excludes archived chats and subagents without inventing unread outcomes',async t=>{
 const dir=await fixture(t),db=new DatabaseSync(path.join(dir,'state_5.sqlite'));t.after(()=>db.close());db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at INTEGER, archived INTEGER, source TEXT, first_user_message TEXT)');
 const ids=[id,'01a0f5f7-5a51-7483-9fe6-9e028bc08226','01a10440-119e-7497-bf8e-14c2b0f2f9a2'];
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(ids[0],1000,0,'vscode','PRIVATE');db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(ids[1],2000,1,'vscode','PRIVATE');db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(ids[2],3000,0,'{"subagent":{}}','PRIVATE');
 assert.deepEqual(await readRecentWorkChats(dir,4000000),[{threadId:id,at:1000000,kind:'unknown'}]);
});
test('startup index fallback deduplicates explicit metadata and never creates a database',async t=>{
 const dir=await fixture(t);await writeFile(path.join(dir,'session_index.jsonl'),[JSON.stringify({id,thread_name:'One',updated_at:'2026-10-01T00:00:00Z'}),JSON.stringify({id,thread_name:'Renamed',updated_at:'2026-10-02T00:00:00Z'})].join('\n'));assert.equal((await readRecentWorkChats(dir,Date.parse('2026-10-03'))).length,1);await assert.rejects(access(path.join(dir,'state_5.sqlite')));
});
