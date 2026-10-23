import {test, expect, _electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import net from 'node:net';
import {openHome,openCodex} from './helpers.mjs';
import {parse} from 'smol-toml';
import {seedMatureCompanion} from './fixtures/game.mjs';
import {CodexAccounts} from '../electron/codex-accounts.mjs';

test('provider deletion opens in viewport and keeps failures inside the confirmation dialog',async({},info)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-delete-dialog-')),profile=path.join(root,'paw'),codex=path.join(root,'codex');
 await mkdir(codex);await seedMatureCompanion(profile);
 const config='model="gpt-existing"\n[features]\nremote_models=false\napps=false\nplugins=false\n';
 const providers=Array.from({length:8},(_,n)=>({id:`pawprint_delete_test_${n}`,name:`Delete test ${n}`,model:'test-model',baseUrl:'https://example.com/v1'}));
 await writeFile(path.join(codex,'config.toml'),config);await writeFile(path.join(profile,'codex-accounts.json'),JSON.stringify({providers}));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:codex}});
 try{
  await app.evaluate(({app})=>{
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   globalThis.deleteTestCalls=[];globalThis.deleteTestFailure=true;
   req('./electron/codex-accounts.mjs').MacKeychain.prototype.remove=async id=>{
    globalThis.deleteTestCalls.push(id);if(globalThis.deleteTestFailure)throw Error('Isolated keychain failure');
    await new Promise(resolve=>{globalThis.finishDeleteTest=resolve;});
   };
  });
  const home=await openCodex(app),panel=home.locator('.codex-accounts'),trigger=panel.getByRole('button',{name:'删除 Delete test 0',exact:true});
  await trigger.click();const dialog=home.getByRole('dialog');
  await expect(dialog).toBeInViewport();await expect(dialog).toContainText('Delete test 0');
  await expect(dialog.getByRole('button',{name:'取消删除',exact:true})).toBeFocused();
  expect(await app.evaluate(()=>globalThis.deleteTestCalls)).toEqual([]);
  await home.screenshot({path:info.outputPath('delete-provider-confirmation.png')});
  await dialog.getByRole('button',{name:'取消删除',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  await trigger.click();await home.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  expect(await app.evaluate(()=>globalThis.deleteTestCalls)).toEqual([]);
  await trigger.click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Isolated keychain failure');await expect(dialog).toBeInViewport();
  expect(JSON.parse(await readFile(path.join(profile,'codex-accounts.json'),'utf8')).providers).toHaveLength(8);
  await app.evaluate(()=>{globalThis.deleteTestFailure=false;});await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'正在删除…',exact:true})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'取消删除',exact:true})).toBeDisabled();
  await home.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await expect.poll(()=>app.evaluate(()=>typeof globalThis.finishDeleteTest)).toBe('function');await app.evaluate(()=>globalThis.finishDeleteTest());
  await expect(dialog).not.toBeVisible();await expect(trigger).toHaveCount(0);
  expect(await app.evaluate(()=>globalThis.deleteTestCalls)).toEqual([providers[0].id,providers[0].id]);
  expect(JSON.parse(await readFile(path.join(profile,'codex-accounts.json'),'utf8')).providers).toHaveLength(7);
  expect(await readFile(path.join(codex,'config.toml'),'utf8')).toBe(config);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('account preservation is fixed on without a setting or entitlement detector',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-fixed-identity-')),directory=path.join(root,'codex'),profile=path.join(root,'paw');await mkdir(directory);await seedMatureCompanion(profile);
 const original='model="gpt-existing"\n[features]\nremote_models=false\napps=false\nplugins=false\n',login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'DUMMY_ACCESS',id_token:'DUMMY_ID'}});
 await writeFile(path.join(directory,'config.toml'),original);await writeFile(path.join(directory,'auth.json'),login);
 const keychain={set:async()=>{},get:async()=> 'dummy',remove:async()=>{}},manager=new CodexAccounts({directory,dataDirectory:profile,keychain,running:async()=>false});await manager.load();
 const added=await manager.add({name:'Identity test provider',baseUrl:'https://example.com/v1',model:'test-model',apiKey:'dummy'}),id=added.providers[0].id;
 await writeFile(manager.stateFile,JSON.stringify({...manager.state,preserveDot:false,connectionMode:'api'}));
 const env={...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:directory};let app,home;
 const launch=async()=>{app=await electron.launch({args:['.'],env});await app.evaluate(({app})=>{const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));req('./electron/codex-accounts.mjs').MacKeychain.prototype.get=async()=> 'dummy';});home=await openCodex(app);};
 try{
  await launch();const panel=()=>home.locator('.codex-accounts');
  await expect(panel().getByRole('switch')).toHaveCount(0);await expect(panel().getByText('保留 Dot 等账号服务',{exact:true})).toHaveCount(0);
  await expect(panel().getByText('独立 API 模式',{exact:true})).toHaveCount(0);await expect(panel().getByRole('button',{name:'修复 Dot 入口',exact:true})).toHaveCount(0);
  await panel().getByRole('button',{name:'选用 Identity test provider',exact:true}).click();await expect(panel().locator('.codex-current')).toContainText('Identity test provider');
  let config=parse(await readFile(path.join(directory,'config.toml'),'utf8')),base=config.openai_base_url;
  expect(config.model_provider).toBe('openai');expect(config.model_providers[id].requires_openai_auth).toBe(true);expect(config.model_providers[id].auth).toBeUndefined();
  await expect(panel().locator(':scope > p').filter({hasText:'配置模型不在客户端列表中，此连接固定使用配置模型，忽略聊天框的模型选择。'})).toBeVisible();
  await writeFile(path.join(directory,'config.toml'),(await readFile(path.join(directory,'config.toml'),'utf8')).replace('model = "test-model"','model = "gpt-picker-choice"'));
  expect(JSON.parse(await readFile(manager.stateFile,'utf8')).preserveDot).toBeUndefined();
  await panel().getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel().getByRole('switch')).toHaveCount(0);
  await expect(panel().locator('.codex-current')).toContainText('test-model');await expect(panel().locator('.codex-current')).not.toContainText('gpt-picker-choice');
  await panel().getByText('切换说明',{exact:true}).click();await expect(panel().getByText('默认保留 Dot 等账号入口，实际权限以客户端为准。',{exact:true})).toBeVisible();
  await app.close();await launch();await expect(panel().getByRole('switch')).toHaveCount(0);await expect(panel().locator('.codex-current')).toContainText('Identity test provider');
  expect(parse(await readFile(path.join(directory,'config.toml'),'utf8')).openai_base_url).toBe(base);
  await panel().getByRole('button',{name:'添加 Provider',exact:true}).click();const modal=home.getByRole('dialog');
  await modal.getByLabel('Provider 名称',{exact:true}).fill('GPT picker gateway');await modal.getByLabel('Base URL',{exact:true}).fill('https://example.com/v1');await modal.getByLabel('模型',{exact:true}).fill('gpt-6.1-sol');await modal.getByLabel('API Key',{exact:true}).fill('dummy');
  await modal.getByRole('button',{name:'保存 Provider',exact:true}).click();await expect(modal).not.toBeVisible();
  await panel().getByRole('button',{name:'选用 GPT picker gateway',exact:true}).click();await expect(panel().locator('.codex-model-selection')).toHaveText('配置模型在客户端列表中，此连接保留聊天框的模型选择。');
  await writeFile(path.join(directory,'config.toml'),(await readFile(path.join(directory,'config.toml'),'utf8')).replace('model = "gpt-6.1-sol"','model = "gpt-6-astra"'));
  await panel().getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel().locator('.codex-current')).toContainText('gpt-6-astra');
  await app.evaluate(({app})=>{const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json')),prototype=req('./electron/codex-provider-titles.mjs').CodexTitleClient.prototype;globalThis.originalModelListRequest=prototype.request;prototype.request=function(method,params){return method==='model/list'?Promise.reject(Error('Isolated metadata failure')):globalThis.originalModelListRequest.call(this,method,params);};});
  await panel().getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel().locator('.codex-model-selection')).toHaveText('暂未读取到客户端模型列表，保留聊天框选择；可刷新状态后重试。');
  await app.evaluate(({app})=>{const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));req('./electron/codex-provider-titles.mjs').CodexTitleClient.prototype.request=globalThis.originalModelListRequest;delete globalThis.originalModelListRequest;});
  await panel().getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel().locator('.codex-model-selection')).toHaveText('配置模型在客户端列表中，此连接保留聊天框的模型选择。');
  await panel().getByRole('button',{name:'选用 ChatGPT',exact:true}).click();await expect(panel().locator('.codex-current')).toContainText('ChatGPT / OpenAI');
  config=parse(await readFile(path.join(directory,'config.toml'),'utf8'));expect(new URL(config.openai_base_url).pathname).toMatch(/\/openai\/v1$/);expect(config.model).toBe('gpt-existing');expect(await readFile(path.join(directory,'auth.json'),'utf8')).toBe(login);
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
});

test('native pet menu and independent Codex Provider form preserve current login',async({},testInfo)=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'paw-account-desktop-')),codexHome=path.join(root,'codex');await mkdir(codexHome);
  await mkdir(path.join(codexHome,'ipc'));const refreshMessages=[],refreshSockets=new Set();
  const refreshServer=net.createServer(socket=>{
    refreshSockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>refreshSockets.delete(socket));let data=Buffer.alloc(0);
    socket.on('data',bytes=>{data=Buffer.concat([data,bytes]);while(data.length>=4){const length=data.readUInt32LE(0);if(data.length<length+4)return;const m=JSON.parse(data.subarray(4,length+4));data=data.subarray(length+4);
      if(m.method==='initialize'){const reply=Buffer.from(JSON.stringify({type:'response',method:'initialize',requestId:m.requestId,resultType:'success',result:{clientId:'desktop-refresh-test'}})),header=Buffer.alloc(4);header.writeUInt32LE(reply.length);socket.write(Buffer.concat([header,reply]));}
      else refreshMessages.push(m);
    }});
  });
  await new Promise(resolve=>refreshServer.listen(path.join(codexHome,'ipc','ipc.sock'),resolve));
  const login=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'DUMMY_ACCESS',id_token:'DUMMY_ID'}});
  const config='model = "gpt-existing"\napproval_policy = "on-request"\n[features]\nremote_models=false\napps=false\nplugins=false\n';await writeFile(path.join(codexHome,'config.toml'),config);await writeFile(path.join(codexHome,'auth.json'),login);
  await seedMatureCompanion(path.join(root,'paw'));
  const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:path.join(root,'paw'),PAWPRINT_TEST_CODEX_HOME:codexHome}});
  let providerId;
  try {
    await app.evaluate(({Menu,Notification,shell})=>{
      const original=Menu.buildFromTemplate.bind(Menu);globalThis.accountTestMenus=[];
      Menu.buildFromTemplate=template=>{const menu=original(template);globalThis.accountTestMenus.push({template,menu});return menu;};
      // Inspect the built native menu without opening a Cocoa modal menu,
      // which can block subsequent Electron RPCs in an unattended test.
      globalThis.petPopupCount=0;Menu.prototype.popup=function(){globalThis.petPopupCount++;};
      globalThis.accountSwitchNotices=[];Notification.isSupported=()=>true;
      Notification.prototype.show=function(){globalThis.accountSwitchNotices.push({title:this.title,body:this.body,silent:this.silent});};
      globalThis.accountNotificationSettings=[];shell.openExternal=async url=>{globalThis.accountNotificationSettings.push(url);};
    });
    const home=await openCodex(app);const errors=[];home.on('pageerror',e=>errors.push(e.message));
    const panel=home.locator('.codex-accounts');await expect(panel.getByRole('heading',{name:'连接与 Provider'})).toBeVisible();
    await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    await expect(panel.getByText('切换结果已默认发送系统通知。未弹出时，请为 Pawprint 开启通知并选择横幅。',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'打开通知设置',exact:true}).click();
    expect(await app.evaluate(()=>globalThis.accountNotificationSettings)).toEqual(['x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=studio.binmax.pawprint']);
    expect(await readFile(path.join(codexHome,'config.toml'),'utf8')).toBe(config);
    await expect(panel.getByRole('switch',{name:'保留 Dot 等账号服务',exact:true})).toHaveCount(0);
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
    const beforeClick=await app.evaluate(()=>globalThis.petPopupCount);
    await floating.locator('.float-cat-button').click();
    // Wait past the former 500 ms single-click menu delay.
    await floating.waitForTimeout(700);expect(await app.evaluate(()=>globalThis.petPopupCount)).toBe(beforeClick);
    await floating.locator('.float-cat-button').click({button:'right'});
    await expect.poll(()=>app.evaluate(()=>globalThis.petPopupCount)).toBe(beforeClick+1);
    await expect.poll(()=>app.evaluate(()=>globalThis.accountTestMenus.some(({template})=>template.some(i=>i.label==='Codex 账号与 Provider')))).toBe(true);
    await app.evaluate(()=>{
      const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Codex 账号与 Provider'));entry.menu.closePopup();entry.menu.items.find(i=>i.label==='Codex 账号与 Provider').click();
    });
    await expect.poll(()=>app.evaluate(()=>globalThis.accountTestMenus.some(({template})=>template.some(i=>i.label==='Desktop test provider · test-model')))).toBe(true);
    const native=await app.evaluate(()=>{
      const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Desktop test provider · test-model'));entry.menu.closePopup();return entry.menu.items.map(i=>({label:i.label,checked:i.checked,enabled:i.enabled}));
    });
    expect(native.find(i=>i.label==='当前 ChatGPT / OpenAI 登录').checked).toBe(true);
    await app.evaluate(()=>{const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Desktop test provider · test-model'));entry.menu.items.find(i=>i.label==='切换通知未显示？打开通知设置').click();});
    await expect.poll(()=>app.evaluate(()=>globalThis.accountNotificationSettings.length)).toBe(2);
    const status=(await home.evaluate(()=>window.pawprint.codexAccounts('status'))).data;
    expect(native.find(i=>i.label==='Desktop test provider · test-model').enabled).toBe(status.supported);
    const dock=app.windows().find(w=>w.url().endsWith('#petcontrols'));
    if(dock)expect((await dock.evaluate(()=>window.pawprint.codexAccounts('status'))).ok).toBe(false);
    await panel.getByRole('button',{name:'选用 Desktop test provider',exact:true}).click();
    await expect(panel.locator('.codex-current')).toContainText('Desktop test provider · test-model');
    await expect(panel.getByRole('status')).toContainText('已请求客户端刷新左下角');
    await expect.poll(()=>refreshMessages.length).toBe(4);
    expect(refreshMessages[0].params.queryKey).toEqual(['user-saved-config','local',null]);
    expect(await app.evaluate(()=>globalThis.accountSwitchNotices)).toEqual([{title:'Codex 默认连接已切换',body:'已选用：Desktop test provider\n已请求刷新客户端标识；已有会话保持原连接。',silent:true}]);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Pawprint Connection Notice'))).toBe(false);
    // Unsupported system notifications do not create a custom overlay or block switching.
    await app.evaluate(({Notification})=>{
      Notification.isSupported=()=>false;
      const entry=globalThis.accountTestMenus.find(({template})=>template.some(i=>i.label==='Desktop test provider · test-model'));entry.menu.items.find(i=>i.label==='Desktop test provider · test-model').click();
    });
    await expect.poll(()=>refreshMessages.length).toBe(8);
    expect(await app.evaluate(()=>globalThis.accountSwitchNotices.length)).toBe(1);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Pawprint Connection Notice'))).toBe(false);
    await app.evaluate(({Notification})=>{Notification.isSupported=()=>true;});
    expect(parse(await readFile(path.join(codexHome,'config.toml'),'utf8')).model_provider).toBe('openai');
    // The client's model picker can change the model while keeping the provider.
    await writeFile(path.join(codexHome,'config.toml'),(await readFile(path.join(codexHome,'config.toml'),'utf8')).replace('model = "test-model"','model = "picked-model"'));
    await panel.getByRole('button',{name:'选用 ChatGPT',exact:true}).click();
    await expect(panel.locator('.codex-provider').first().getByRole('status')).toContainText('默认连接已切换');
    await expect(panel.locator('.codex-provider').first().getByRole('status')).toContainText('界面更新尚未确认');
    expect((await app.evaluate(()=>globalThis.accountSwitchNotices.at(-1))).body).toContain('已选用：ChatGPT / OpenAI');
    await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    await panel.getByRole('button',{name:'选用 Desktop test provider',exact:true}).click();
    await expect(panel.locator('.codex-current')).toContainText('Desktop test provider · test-model');
    const beforeConflict=await readFile(path.join(codexHome,'config.toml'),'utf8');
    await writeFile(path.join(codexHome,'config.toml'),beforeConflict.replace('name = "Desktop test provider"','name = "Changed provider"'));
    await panel.getByRole('button',{name:'选用 ChatGPT',exact:true}).click();
    await expect(panel.locator('.codex-provider').first().getByRole('alert')).toBeVisible();
    await expect(panel.locator('.codex-provider').first().getByRole('alert')).toContainText('连接配置已被外部修改');
    expect((await app.evaluate(()=>globalThis.accountSwitchNotices.at(-1))).title).toBe('Codex 连接切换失败');
    const conflictPanel=panel.locator('.codex-conflict');await expect(conflictPanel).toContainText('连接名称');await expect(conflictPanel).not.toContainText('https://changed.example/v1');
    await conflictPanel.getByRole('button',{name:'处理配置冲突',exact:true}).click();
    await conflictPanel.getByRole('button',{name:'取消恢复',exact:true}).click();expect(await readFile(path.join(codexHome,'config.toml'),'utf8')).toBe(beforeConflict.replace('name = "Desktop test provider"','name = "Changed provider"'));
    await conflictPanel.getByRole('button',{name:'处理配置冲突',exact:true}).click();await conflictPanel.getByRole('button',{name:'备份并恢复 ChatGPT',exact:true}).click();
    await expect(conflictPanel).toHaveCount(0);await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    const recovered=(await home.evaluate(()=>window.pawprint.codexAccounts('status'))).data;expect(await readFile(recovered.backupPath,'utf8')).toContain('Changed provider');
    await panel.getByRole('button',{name:'选用 Desktop test provider',exact:true}).click();await expect(panel.locator('.codex-current')).toContainText('Desktop test provider · test-model');

    for(const socket of refreshSockets)socket.destroy();await new Promise(resolve=>refreshServer.close(resolve));
    await panel.getByRole('button',{name:'选用 Desktop test provider',exact:true}).click();
    await expect(panel.getByRole('status')).toContainText('无法通知客户端刷新左下角');
    const notice=await app.evaluate(()=>globalThis.accountSwitchNotices.at(-1));expect(notice.title).toBe('Codex 默认连接已切换');expect(notice.body).toContain('客户端标识刷新未确认');
    await expect(panel.locator('.codex-current')).toContainText('Desktop test provider · test-model');

    await expect(panel.getByRole('button',{name:'删除 Desktop test provider',exact:true})).toBeEnabled();
    await panel.getByRole('button',{name:'删除 Desktop test provider',exact:true}).click();
    await expect(panel.getByText('将先恢复 ChatGPT 默认配置。',{exact:false})).toBeVisible();
    await panel.getByRole('button',{name:'取消删除',exact:true}).click();
    await expect(panel.getByRole('button',{name:'选用 Desktop test provider',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'删除 Desktop test provider',exact:true}).click();
    await panel.getByRole('button',{name:'确认删除',exact:true}).click();
    await expect(panel.getByRole('button',{name:'选用 Desktop test provider',exact:true})).toHaveCount(0);providerId=null;
    await expect(panel.locator('.codex-current')).toContainText('ChatGPT / OpenAI · gpt-existing');
    const restored=parse(await readFile(path.join(codexHome,'config.toml'),'utf8'));delete restored.model_providers;expect(new URL(restored.openai_base_url).pathname).toMatch(/\/openai\/v1$/);delete restored.openai_base_url;expect(restored).toEqual(parse(config));expect(await readFile(path.join(codexHome,'auth.json'),'utf8')).toBe(login);expect(errors).toEqual([]);
  } finally {
    for(const socket of refreshSockets)socket.destroy();if(refreshServer.listening)await new Promise(resolve=>refreshServer.close(resolve));
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
 await writeFile(path.join(profile,'codex-provider-titles.json'),JSON.stringify({enabled:false,edits:{}}));
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(codex,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,model_provider TEXT,model TEXT,updated_at INTEGER,source TEXT,archived INTEGER,title TEXT)');
 for(const [n,name,provider] of [[1,'Official recorded chat','openai'],[2,'Custom recorded chat','custom-demo'],[3,'Unknown recorded chat',null]])db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)').run(`01a0f1ea-4534-7651-b950-${String(n).padStart(12,'0')}`,name,'/PRIVATE_PATH',provider,'same-model',n,'cli',0,'PRIVATE_PROMPT');db.close();
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:codex}});
 try{
  const home=await openCodex(app);await expect(home.getByRole('heading',{name:'Codex 助手',exact:true})).toBeVisible();
  await expect(home.getByLabel('API Key',{exact:true})).not.toBeVisible();
  await expect(home.getByText(path.join(codex,'config.toml'),{exact:true})).not.toBeVisible();
  const sources=home.locator('.codex-session-sources');await sources.locator('summary').click();await expect(sources.locator('li')).toHaveCount(3);
  await expect(sources.locator('li').filter({hasText:'Custom recorded chat'})).toContainText('示例连接');await expect(sources.locator('li').filter({hasText:'Official recorded chat'})).toContainText('ChatGPT / OpenAI');await expect(sources.locator('li').filter({hasText:'Unknown recorded chat'})).toContainText('来源未确认');await expect(sources).not.toContainText('PRIVATE');
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

test('official forwarding uses Electron networking and returns decoded responses with consistent headers',async()=>{
 const {createServer}=await import('node:http'),{gzipSync}=await import('node:zlib');
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-official-network-'));await seedMatureCompanion(root);const seen=[],bodies=[];
 const plain='event: response.completed\ndata: {"ok":true}\n\n',encoded=gzipSync(Buffer.from(plain));
 const server=createServer((req,res)=>{seen.push(req.headers);const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{bodies.push(Buffer.concat(chunks).toString());res.writeHead(200,{'Content-Type':'text/event-stream','Content-Encoding':'gzip','Content-Length':encoded.length,'X-Request-ID':'official-network-test'});res.end(encoded);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:root,PAWPRINT_TEST_CODEX_HOME:path.join(root,'codex')}});
 try{
  const response=await app.evaluate(async({app,net},url)=>{
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const fetchOfficial=req('./electron/codex-proxy-http.mjs').officialRequester(net.fetch.bind(net));
   const response=await fetchOfficial(url,{method:'POST',redirect:'manual',headers:{authorization:'Bearer dummy-native-login','chatgpt-account-id':'dummy-account','content-length':'2','content-type':'application/json','sec-fetch-mode':'cors'},body:Buffer.from('{}')});
   return {status:response.status,headers:Object.fromEntries(response.headers),body:await new Response(response.body).text()};
  },`http://127.0.0.1:${server.address().port}/responses`);
  expect(response.status).toBe(200);expect(response.body).toBe(plain);expect(response.headers['content-encoding']).toBeUndefined();expect(response.headers['content-length']).toBeUndefined();expect(response.headers['x-request-id']).toBe('official-network-test');
  expect(seen[0].authorization).toBe('Bearer dummy-native-login');expect(seen[0]['chatgpt-account-id']).toBe('dummy-account');expect(seen[0].cookie).toBeUndefined();
  // Reproduce the user's full route: a MiMo URL, an old OpenAI-bound chat,
  // compressed native input, bridge-generated Content-Length, Chromium fetch.
  const routed=await app.evaluate(async({app,net},origin)=>{
   const path=process.getBuiltinModule('path'),req=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
   const {CodexIdentityBridge}=req('./electron/codex-identity-bridge.mjs'),{officialRequester}=req('./electron/codex-proxy-http.mjs');
   let failure;const fetchOfficial=officialRequester(net.fetch.bind(net));
   const bridge=new CodexIdentityBridge({dataDirectory:path.join(app.getPath('userData'),'official-routing-fixture'),keychain:{get:async()=>{throw Error('must not read a vendor key');}},officialFetchImpl:async(...args)=>{try{return await fetchOfficial(...args);}catch(e){failure={message:e.message,headers:[...new Headers(args[1].headers).keys()]};throw e;}}});
   const vendor='pawprint_'+'a'.repeat(32),thread='01a0f1ea-4534-7651-b950-000000000111';
   bridge.configure([{id:vendor,model:'mimo-v2.6-pro',modelSelection:'fixed',baseUrl:'http://127.0.0.1:1/unreachable'}],{officialBaseUrl:origin});
   try{
    await bridge.prepareBindings({directory:app.getPath('userData'),currentProviderId:vendor});await bridge.bindings.bind(thread,'openai');await bridge.start();
    const input={model:'gpt-6.1-sol',input:'本机隔离测试'},body=process.getBuiltinModule('zlib').zstdCompressSync(Buffer.from(JSON.stringify(input)));
    const response=await fetch(bridge.baseUrl(vendor)+'/responses',{method:'POST',headers:{'thread-id':thread,authorization:'Bearer dummy-native-login','chatgpt-account-id':'dummy-account','content-encoding':'zstd','content-type':'application/json'},body});
    const text=await response.text();await bridge.routeEvidence.queue;
    const bindings=await bridge.bindings.snapshot();return {status:response.status,body:text,binding:bindings[thread].providerId,...(failure?{failure}:{})};
   }finally{await bridge.close();}
  },`http://127.0.0.1:${server.address().port}`);
  expect(routed).toEqual({status:200,body:plain,binding:'openai'});
  expect(seen).toHaveLength(2);expect(seen[1].authorization).toBe('Bearer dummy-native-login');expect(seen[1]['chatgpt-account-id']).toBe('dummy-account');expect(seen[1]['content-encoding']).toBeUndefined();
  expect(JSON.parse(bodies[1])).toEqual({model:'gpt-6.1-sol',input:'本机隔离测试'});expect(Number(seen[1]['content-length'])).toBe(Buffer.byteLength(bodies[1]));
 }finally{await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
