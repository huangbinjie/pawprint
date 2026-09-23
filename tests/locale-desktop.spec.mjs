import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { Store } from "../core/store.mjs";
import { openHome } from "./helpers.mjs";
const unlocalized = page => page.evaluate(() => {
  const texts=[], walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const node=walker.currentNode, el=node.parentElement;
    if(!el||el.closest('[translate="no"],[data-user-text],script,style')||!el.getClientRects().length)continue;
    if(/[\u3400-\u9fff]/.test(node.textContent))texts.push(node.textContent.trim());
  }
  return [...new Set(texts)].filter(Boolean);
});
test("floating canvas never scrolls; English covers all pages, menus and reactions and survives restart", async ({}, info) => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-locale-'));
  const state=await seedMatureCompanion(dir);state.pets[0].name='我的小屋';
  const store=new Store(dir);await store.load();await store.save(state);
  const codex=path.join(dir,'codex'), folder=path.join(codex,'sessions',new Date().toISOString().slice(0,10).replaceAll('-','/'));
  await mkdir(folder,{recursive:true}); const log=path.join(folder,'fixture.jsonl');await writeFile(log,'');
  const launch=()=>electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_CODEX_HOME:codex,PAWPRINT_TEST_LAN:'1'}});
  let app=await launch();
  try {
    let floating=await app.firstWindow(), home=await openHome(app,'settings');
    const beforeUI=(await home.evaluate(()=>window.pawprint.getState())).data;
    for(const percent of [50,70,100]) {
      await home.evaluate(p=>window.pawprint.command({type:'pet-scale',percent:p}),percent);
      await floating.mouse.move(55,65);await floating.mouse.wheel(400,500);
      await floating.evaluate(()=>window.scrollTo(999,999));
      const metrics=await floating.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth,docWidth:document.documentElement.scrollWidth,height:innerHeight,docHeight:document.documentElement.scrollHeight,rootTop:document.getElementById('root').scrollTop}));
      expect(metrics.x).toBe(0);expect(metrics.y).toBe(0);expect(metrics.rootTop).toBe(0);
      expect(metrics.docWidth).toBe(metrics.width);expect(metrics.docHeight).toBe(metrics.height);
      await floating.screenshot({path:info.outputPath(`no-scroll-${percent}.png`),omitBackground:true});
    }
    await app.evaluate(({Menu})=>{const original=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){const flatten=items=>items.flatMap(i=>[i.label,...(Array.isArray(i.submenu)?flatten(i.submenu):[])]).filter(Boolean);const labels=flatten(items);const menu=original.call(this,items);globalThis.pawMenuLabels=labels;return menu;};});
    await home.getByLabel('界面语言',{exact:true}).selectOption('en');
    await expect(home.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible();
    expect(await home.evaluate(()=>document.documentElement.lang)).toBe('en-US');
    const labels=await app.evaluate(()=>globalThis.pawMenuLabels);
    expect(labels).toContain('Quit Pawprint');expect(labels).toContain('Pawprint · 我的小屋');
    const missing={};
    for(const tab of ['My Home','My Pets','Garden','Skills & Talents','Nearby Homes','Gene Catalog','Breeding','Usage & Wallet','Preferences']) {
      await home.locator('.sidebar').getByRole('button',{name:new RegExp('^'+tab.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
      const texts=await unlocalized(home);if(texts.length)missing[tab]=texts;
      if(tab==='My Home')await expect(home.locator('[data-user-text]').filter({hasText:'我的小屋'}).first()).toBeVisible();
      if(['My Home','Skills & Talents','Preferences'].includes(tab))await home.screenshot({path:info.outputPath(`english-${tab.replaceAll(' ','-')}.png`)});
      if(tab==='Gene Catalog') {
        await home.getByRole('textbox',{name:'Search genes in this category'}).fill('cream');
        await expect(home.locator('.gene-option')).toHaveCount(1);
        await expect(home.locator('.gene-option h3')).toHaveText('Cream');
      }
    }
    expect(missing).toEqual({});
    await home.locator('.sidebar').getByRole('button',{name:'My Home',exact:true}).click();
    await home.getByRole('button',{name:'View genes',exact:true}).click();
    await expect(home.getByRole('heading',{name:'Gene profile: 我的小屋',exact:true})).toBeVisible();
    expect(await unlocalized(home)).toEqual([]);
    await home.getByRole('button',{name:'Close dialog'}).click();
    await home.getByRole('button',{name:'Rename',exact:true}).click();
    await expect(home.getByRole('textbox',{name:'Pet name',exact:true})).toHaveValue('我的小屋');
    await home.keyboard.press('Escape');
    await home.locator('.sidebar').getByRole('button',{name:'Preferences',exact:true}).click();
    const denied=await home.evaluate(()=>window.pawprint.command({type:'expand'}));
    expect(denied.ok).toBe(false);expect(denied.error).toContain('Not enough available pet coins');
    const after=(await home.evaluate(()=>window.pawprint.getState())).data;
    expect(after.pets).toEqual(beforeUI.pets);expect(after.balance).toBe(beforeUI.balance);
    await home.getByRole('switch',{name:'Codex conversation reactions'}).click();
    await expect(home.getByTestId('activity-status')).toContainText('Connected; waiting for the next turn');
    const event=type=>JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type,turn_id:'locale-turn'}})+'\n';
    await appendFile(log,event('task_started'));
    await expect.poll(()=>app.windows().some(w=>w.url().startsWith('data:text/html')),{timeout:10000}).toBe(true);
    const bubble=app.windows().find(w=>w.url().startsWith('data:text/html'));
    await expect(bubble.locator('.bubble')).toContainText("Let's work together",{timeout:10000});
    await appendFile(log,event('task_complete'));
    await expect(bubble.locator('.bubble')).toContainText('This reply is finished',{timeout:10000});
    await app.close();app=await launch();floating=await app.firstWindow();
    await expect(floating.getByRole('button',{name:'Desktop pet'})).toBeVisible();
    home=await openHome(app,'settings');
    await expect(home.getByLabel('Interface language')).toHaveValue('en');
    await home.getByLabel('Interface language').selectOption('zh');
    await expect(home.getByRole('heading',{name:'偏好设置',exact:true})).toBeVisible();
  } finally {await app.close();}
});

test("English and Chinese clients pair, visit and perform without translating names or scrolling guests", async ({}, info) => {
  const root=await mkdtemp(path.join(os.tmpdir(),'pawprint-bilingual-'));
  for(const [id,lang] of [['a','zh'],['b','en']]) {
    const s=await seedMatureCompanion(path.join(root,id));s.settings.language=lang;s.settings.petScale=.7;
    const store=new Store(path.join(root,id));await store.load();await store.save(s);
  }
  const start=id=>electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:path.join(root,id),PAWPRINT_TEST_LAN:'1'}});
  const a=await start('a'),b=await start('b');
  try {
    const pa=await openHome(a,'nearby'),pb=await openHome(b,'nearby');
    await pa.getByRole('button',{name:'开启局域网小屋',exact:true}).click();
    await pa.getByRole('button',{name:'同意并开启局域网'}).click();
    await pb.getByRole('button',{name:'Enable LAN home',exact:true}).click();
    await pb.getByRole('button',{name:'Agree and enable LAN'}).click();
    const code=(await pb.evaluate(()=>window.pawprint.getState())).data.lan.inviteCode;
    await pa.evaluate(code=>window.pawprint.lan({type:'pair',code}),code);
    await pb.getByRole('button',{name:'Accept connection'}).click();
    await expect(pa.getByRole('button',{name:'申请串门',exact:true})).toBeEnabled({timeout:15000});
    await pa.getByRole('button',{name:'申请串门',exact:true}).click();
    await pb.getByRole('button',{name:'Welcome over'}).click();
    await expect.poll(()=>b.windows().some(w=>w.url().includes('#guest:'))).toBe(true);
    const guest=b.windows().find(w=>w.url().includes('#guest:'));
    expect(await unlocalized(pb)).toEqual([]);
    await pb.getByRole('button',{name:/leads: Paw-five greeting/}).first().click();
    await expect(guest.locator('.social-scene')).toHaveAttribute('aria-label','Social skill: Paw-five greeting');
    await guest.mouse.move(80,70);await guest.mouse.wheel(100,400);
    expect(await guest.evaluate(()=>({x:scrollX,y:scrollY,width:document.documentElement.scrollWidth-innerWidth,height:document.documentElement.scrollHeight-innerHeight}))).toEqual({x:0,y:0,width:0,height:0});
    await guest.screenshot({path:info.outputPath('english-social-no-scroll.png'),omitBackground:true});
    await guest.getByRole('button',{name:'End performance'}).click();
    await expect(guest.getByRole('button',{name:'Visiting pet'})).toBeVisible();
    await pb.screenshot({path:info.outputPath('english-nearby.png')});
  } finally {await a.close();await b.close();}
});
