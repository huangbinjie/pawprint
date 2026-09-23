import { _electron as electron, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GENE_COUNT,GENE_KEYS} from '../core/genetics.mjs';
import {petSkills} from '../core/skills.mjs';
import {quotaPresentation} from '../core/quota.mjs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const {listPackage}=createRequire(import.meta.url)('@electron/asar');
const files=listPackage(path.resolve('release/mac-arm64/Pawprint.app/Contents/Resources/app.asar'));
if(files.some(f=>/^\/(work|tests)\//.test(f)||f.endsWith('/lan-private-v1.json')||f.endsWith('/save-v1.json')))throw new Error('Private/test files unexpectedly included');
const qaDir = process.env.PAWPRINT_QA_DIR || 'work/v06';
await mkdir(qaDir,{recursive:true});
const before=JSON.parse(await readFile(path.join(qaDir, 'before-save.json'),'utf8'));
const beforeLanEnabled=JSON.parse(await readFile(path.join(os.homedir(),'Library/Application Support/Pawprint/lan-private-v1.json'),'utf8')).enabled;
const standalone=await mkdtemp(path.join(os.tmpdir(),'pawprint-portable-'));
await cp(path.resolve('release/mac-arm64/Pawprint.app'),path.join(standalone,'Pawprint.app'),{recursive:true,verbatimSymlinks:true});
const app=await electron.launch({executablePath:path.join(standalone,'Pawprint.app/Contents/MacOS/Pawprint'),args:[],cwd:standalone,env:{...process.env,NODE_PATH:''}});
app.process().stderr?.on("data",data=>process.stderr.write(data));
let restoreLanguage=null,homePage=null;
try{
 await expect.poll(async()=>app.evaluate(({app,BrowserWindow})=>{app.emit('activate');return BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('#home'));}),{timeout:15000}).toBe(true);
 const home=app.windows().find(w=>w.url().endsWith('#home'));homePage=home;const errors=[];home.on('pageerror',e=>errors.push(e.message));
 await expect(home.getByRole('heading',{name:/^(我的小屋|My Home)$/})).toBeVisible();
 const after=(await home.evaluate(()=>window.pawprint.getState())).data;restoreLanguage=after.settings.language||'zh';
 if(restoreLanguage==='en')await home.evaluate(()=>window.pawprint.command({type:'language',value:'zh'}));
 for(const key of ['balance','ledger','freeEggClaimed','activePetId','capacity'])expect(after[key]).toEqual(before[key]);
 for(const group of ['pets','eggs']){expect(after[group].length).toBe(before[group].length);before[group].forEach((p,i)=>{const q=after[group][i];for(const k of Object.keys(p.genome))expect(q.genome[k]).toEqual(p.genome[k]);for(const k of ['id','name','generation','origin','createdAt','readyAt','lastBredAt','breedCount'])expect(q[k]).toEqual(p[k]);expect(q.talent).toEqual(p.talent);expect(q.skills).toEqual(petSkills(p));});}
 expect(after.lan.enabled).toBe(beforeLanEnabled);
 await home.getByRole('button',{name:'才艺小剧场',exact:true}).click();await home.getByRole('button',{name:'表演一下',exact:true}).click();await expect(home.locator('.talent-stage .cat.perform')).toBeVisible();await home.screenshot({path:path.join(qaDir, 'talent.png')});
 await home.getByRole('button',{name:'基因图鉴',exact:true}).click();await expect(home.locator('.catalog-count strong')).toHaveText(String(GENE_COUNT));await home.getByRole('tab',{name:/^瞳孔(?:\s|$)/}).click();await home.screenshot({path:path.join(qaDir, 'catalog.png')});
 await home.getByRole('button',{name:'附近的小屋',exact:true}).click();await expect(home.getByRole('button',{name:beforeLanEnabled?'关闭局域网':'开启局域网小屋'})).toBeVisible();await home.screenshot({path:path.join(qaDir, 'nearby-off.png')});
 const cryptoPortable=await app.evaluate(async({app},root)=>{
  const path=process.getBuiltinModule('path');
  const req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
  const {LanService}=req('./electron/lan/service.mjs');
  const {initialState}=req('./core/game.mjs');
  const make=folder=>new LanService({directory:path.join(root,folder),getGame:()=>initialState(Date.now()),command:()=>{throw new Error('Not used');},testHost:'127.0.0.1',discovery:false});
  const a=make('crypto-a'),b=make('crypto-b');try{await a.init();await b.init();await a.enable();await b.enable();await a.pair(b.inviteCode());await b.answerPair(b.snapshot().pairRequests[0].id,true);await a.poll();return a.snapshot().peers.length===1;}finally{await a.close();await b.close();}
 },standalone);expect(cryptoPortable).toBe(true);
 const activityPortable = await app.evaluate(async ({app},root) => {
  const path = process.getBuiltinModule('path');
  const fs = process.getBuiltinModule('fs/promises');
  const req = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
  const {CodexActivity} = req('./electron/activity.mjs');
  const directory = path.join(root,'activity-fixture');
  const folder = path.join(directory,'sessions',new Date().toISOString().slice(0,10).replaceAll('-','/'));
  await fs.mkdir(folder,{recursive:true});
  const file = path.join(folder,'fixture.jsonl');
  const row = (type,extra={}) => JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type,turn_id:'portable-check',...extra}})+'\n';
  await fs.writeFile(file,'');
  const watcher = new CodexActivity({onChange:()=>{}});
  try {
   await watcher.configure({directory,enabled:true,topics:true});
   await fs.appendFile(file,row('task_started')+row('item_completed',{item:{type:'UserMessage',content:[{type:'Text',text:'帮我设计界面'}]}}));
   await watcher.poll();
   const running=watcher.snapshot().status==='running' && watcher.snapshot().event.text==='陪你做设计';
   await fs.appendFile(file,row('task_complete'));
   await watcher.poll();
   return running && watcher.snapshot().event.kind==='completed';
  }finally{await watcher.close();}
 },standalone);expect(activityPortable).toBe(true);
 const idlePortable = await app.evaluate(({app,systemPreferences}) => {
  const path = process.getBuiltinModule('path');
  const req = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
  const {IdleDirector} = req('./core/idle.mjs');
  const director = new IdleDirector({random:()=>0.8});
  let position = {x:780,y:300},result;
  for(let now=0;now<=12000;now+=100){result=director.step({now,position,area:{x:0,y:0,width:1000,height:800},enabled:true,route:'edges',toys:false});position=result.position;}
  return result.visual.mode==='walk' && position.y>300 && typeof systemPreferences.getAnimationSettings().prefersReducedMotion==='boolean';
 });expect(idlePortable).toBe(true);
 await home.getByRole('button',{name:'偏好设置',exact:true}).click();
 await expect(home.getByRole('switch',{name:'待机散步与玩耍',exact:true})).toBeVisible();
 let nativeQuotaTitle = null;
 if (process.env.PAWPRINT_ENABLE_QUOTA === '1') {
  await app.evaluate(({Tray}) => {
   const original=Tray.prototype.setTitle;
   Tray.prototype.setTitle=function(title,...rest){globalThis.pawNativeQuotaTitle=title;return original.call(this,title,...rest);};
  });
  const enabled=await home.evaluate(()=>window.pawprint.command({type:'quota-settings',enabled:true,window:'weekly'}));
  expect(enabled.ok).toBe(true);
  expect(enabled.data.quota.error).toBeNull();
  expect(enabled.data.quota.data?.windows.weekly).toBeTruthy();
  const expected=quotaPresentation(enabled.data.quota,'weekly').title;
  nativeQuotaTitle=await app.evaluate(()=>globalThis.pawNativeQuotaTitle);
  expect(nativeQuotaTitle.startsWith(expected)).toBe(true);
  await home.getByTestId('quota-preview').scrollIntoViewIfNeeded();
  await home.screenshot({path:path.join(qaDir,'quota-settings.png')});
 }
 const requestedScale = Number(process.env.PAWPRINT_SET_SCALE);
 if (Number.isInteger(requestedScale) && requestedScale >= 50 && requestedScale <= 100) {
  const scaled = await home.evaluate(percent => window.pawprint.command({type:'pet-scale',percent}),requestedScale);
  expect(scaled.ok).toBe(true);
  const actual = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'))?.getBounds());
  if(actual)expect(actual.width).toBe(Math.round(220*requestedScale/100));
 }
 await home.getByRole('slider',{name:'桌面宠物尺寸',exact:true}).scrollIntoViewIfNeeded();
 await home.screenshot({path:path.join(qaDir,'idle-settings.png')});
 let languageRoundTripVerified=false, floatingScrollVerified=false;
 if(process.env.PAWPRINT_CHECK_LANGUAGE==='1'){
  await home.getByLabel('界面语言',{exact:true}).selectOption('en');
  await expect(home.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible();
  await home.getByLabel('Interface language').scrollIntoViewIfNeeded();
  await home.screenshot({path:path.join(qaDir,'english-preferences.png')});
  const floating=app.windows().find(w=>w.url().endsWith('#floating'));
  if(floating){
   await floating.mouse.move(45,65);await floating.mouse.wheel(100,400);
   const metrics=await floating.evaluate(()=>({x:scrollX,y:scrollY,w:document.documentElement.scrollWidth-innerWidth,h:document.documentElement.scrollHeight-innerHeight}));
   expect(metrics).toEqual({x:0,y:0,w:0,h:0});floatingScrollVerified=true;
   await floating.screenshot({path:path.join(qaDir,'fixed-floating.png'),omitBackground:true});
  }
  await home.getByLabel('Interface language').selectOption(restoreLanguage);
  languageRoundTripVerified=true;
 }
 const result={languageRoundTripVerified,floatingScrollVerified,nativeQuotaTitle,standaloneIdleVerified:idlePortable,standaloneActivityVerified:activityPortable,version:await app.evaluate(({app})=>app.getVersion()),standalonePackageAndTLSVerified:cryptoPortable,originalMoneyAndGenesPreserved:true,noPetsMoved:true,lanPreferencePreserved:true,localDataNotInPackage:true,genes:GENE_COUNT,categories:GENE_KEYS.length,skillsCatalogCount:17,skillsGranted:after.pets.map(p=>({name:p.name,talent:p.talent.id,skills:p.skills})),petScalePercent:(await home.evaluate(()=>window.pawprint.getState())).data.settings.petScale*100,rendererErrors:errors};expect(errors).toEqual([]);await writeFile(path.join(qaDir, 'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(restoreLanguage&&homePage&&!homePage.isClosed())await homePage.evaluate(value=>window.pawprint.command({type:'language',value}),restoreLanguage).catch(()=>{});await app.close();try{execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',path.join(standalone,'Pawprint.app')],{stdio:'ignore'});}catch{}await rm(standalone,{recursive:true,force:true});}
