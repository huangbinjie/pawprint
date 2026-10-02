import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome } from "./helpers.mjs";

test("idle ball, real window roaming, hover stop, edge patrol and reduced motion", async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-idle-ui-"));
  await seedMatureCompanion(dir);
  const codex = path.join(dir, "codex");
  const folder = path.join(codex, "sessions", new Date().toISOString().slice(0, 10).replaceAll("-", "/"));
  await mkdir(folder, { recursive: true });
  const log = path.join(folder, "idle-activity.jsonl");
  await writeFile(log, "");
  const app = await electron.launch({ args: ["."], env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: dir, PAWPRINT_TEST_LAN: "1", PAWPRINT_TEST_CODEX_HOME: codex } });
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).getBounds());
  try {
    // CDP mouse events do not reliably move the macOS global cursor. Control that
    // input explicitly so the user's real mouse cannot make this test flaky.
    await app.evaluate(({ screen, app }) => {
      globalThis.pawTestCursor = { x: -100000, y: -100000 };
      screen.getCursorScreenPoint = () => globalThis.pawTestCursor;
      const path = process.getBuiltinModule("path");
      const req = process.getBuiltinModule("module").createRequire(path.join(app.getAppPath(), "package.json"));
      const { IdleDirector } = req("./core/idle.mjs");
      const original = IdleDirector.prototype.step;
      IdleDirector.prototype.step = function(input) {
        const result = original.call(this, input);
        globalThis.pawIdleDiagnostic = { enabled: input.enabled, blocked: input.blocked, position: input.position, visual: result.visual, waitMs: this.nextAt - input.now };
        return result;
      };
    });
    const floating = await app.firstWindow();
    const home = await openHome(app, "settings");
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    await home.getByRole("button", { name: "拿出玩具球", exact: true }).click();
    await home.mouse.move(20, 80);
    await expect(floating.getByRole("img", { name: "宠物玩具球" })).toBeVisible({ timeout: 10000 });
    expect(await floating.locator(".toy-ball").evaluate(el => getComputedStyle(el).animationName)).toBe("idle-ball-roll");
    await floating.screenshot({ path: info.outputPath("playing-ball.png"), omitBackground: true });
    await home.getByRole("switch", { name: "待机散步与玩耍", exact: true }).click();
    await expect(home.getByRole("switch", { name: "待机散步与玩耍", exact: true })).toHaveAttribute("aria-checked", "true");
    await home.mouse.move(20, 80);
    const start = await bounds();
    await expect(floating.locator(".idle-pose-walk")).toBeVisible({ timeout: 16000 });
    await expect.poll(async () => Math.abs((await bounds()).x - start.x)).toBeGreaterThan(10);
    expect((await bounds()).y).toBe(start.y);
    await floating.screenshot({ path: info.outputPath("walking.png"), omitBackground: true });
    await floating.mouse.move(110, 130);
    await app.evaluate(({ BrowserWindow }) => {
      const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).getBounds();
      globalThis.pawTestCursor = { x: b.x + 110, y: b.y + 130 };
    });
    await expect(floating.locator("[data-idle-mode=rest]")).toBeVisible();
    const paused = await bounds();
    await floating.waitForTimeout(600);
    expect(await bounds()).toEqual(paused);
    // A drag changes the route origin; it does not get pulled back by the director.
    await floating.mouse.down();
    await floating.mouse.move(80, 100, { steps: 5 });
    await floating.mouse.up();
    const dragged = await bounds();
    expect(dragged.x).toBeLessThan(paused.x);
    expect(dragged.y).toBeLessThan(paused.y);
    await expect.poll(async () => JSON.parse(await readFile(path.join(dir, "save-v1.json"), "utf8")).settings.floatingPosition).toEqual({ x: dragged.x, y: dragged.y });
    // Patrol resumes along the display perimeter and rotates without shrinking.
    await app.evaluate(({BrowserWindow,screen}) => {
      globalThis.pawTestCursor = { x: -100000, y: -100000 };
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'));
      const a=screen.getDisplayMatching(w.getBounds()).workArea;
      w.setPosition(a.x+a.width-w.getBounds().width,a.y+30);
    });
    await home.getByLabel("散步范围", { exact: true }).selectOption("edges");
    const edgeStart = await bounds();
    await expect(floating.locator(".idle-pose-walk")).toBeVisible({ timeout: 20000 });
    await expect(floating.locator(".idle-actor.edge-right")).toBeVisible();
    await expect.poll(async () => (await bounds()).y).toBeGreaterThan(edgeStart.y + 8);
    const scales=await floating.locator(".idle-actor").evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return [Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)]});
    for(const scale of scales)expect(scale).toBeCloseTo(1,2);
    await floating.screenshot({ path: info.outputPath("edge-patrol.png"), omitBackground: true });
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('lock-screen'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(false);
    const locked=await bounds();
    await floating.waitForTimeout(500);
    expect(await bounds()).toEqual(locked);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('unlock-screen'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(true);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(false);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(true);
    await app.evaluate(({ systemPreferences }) => {
      globalThis.pawOriginalMotion = systemPreferences.getAnimationSettings;
      systemPreferences.getAnimationSettings = () => ({ prefersReducedMotion: true });
    });
    await expect(floating.locator("[data-idle-mode=rest]")).toBeVisible();
    const reduced = await bounds();
    await floating.waitForTimeout(500);
    expect(await bounds()).toEqual(reduced);
    await expect(home.getByText("系统已开启“减少动态效果”，散步与玩球暂时休息。")).toBeVisible();
    await home.screenshot({ path: info.outputPath("idle-settings.png") });
    await app.evaluate(({ systemPreferences }) => { systemPreferences.getAnimationSettings = globalThis.pawOriginalMotion; });
    await home.evaluate(() => window.pawprint.command({ type: "activity", enabled: true, topics: false }));
    const row = type => JSON.stringify({ type: "event_msg", timestamp: new Date().toISOString(), payload: { type, turn_id: "idle-work" } }) + "\n";
    await appendFile(log, row("task_started"));
    await expect(floating.locator(".cat.working")).toBeVisible({ timeout: 10000 });
    const working = await bounds();
    await floating.waitForTimeout(6500);
    expect(await bounds()).toEqual(working);
    await appendFile(log, row("task_complete"));
    await expect(floating.locator(".cat.perform")).toBeVisible({ timeout: 10000 });
    expect(await bounds()).toEqual(working);
    await home.getByRole("switch", { name: "待机散步与玩耍", exact: true }).click();
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.pets[0].genome).toEqual(before.pets[0].genome);
  } catch (error) {
    console.log("Idle diagnostics:", await app.evaluate(() => globalThis.pawIdleDiagnostic));
    throw error;
  } finally { await app.close(); }
});

test('focused floating pet has no clipped rectangular ring', async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paw-focus-ui-'));
  await seedMatureCompanion(dir);
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PAWPRINT_TEST_MODE: '1', PAWPRINT_TEST_DATA: dir, PAWPRINT_TEST_LAN: '1', PAWPRINT_TEST_CODEX_HOME: path.join(dir, 'codex') } });
  try {
    const floating = await app.firstWindow();
    const button = floating.locator('.float-cat-button');
    await button.focus();
    expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
    await button.click();
    expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
    await floating.screenshot({ path: info.outputPath('focused-pet-no-bars.png'), omitBackground: true });
  } finally { await app.close(); }
});

test('everyday tricks use real bounded windows, preserve birth skills and stop on hover', async ({}, info) => {
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-everyday-ui-'));
 await seedMatureCompanion(dir);
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try {
  await app.evaluate(({screen})=>{globalThis.pawEverydayCursor={x:-100000,y:-100000};screen.getCursorScreenPoint=()=>globalThis.pawEverydayCursor;});
  const floating=await app.firstWindow(),home=await openHome(app,'talents');
  const before=(await home.evaluate(()=>window.pawprint.getState())).data;
  await expect(home.locator('[data-skill-id="peek"]')).toContainText('已拥有');
  await home.getByRole('button',{name:'试试注意到什么',exact:true}).click();
  const attention=home.locator('.talent-stage .skill-observe');
  await expect(attention).toBeVisible();
  await expect.poll(()=>attention.locator('.cat-head-motion').evaluate(el=>getComputedStyle(el).animationName)).toBe('attention-head');
  await expect.poll(()=>attention.locator('.cat-gaze').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('attention-gaze');
  await home.waitForTimeout(1000);
  await attention.screenshot({path:info.outputPath('attention-head.png')});

  await home.getByRole('button',{name:'试试玩具滚出来了',exact:true}).click();
  await expect(floating.locator('.toy-surprise')).toBeVisible();
  await expect(floating.locator('.idle-pose-toyroll')).toBeVisible();
  await floating.screenshot({path:info.outputPath('toy-surprise.png'),omitBackground:true});
  await app.evaluate(({BrowserWindow,screen})=>{
   const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'));
   const a=screen.getDisplayMatching(w.getBounds()).workArea;w.setPosition(a.x+100,a.y+100);
  });
  await home.getByRole('button',{name:'试试屏幕边缘探头',exact:true}).click();
  await expect(floating.locator('.behavior-peek.phase-hide')).toBeVisible({timeout:10000});
  const peek=await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')),b=w.getBounds();return {bounds:b,area:screen.getDisplayMatching(b).workArea};});
  expect(peek.bounds.x).toBe(peek.area.x);
  await expect.poll(()=>floating.locator('.behavior-peek .cat').evaluate(el=>parseFloat(getComputedStyle(el).translate))).toBeLessThan(-40);
  await floating.screenshot({path:info.outputPath('edge-peek.png'),omitBackground:true});
  await expect(floating.locator('.behavior-peek.phase-reveal')).toBeVisible({timeout:5000});
  await app.evaluate(({BrowserWindow,screen})=>{
   const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')),b=w.getBounds(),a=screen.getDisplayMatching(b).workArea;
   w.setPosition(a.x+200,a.y+100);globalThis.pawEverydayCursor={x:a.x+600,y:a.y+220};
  });
  await home.getByRole('button',{name:'试试追一下鼠标',exact:true}).click();
  await expect(floating.locator('.behavior-mouse.phase-watch')).toBeVisible({timeout:5000});
  await expect(floating.locator('.behavior-mouse.phase-approach .cat')).toBeVisible({timeout:5000});
  await expect.poll(()=>floating.locator('.behavior-mouse.phase-approach .cat-frontpaw-left').evaluate(el=>getComputedStyle(el).animationName)).toBe('idle-step-paw');
  await floating.screenshot({path:info.outputPath('cursor-chasing.png'),omitBackground:true});
  await expect(floating.locator('.behavior-mouse.phase-pounce')).toBeVisible({timeout:6000});
  await expect.poll(()=>floating.locator('.cat-frontpaw-right').evaluate(el=>getComputedStyle(el).animationName)).toBe('everyday-pounce');
  await floating.waitForTimeout(1000);
  await floating.screenshot({path:info.outputPath('cursor-pounce.png'),omitBackground:true});
  await app.evaluate(({BrowserWindow})=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).getBounds();globalThis.pawEverydayCursor={x:b.x+110,y:b.y+130};});
  await expect(floating.locator('[data-idle-mode="rest"]')).toBeVisible();
  const after=(await home.evaluate(()=>window.pawprint.getState())).data;
  expect(after.pets.map(p=>[p.genome,p.skills,p.talent])).toEqual(before.pets.map(p=>[p.genome,p.skills,p.talent]));
  expect(after.balance).toBe(before.balance);
 } finally {await app.close();}
});

test('passive cursor attention looks toward the pointer without moving and honors its switch',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-attention-ui-'));const state=await seedMatureCompanion(dir);state.settings.idleEnabled=true;await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'settings');
  await app.evaluate(({screen,BrowserWindow,app})=>{
   const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')),a=screen.getDisplayMatching(w.getBounds()).workArea;
   w.setPosition(a.x+300,a.y+120);globalThis.attentionCursor={x:a.x+900,y:a.y+120};screen.getCursorScreenPoint=()=>globalThis.attentionCursor;
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const {CursorAttention}=req('./core/attention.mjs'),original=CursorAttention.prototype.step;
   CursorAttention.prototype.step=function(input){if(!this.testPrimed){this.nextAt=input.now+2800;this.testPrimed=true;}return original.call(this,input);};
  });
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).getBounds());
  const before=await bounds();await expect(floating.locator('.cursor-attention')).toBeVisible({timeout:5000});
  await expect.poll(()=>floating.locator('.cat-gaze').first().evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).e)).toBeGreaterThan(1);
  expect(await bounds()).toEqual(before);await floating.screenshot({path:info.outputPath('passive-cursor-glance.png'),omitBackground:true});
  await home.getByRole('switch',{name:'偶尔看向光标',exact:true}).click();await expect(floating.locator('.cursor-attention')).toHaveCount(0);expect(await bounds()).toEqual(before);
 }finally{await app.close();}
});

test('companion growth persists, counts interaction days once and previews a quiet greeting without spending',async({},info)=>{
 const {dayKey}=await import('../core/economy.mjs');
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-companion-ui-')),now=Date.now();const state=await seedMatureCompanion(dir);const p=state.pets[0];
 p.activeDays=Array.from({length:18},(_,i)=>dayKey(now-i*86400000));
 p.companion={version:1,counts:{touch:20,play:5,chat:25,night:0},days:[...p.activeDays],daily:{date:dayKey(now),touch:true},lastInteractionAt:now-3600000};await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 let app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const home=await openHome(app,'home');await expect(home.getByTestId('companion-profile')).toContainText('默契伙伴');await expect(home.getByTestId('companion-profile')).toContainText('摸摸 20 天');await expect(home.getByTestId('companion-profile')).not.toContainText('聊天 25 天');
  for(let i=0;i<5;i++){const r=await home.evaluate(id=>window.pawprint.command({type:'pet-interact',petId:id,kind:'touch'}),p.id);expect(r.ok).toBe(true);}
  const current=(await home.evaluate(()=>window.pawprint.getState())).data;expect(current.pets[0].companion.counts.touch).toBe(20);expect(current.pets[0].companion.counts.chat).toBe(25);expect(current.balance).toBe(state.balance);
  await home.getByTestId('companion-profile').screenshot({path:info.outputPath('growing-personality.png')});
  await home.evaluate(()=>window.pawprint.showHome('settings'));
  await home.getByRole('button',{name:'试试打个招呼',exact:true}).click();
  await expect.poll(()=>app.windows().some(w=>w.url().startsWith('data:'))).toBe(true);
  const bubble=app.windows().find(w=>w.url().startsWith('data:'));await expect(bubble.getByRole('status')).toBeVisible();await bubble.screenshot({path:info.outputPath('companion-greeting.png'),omitBackground:true});
  const preview=(await home.evaluate(()=>window.pawprint.getState())).data;expect(preview.companionNotes).toBeUndefined();expect(preview.balance).toBe(state.balance);
  await home.getByRole('switch',{name:'低频主动互动',exact:true}).click();await expect(home.getByRole('switch',{name:'低频主动互动',exact:true})).toHaveAttribute('aria-checked','false');const saved=(await home.evaluate(()=>window.pawprint.getState())).data;expect(saved.settings.companionProactive).toBe(false);const profile=structuredClone(saved.pets[0].companion);
  await app.close();app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
  const reopened=await openHome(app,'home'),after=(await reopened.evaluate(()=>window.pawprint.getState())).data;
  expect(after.settings.companionProactive).toBe(false);expect(after.pets[0].companion.counts).toEqual(profile.counts);
  for(const field of ['genome','skills','talent'])expect(after.pets[0][field]).toEqual(p[field]);
 }finally{await app.close();}
});

test('manual chase follows a far cursor in two dimensions while Codex is working',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-manual-chase-ui-'));await seedMatureCompanion(dir);
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'talents');
  await app.evaluate(({app,screen,BrowserWindow})=>{
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const {CodexActivity}=req('./electron/activity.mjs');CodexActivity.prototype.snapshot=()=>({enabled:true,status:'running',activeCount:1,event:null});
   const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')),a=screen.getDisplayMatching(w.getBounds()).workArea;
   w.setPosition(a.x+200,a.y+400);globalThis.manualPlayArea=a;globalThis.manualPlayCursor={x:a.x+a.width-80,y:a.y+50};screen.getCursorScreenPoint=()=>globalThis.manualPlayCursor;
  });
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).getBounds());
  const before=await bounds();await home.getByRole('button',{name:'试试追一下鼠标',exact:true}).click();
  await expect(floating.locator('.behavior-mouse.phase-approach')).toBeVisible({timeout:6000});await expect(floating.locator('.cat.working')).toHaveCount(0);
  await expect.poll(async()=>Math.hypot((await bounds()).x-before.x,(await bounds()).y-before.y)).toBeGreaterThan(80);
  const first=await bounds();expect(first.y).toBeLessThan(before.y);await floating.screenshot({path:info.outputPath('manual-chase-during-work.png'),omitBackground:true});
  await app.evaluate(()=>{const a=globalThis.manualPlayArea;globalThis.manualPlayCursor={x:a.x+40,y:a.y+a.height-40};});
  await expect.poll(async()=>(await bounds()).x).toBeLessThan(first.x-20);
  await expect(floating.locator('.behavior-mouse')).toHaveCount(0,{timeout:16000});await expect(floating.locator('.cat.working')).toBeVisible();
 }finally{await app.close();}
});

test('a due proactive greeting survives the cats own ball animation and actually appears',async({},info)=>{
 test.skip(new Date().getHours()<8||new Date().getHours()>=22,'Automatic greetings are intentionally quiet at night');
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-proactive-due-ui-'));const state=await seedMatureCompanion(dir);state.settings.idleEnabled=true;await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),opened=app.waitForEvent('window');await floating.evaluate(()=>window.pawprint.showHome('settings'));const home=await opened;
  await app.evaluate(({app,screen})=>{
   screen.getCursorScreenPoint=()=>({x:-100000,y:-100000});
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const {IdleDirector}=req('./core/idle.mjs'),move=IdleDirector.prototype.step;
   IdleDirector.prototype.step=function(input){if(!this.testPrimed){this.requestedBall=true;this.testPrimed=true;}return move.call(this,input);};
   const {CompanionInitiative}=req('./core/personality.mjs'),initiative=CompanionInitiative.prototype.step;
   CompanionInitiative.prototype.step=function(input){if(!this.testPrimed){this.nextAt=input.now+1000;this.testPrimed=true;}return initiative.call(this,input);};
  });
  await expect(floating.locator('.idle-pose-ball')).toBeVisible();
  await expect.poll(async()=>(await home.evaluate(()=>window.pawprint.getState())).data.companionNotes?.count,{timeout:12000}).toBe(1);
  await expect.poll(()=>app.windows().some(w=>w.url().startsWith('data:'))).toBe(true);
  const bubble=app.windows().find(w=>w.url().startsWith('data:'));await expect(bubble.getByRole('status')).toBeVisible();await bubble.screenshot({path:info.outputPath('automatic-proactive-greeting.png'),omitBackground:true});
  await home.getByRole('switch',{name:'低频主动互动',exact:true}).click();
  await expect(home.getByRole('switch',{name:'低频主动互动',exact:true})).toHaveAttribute('aria-checked','false');
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('data:')).some(w=>w.isVisible()))).toBe(false);
 }finally{await app.close();}
});

test('wiggling over a small cat triggers a gaze and short chase without clicking a skill',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-cursor-tease-ui-')),state=await seedMatureCompanion(dir);state.settings.petScale=.5;await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'home');
  await app.evaluate(({app,screen,BrowserWindow})=>{
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const {CodexActivity}=req('./electron/activity.mjs');CodexActivity.prototype.snapshot=()=>({enabled:true,status:'running',activeCount:1,event:null});
   const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')),a=screen.getDisplayMatching(w.getBounds()).workArea;w.setPosition(a.x+200,a.y+350);globalThis.teaseBounds=w.getBounds();globalThis.teaseArea=a;
   const b=globalThis.teaseBounds;globalThis.teaseCursor={x:b.x+b.width*.5,y:b.y+b.height*.5};screen.getCursorScreenPoint=()=>globalThis.teaseCursor;
  });
  for(const ratio of [.5,.65,.35,.65,.35,.65]){await app.evaluate((_,r)=>{const b=globalThis.teaseBounds;globalThis.teaseCursor={x:b.x+b.width*r,y:b.y+b.height*.5};},ratio);await floating.waitForTimeout(110);}
  await expect(floating.locator('.behavior-mouse.phase-watch .cursor-attention')).toBeVisible();
  await expect(floating.locator('.cat.working')).toHaveCount(0);
  await floating.screenshot({path:info.outputPath('wiggle-noticed.png'),omitBackground:true});
  await app.evaluate(()=>{const a=globalThis.teaseArea;globalThis.teaseCursor={x:a.x+a.width-60,y:a.y+40};});
  await expect(floating.locator('.behavior-mouse.phase-approach')).toBeVisible();
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).getBounds(),start=globalThis.teaseBounds;return Math.hypot(b.x-start.x,b.y-start.y);})).toBeGreaterThan(30);
  await expect(floating.locator('.behavior-mouse')).toHaveCount(0,{timeout:7000});await expect(floating.locator('.cat.working')).toBeVisible();
  const saved=(await home.evaluate(()=>window.pawprint.getState())).data;expect(saved.pets[0].companion.counts.play).toBe(1);
 }finally{await app.close();}
});
