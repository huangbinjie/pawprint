import {test, expect, _electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {openHome,openCodex} from './helpers.mjs';
import {parse} from 'smol-toml';
import {seedMatureCompanion} from './fixtures/game.mjs';

test('native pet menu and independent Codex Provider form preserve current login',async({},testInfo)=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'paw-account-desktop-')),codexHome=path.join(root,'codex');await mkdir(codexHome);
  const config='model = "gpt-existing"\napproval_policy = "on-request"\n';await writeFile(path.join(codexHome,'config.toml'),config);await writeFile(path.join(codexHome,'auth.json'),'unchanged-test-login');
  await seedMatureCompanion(path.join(root,'paw'));
  const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:path.join(root,'paw'),PAWPRINT_TEST_CODEX_HOME:codexHome}});
  let providerId;
  try {
    await app.evaluate(({Menu})=>{
      const original=Menu.buildFromTemplate.bind(Menu);globalThis.accountTestMenus=[];
      Menu.buildFromTemplate=template=>{const menu=original(template);globalThis.accountTestMenus.push({template,menu});return menu;};
    });
    const home=await openCodex(app);const errors=[];home.on('pageerror',e=>errors.push(e.message));
    const panel=home.locator('.codex-accounts');await expect(panel.getByRole('heading',{name:'连接与 Provider'})).toBeVisible();
    await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    await home.locator('.codex-tabs').getByRole('button',{name:'会话与提醒',exact:true}).click();
    const titleToggle=home.getByRole('switch',{name:'Provider 标题标注',exact:true});
    await expect(titleToggle).toHaveAttribute('aria-checked','true');
    await titleToggle.click();await expect(titleToggle).toHaveAttribute('aria-checked','false');
    await titleToggle.click();await expect(titleToggle).toHaveAttribute('aria-checked','true');
    await home.locator('.codex-tabs').getByRole('button',{name:'连接与 Provider',exact:true}).click();
    await panel.getByRole('button',{name:'添加 Provider',exact:true}).click();
    const modal=home.getByRole('dialog');
    await modal.getByLabel('Provider 名称',{exact:true}).fill('Desktop test provider');await modal.getByLabel('Base URL',{exact:true}).fill('https://example.com/v1');await modal.getByLabel('模型',{exact:true}).fill('test-model');await modal.getByLabel('API Key',{exact:true}).fill('dummy-desktop-test-key');
    await modal.getByRole('button',{name:'保存 Provider',exact:true}).click();await expect(panel.getByRole('button',{name:'选用 Desktop test provider',exact:true})).toBeVisible();
    providerId=(await home.evaluate(()=>window.pawprint.codexAccounts('status'))).data.providers[0].id;
    await expect(modal).not.toBeVisible();
    await home.screenshot({path:testInfo.outputPath('codex-account-settings.png')});
    const floating=app.windows().find(w=>w.url().endsWith('#floating'));
    await floating.locator('.float-cat-button').click();
    await expect.poll(()=>app.evaluate(()=>globalThis.accountTestMenus.some(({template})=>template.some(i=>i.label==='Codex 账号与 Provider')))).toBe(true);
    await app.evaluate(()=>{
      const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Codex 账号与 Provider'));entry.menu.closePopup();entry.menu.items.find(i=>i.label==='Codex 账号与 Provider').click();
    });
    await expect.poll(()=>app.evaluate(()=>globalThis.accountTestMenus.some(({template})=>template.some(i=>i.label==='Desktop test provider · test-model')))).toBe(true);
    const native=await app.evaluate(()=>{
      const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Desktop test provider · test-model'));entry.menu.closePopup();return entry.menu.items.map(i=>({label:i.label,checked:i.checked,enabled:i.enabled}));
    });
    expect(native.find(i=>i.label==='当前 ChatGPT / OpenAI 登录').checked).toBe(true);
    const status=(await home.evaluate(()=>window.pawprint.codexAccounts('status'))).data;
    expect(native.find(i=>i.label==='Desktop test provider · test-model').enabled).toBe(status.supported);
    const dock=app.windows().find(w=>w.url().endsWith('#petcontrols'));
    if(dock)expect((await dock.evaluate(()=>window.pawprint.codexAccounts('status'))).ok).toBe(false);
    await panel.getByRole('button',{name:'选用 Desktop test provider',exact:true}).click();
    await expect(panel.locator('.codex-current')).toContainText('Desktop test provider · test-model');
    expect(parse(await readFile(path.join(codexHome,'config.toml'),'utf8')).model_provider).toBe(providerId);
    await expect(panel.getByRole('button',{name:'删除 Desktop test provider',exact:true})).toBeEnabled();
    await panel.getByRole('button',{name:'删除 Desktop test provider',exact:true}).click();
    await expect(panel.getByText('将先恢复 ChatGPT 默认配置。',{exact:false})).toBeVisible();
    await panel.getByRole('button',{name:'取消删除',exact:true}).click();
    await expect(panel.getByRole('button',{name:'选用 Desktop test provider',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'删除 Desktop test provider',exact:true}).click();
    await panel.getByRole('button',{name:'确认删除',exact:true}).click();
    await expect(panel.getByRole('button',{name:'选用 Desktop test provider',exact:true})).toHaveCount(0);providerId=null;
    await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    const restored=parse(await readFile(path.join(codexHome,'config.toml'),'utf8'));delete restored.model_providers;expect(restored).toEqual(parse(config));expect(await readFile(path.join(codexHome,'auth.json'),'utf8')).toBe('unchanged-test-login');expect(errors).toEqual([]);
  } finally {
    if(providerId){const {MacKeychain}=await import('../electron/codex-accounts.mjs');await new MacKeychain().remove(providerId);}
    await app.close();await rm(root,{recursive:true,force:true});
  }
});

test('Codex hub groups provider tokens, keeps unknown prices explicit and hides paths by default',async({},info)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-codex-hub-')),profile=path.join(root,'profile'),codex=path.join(root,'codex');await mkdir(codex);
 const state=await seedMatureCompanion(profile);state.usage.readerVersion='native-v1';
 state.usage.report={days:[{date:(await import('../core/economy.mjs')).dayKey(Date.now()),tokens:3100,usd:null,knownUSD:0.01,unpriced:2,models:[{provider:'openai',name:'same-model',tokens:1000,inputTokens:800,cachedTokens:200,outputTokens:200,knownUSD:0.01,usd:0.01,unpriced:0},{provider:'custom-demo',name:'same-model',tokens:2000,inputTokens:1500,cachedTokens:500,outputTokens:500,knownUSD:0,usd:null,unpriced:1,referenceUSD:0.02,referenceKnownUSD:0.02,referenceUnpriced:0,usesModelReference:true},{provider:'unknown-test',name:'unmatched-model',tokens:100,inputTokens:80,cachedTokens:0,outputTokens:20,knownUSD:0,usd:null,unpriced:1}]}],updatedAt:new Date().toISOString(),complete:true,fresh:true,unpriced:1};
 const {Store}=await import('../core/store.mjs');const store=new Store(profile);await store.load();await store.save(state);
 await writeFile(path.join(codex,'config.toml'),'model="test-model"\n');await writeFile(path.join(profile,'codex-accounts.json'),JSON.stringify({providers:[{id:'custom-demo',name:'示例连接',model:'same-model',baseUrl:'https://api.example.com/v1'}]}));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:codex}});
 try{
  const home=await openCodex(app);await expect(home.getByRole('heading',{name:'Codex 助手',exact:true})).toBeVisible();
  await expect(home.getByLabel('API Key',{exact:true})).not.toBeVisible();
  await expect(home.getByText(path.join(codex,'config.toml'),{exact:true})).not.toBeVisible();
  await home.locator('.codex-tabs').getByRole('button',{name:'会话与提醒',exact:true}).click();await expect(home.getByText('例如：[我的 API] 项目讨论',{exact:true})).toBeVisible();
  await home.locator('.codex-tabs').getByRole('button',{name:'用量与额度',exact:true}).click();
  const rows=home.locator('.codex-usage-grid article');await expect(rows).toHaveCount(3);
  await expect(rows.filter({has:home.getByRole('heading',{name:'ChatGPT / OpenAI',exact:true})})).toContainText('1K tokens');
  const custom=rows.filter({has:home.getByRole('heading',{name:'示例连接',exact:true})});await expect(custom).toContainText('2K tokens');await expect(custom).toContainText('$0.02');
  await expect(rows.filter({has:home.getByRole('heading',{name:'unknown-test',exact:true})})).toContainText('未定价');await expect(custom).not.toContainText('$0.00');
  await home.screenshot({path:info.outputPath('codex-provider-usage.png')});
  await home.evaluate(()=>window.pawprint.showHome('usage'));
  const walletCustom=home.locator('.usage-model').filter({has:home.locator('.usage-provider').getByText('示例连接',{exact:true})});
  await expect(walletCustom).toBeVisible();await expect(walletCustom).toContainText('$0.02');await expect(walletCustom.locator('.usage-pending')).toHaveCount(0);
  await expect(home.locator('.usage-provider').getByText('custom-demo',{exact:true})).toHaveCount(0);
  await openCodex(app,'advanced');
  await home.locator('.codex-tabs').getByRole('button',{name:'高级设置',exact:true}).click();await expect(home.getByText(path.join(codex,'config.toml'),{exact:true})).not.toBeVisible();
  await home.getByText('查看本机路径',{exact:true}).first().click();await expect(home.getByText(path.join(codex,'config.toml'),{exact:true})).toBeVisible();
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
