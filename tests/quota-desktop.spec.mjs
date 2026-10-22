import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, appendFile,readFile,rm } from "node:fs/promises";
import net from 'node:net';
import {CodexAccounts} from '../electron/codex-accounts.mjs';
import {CodexRouteEvidence} from '../electron/codex-route-evidence.mjs';
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome,openCodex } from "./helpers.mjs";
test('native tray immediately follows provider selection before a slow desktop refresh',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-provider-tray-')),profile=path.join(root,'profile'),directory=path.join(root,'codex');
 await seedMatureCompanion(profile);await mkdir(path.join(directory,'sessions'),{recursive:true});await mkdir(path.join(directory,'ipc'));
 const save=JSON.parse(await readFile(path.join(profile,'save-v1.json'),'utf8'));save.settings.quotaEnabled=true;save.settings.quotaWindow='weekly';await writeFile(path.join(profile,'save-v1.json'),JSON.stringify(save));
 await writeFile(path.join(directory,'config.toml'),'model="gpt-existing"\n');await writeFile(path.join(directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'dummy',id_token:'dummy'}}));
 const record=limits=>JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'token_count',rate_limits:{limit_id:'codex',...limits}}})+'\n';
 await writeFile(path.join(directory,'sessions','official.jsonl'),record({primary:{window_minutes:10080,used_percent:56,resets_at:Math.floor(Date.now()/1000)+86400}}));
 const manager=new CodexAccounts({directory,dataDirectory:profile,keychain:{set:async()=>{},get:async()=> 'dummy',remove:async()=>{}},running:async()=>false});await manager.load();
 await manager.add({name:'feng-codex',baseUrl:'https://example.com/v1',model:'test-model',apiKey:'dummy'});const added=await manager.add({name:'other-gateway',baseUrl:'https://other.example/v1',model:'test-model',apiKey:'dummy'});
 // Never answer desktop coordination: each switch refresh waits 1.5 seconds.
 const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.on('data',()=>{});});await new Promise(r=>server.listen(path.join(directory,'ipc','ipc.sock'),r));
 const env={...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:directory,PAWPRINT_TEST_LAN:'1'};let app,home;
 const launch=async()=>{
  app=await electron.launch({args:['.'],env});await app.evaluate(({Tray,app,Notification})=>{
   const original=Tray.prototype.setTitle;Tray.prototype.setTitle=function(title,...rest){globalThis.trayConnectionTestTitle=title;return original.call(this,title,...rest);};Notification.isSupported=()=>false;
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));req('./electron/codex-accounts.mjs').MacKeychain.prototype.get=async()=> 'dummy';
  });home=await openCodex(app);
 };
 const title=()=>app.evaluate(()=>globalThis.trayConnectionTestTitle);
 const select=async(label,expected)=>{
  const button=home.getByRole('button',{name:label,exact:true});await button.click();
  await expect.poll(title,{timeout:1000,intervals:[10,25,50]}).toBe(expected);
  const refreshing=home.getByRole('button',{name:'刷新状态',exact:true});
  await expect(refreshing).toBeDisabled(); // Name changes before IPC completes.
  await expect(refreshing).toBeEnabled();
 };
 try{
  await launch();await home.evaluate(()=>window.pawprint.refreshQuota());await expect.poll(title).toBe('W 44%');
  await select('选用 feng-codex','feng-codex');
  const threadId='01a0f1ea-4534-7651-b950-000000000005';await new CodexRouteEvidence(profile).record({threadId,providerId:added.providers[0].id,model:'test-model'});
  await writeFile(path.join(directory,'sessions',`proxy-${threadId}.jsonl`),record({primary:null,secondary:null}));await home.evaluate(()=>window.pawprint.refreshQuota());expect(await title()).toBe('feng-codex');
  await select('选用 other-gateway','other-gateway');
  await app.close();await launch();await home.evaluate(()=>window.pawprint.refreshQuota());await expect.poll(title).toBe('other-gateway');
  await select('选用 ChatGPT','W 44%');
  const before=await readFile(path.join(directory,'config.toml'),'utf8');
  await app.evaluate(({app})=>{const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));req('./electron/codex-accounts.mjs').MacKeychain.prototype.get=async()=>{throw Error('isolated keychain failure');};});
  await home.getByRole('button',{name:'选用 feng-codex',exact:true}).click();await expect(home.getByRole('alert')).toContainText('isolated keychain failure');expect(await title()).toBe('W 44%');expect(await readFile(path.join(directory,'config.toml'),'utf8')).toBe(before);
 }finally{await app?.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
test("owned badges are in pools and real native tray titles follow remaining quota snapshots", async ({}, info) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-quota-ui-"));
  const profile = path.join(root, "profile"), codex = path.join(root, "codex");
  await seedMatureCompanion(profile); await mkdir(path.join(codex, "sessions"), { recursive: true });
  const file = path.join(codex, "sessions/fixture.jsonl");
  const row = (used, age = 0, reset = Date.now() + 86400000) => JSON.stringify({ type: "event_msg", timestamp: new Date(Date.now() - age).toISOString(), payload: { type: "token_count", rate_limits: { limit_id: "codex", primary: { used_percent: used, window_minutes: 10080, resets_at: Math.floor(reset / 1000) }, secondary: null } } }) + "\n";
  await writeFile(file, row(62));
  const app = await electron.launch({ args: ["."], env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: profile, PAWPRINT_TEST_CODEX_HOME: codex, PAWPRINT_TEST_LAN: "1" } });
  try {
    const home = await openHome(app, "talents");
    await expect(home.locator(".skill-card")).toHaveCount(23);
    await expect(home.locator(".skill-owned-badge")).toHaveCount(10);
    await expect(home.locator('[data-skill-id="ball"]')).toContainText("已拥有");
    await expect(home.getByRole("heading", { name: "赠送技能", exact: true })).toHaveCount(0);
    await expect(home.locator(".owned-skills")).toHaveCount(0);
    await home.locator('[data-skill-id="ball"]').scrollIntoViewIfNeeded();
    await home.screenshot({ path: info.outputPath("owned-skill-pool.png") });
    await app.evaluate(({ Tray }) => {
      const original = Tray.prototype.setTitle;
      Tray.prototype.setTitle = function(title, ...rest) { globalThis.pawObservedTitle = title; return original.call(this, title, ...rest); };
    });
    await openCodex(app,'usage');
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    await home.getByRole("switch", { name: "图标旁显示剩余额度" }).click();
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("W 38%");
    await expect(home.getByTestId("quota-preview")).toContainText("周剩余：38%");
    await home.screenshot({ path: info.outputPath("quota-settings.png") });
    await home.getByLabel("显示哪段额度").selectOption("both");
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("5h — · W 38%");
    await appendFile(file, row(71));
    await home.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("5h — · W 29%");
    await writeFile(file, row(71, 16 * 60000));
    await home.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("5h — · W ~29%");
    await writeFile(file, row(71, 16 * 60000, Date.now() - 1000));
    await home.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("5h — · W —");
    await home.getByRole("switch", { name: "图标旁显示剩余额度" }).click();
    await expect.poll(() => app.evaluate(() => globalThis.pawObservedTitle)).toBe("");
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance); expect(after.pets).toEqual(before.pets);
  } finally { await app.close(); }
});
