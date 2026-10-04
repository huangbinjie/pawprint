import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome } from "./helpers.mjs";

test('completed reply keeps a direct return arrow after the gesture ends',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-return-')),profile=path.join(root,'profile'),codex=path.join(root,'codex');await seedMatureCompanion(profile);await mkdir(path.join(codex,'sessions'),{recursive:true});
 const threadId='01a0f1ea-4534-7651-b950-045a233fe631',file=path.join(codex,'sessions','one.jsonl');
 await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:threadId}})+'\n');
 const row=(type,turn='one')=>JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type,turn_id:turn}})+'\n';
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:codex,PAWPRINT_TEST_LAN:'1'}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'settings');
  await home.getByRole('switch',{name:'Codex 会话联动',exact:true}).click();
  await expect(home.getByTestId('activity-status')).toContainText('等待新状态记录');
  await expect(floating.locator('.reply-return')).toHaveCount(0);
  await appendFile(file,row('task_started'));await expect(floating.locator('.cat.working')).toBeVisible();
  await appendFile(file,row('task_complete'));await expect(floating.locator('.cat.reply-complete')).toBeVisible();
  await expect(floating.getByRole('button',{name:'查看未读回复'})).toBeVisible();
  await expect(floating.locator('.cat.reply-complete')).toHaveCount(0);
  await expect(floating.getByRole('button',{name:'查看未读回复'})).toBeVisible();
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Pawprint Pet Controls'&&w.isVisible()))).toBe(false);
  await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.returnOpened=url;};});
  await expect.poll(()=>app.windows().some(w=>w.url().startsWith('data:text/html')&&w.url().includes('bubble'))).toBe(true);
  const bubble=app.windows().find(w=>w.url().startsWith('data:text/html')&&w.url().includes('bubble'));
  await expect(bubble.locator('.bubble')).toContainText('本轮回复结束啦');
  await bubble.getByRole('link',{name:'打开对应会话'}).click({noWaitAfter:true});
  await expect.poll(()=>app.evaluate(()=>globalThis.returnOpened)).toBe(`codex://threads/${threadId}`);
  await expect(floating.locator('.reply-return')).toHaveCount(0);
  await appendFile(file,row('task_started','two'));await expect(floating.locator('.cat.working')).toBeVisible();
  await appendFile(file,row('task_complete','two'));await expect(floating.locator('.reply-return')).toBeVisible();
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Pawprint Activity Bubble')?.isVisible()??false),{timeout:12000}).toBe(false);
  await expect(floating.locator('.reply-return')).toBeVisible();
  await app.evaluate(()=>{delete globalThis.returnOpened;});
  await floating.getByRole('button',{name:'查看未读回复'}).click();
  await expect.poll(()=>app.evaluate(()=>globalThis.returnOpened)).toBe(`codex://threads/${threadId}`);
  await expect(floating.locator('.reply-return')).toHaveCount(0);
 }finally{await app.close();}
});

test('parallel rounds do not celebrate one ended reply or a stopped round',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-work-parallel-')),profile=path.join(root,'profile'),codex=path.join(root,'codex');await seedMatureCompanion(profile);await mkdir(path.join(codex,'sessions'),{recursive:true});
 const ids=['01a0f1ea-4534-7651-b950-045a233fe631','01a0f5f7-5a51-7483-9fe6-9e028bc08226'];const files=ids.map((_,i)=>path.join(codex,'sessions',`${i}.jsonl`));
 for(let i=0;i<2;i++)await writeFile(files[i],JSON.stringify({type:'session_meta',payload:{id:ids[i]}})+'\n');
 const row=(type,id)=>JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type,turn_id:id}})+'\n';
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:codex,PAWPRINT_TEST_LAN:'1'}});
 try{
  const home=await openHome(app,'settings');await home.getByRole('switch',{name:'Codex 会话联动',exact:true}).click();await expect(home.getByRole('switch',{name:'Codex 会话联动',exact:true})).toBeEnabled();
  await appendFile(files[0],row('task_started','one'));await appendFile(files[1],row('task_started','two'));
  await expect.poll(async()=>(await home.evaluate(()=>window.pawprint.getState())).data.activity.activeCount).toBe(2);
  await appendFile(files[0],row('task_complete','one'));
  await expect.poll(async()=>(await home.evaluate(()=>window.pawprint.getState())).data.activity.activeCount).toBe(1);
  let state=(await home.evaluate(()=>window.pawprint.getState())).data;expect(state.activity.status).toBe('running');expect(state.performance?.source).not.toBe('activity');
  await appendFile(files[1],row('turn_aborted','two'));await expect.poll(async()=>(await home.evaluate(()=>window.pawprint.getState())).data.activity.status).toBe('stopped');
  state=(await home.evaluate(()=>window.pawprint.getState())).data;expect(state.performance?.source).not.toBe('activity');
 }finally{await app.close();}
});

test('pending question holds a clickable sign until cleared',async({},info)=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'paw-sign-'));
  const state=await seedMatureCompanion(root);
  const threadId='01a0f1ea-4534-7651-b950-045a233fe631';
  state.settings.attentionEnabled=true;
  state.work={version:1,pinned:null,recent:[{threadId,kind:'running',unread:true,bookmark:'',at:Date.now(),attention:{id:'a'.repeat(64),kind:'question',at:Date.now(),seen:false}}]};
  const {Store}=await import('../core/store.mjs');const store=new Store(root);await store.load();await store.save(state);
  const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:root,PAWPRINT_TEST_LAN:'1'}});
  try{
    const floating=await app.firstWindow();
    await expect(floating.locator('.attention-sign')).toBeVisible();
    await expect(floating.locator('.reply-return')).toHaveCount(0);
    expect(await floating.locator('.cat-frontpaw-right').evaluate(el=>getComputedStyle(el).transform)).not.toBe('none');
    await expect(floating.locator('.attention-sign')).toContainText('等你');
    await floating.screenshot({path:info.outputPath('raised-sign.png'),omitBackground:true});
    await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.signOpened=url;};});
    await floating.locator('.attention-sign').click();
    await expect.poll(()=>app.evaluate(()=>globalThis.signOpened)).toBe(`codex://threads/${threadId}`);
    await expect(floating.locator('.attention-sign')).toBeVisible();
    await expect(floating.locator('.reply-return')).toHaveCount(0);
  }finally{await app.close();}
});

test('double clicking the cat prioritizes attention, unread replies, then recent chat',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-double-')),state=await seedMatureCompanion(root);
 const ids=['01a0f1ea-4534-7651-b950-045a233fe631','01a0f5f7-5a51-7483-9fe6-9e028bc08226','01a10440-119e-7497-bf8e-14c2b0f2f9a2'];
 state.settings.attentionEnabled=true;
 state.work={version:1,pinned:ids[2],recent:ids.map((threadId,i)=>({threadId,at:Date.now()+i,kind:'completed',bookmark:'',unread:i===1,...(i===1?{completedAt:Date.now()}:{}),...(i===0?{attention:{id:'b'.repeat(64),kind:'question',at:Date.now(),seen:false}}:{})}))};
 const {Store}=await import('../core/store.mjs');const store=new Store(root);await store.load();await store.save(state);
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:root,PAWPRINT_TEST_CODEX_HOME:path.join(root,'codex'),PAWPRINT_TEST_LAN:'1'}});
 try{
  const floating=await app.firstWindow();await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.doubleOpened=url;};});
  await floating.locator('.float-cat-button').dblclick({position:{x:70,y:120}});
  await expect.poll(()=>app.evaluate(()=>globalThis.doubleOpened)).toBe(`codex://threads/${ids[0]}`);
  await floating.evaluate(()=>window.pawprint.disconnectAttention());
  await expect(floating.locator('.attention-sign')).toHaveCount(0);
  await floating.waitForTimeout(550);
  await floating.locator('.float-cat-button').dblclick({position:{x:70,y:120}});
  await expect.poll(()=>app.evaluate(()=>globalThis.doubleOpened)).toBe(`codex://threads/${ids[1]}`);
  await expect(floating.locator('.reply-return')).toHaveCount(0);
  await floating.waitForTimeout(550);
  await floating.locator('.float-cat-button').dblclick({position:{x:70,y:120}});
  await expect.poll(()=>app.evaluate(()=>globalThis.doubleOpened)).toBe(`codex://threads/${ids[2]}`);
  expect(app.windows().some(w=>w.url().endsWith('#home'))).toBe(false);
 }finally{await app.close();}
});
