import {test,expect,_electron as electron} from '@playwright/test';import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {seedMatureCompanion} from './fixtures/game.mjs';import {openHome} from './helpers.mjs';
test('QR image sharing, decoding, read-only visits and pawprints work without LAN',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-card-ui-'));const state=await seedMatureCompanion(dir);
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const home=await openHome(app,'nearby'),panel=home.getByTestId('pet-cards');
  await panel.getByRole('button',{name:'生成二维码',exact:true}).click();await expect(panel.getByAltText('宠物访问卡二维码')).toBeVisible();
  await panel.getByRole('button',{name:'复制二维码图片',exact:true}).click();await panel.getByRole('button',{name:'读取剪贴板图片',exact:true}).click();
  await expect(panel.getByTestId('pet-card-preview')).toBeVisible();
  await panel.getByRole('button',{name:'复制猫咪合照',exact:true}).click();
  const visitWindow=app.waitForEvent('window');await panel.getByRole('button',{name:'邀请来玩 5 分钟',exact:true}).click();const guest=await visitWindow;
  await expect(guest.getByRole('img',{name:'基因猫咪'})).toBeVisible();
  await panel.screenshot({path:info.outputPath('qr-visiting-card.png')});
  const after=(await home.evaluate(()=>window.pawprint.getState())).data;expect(after.cardVisitors).toHaveLength(1);expect(after.cardFootprints).toHaveLength(1);expect(after.pets.map(p=>[p.genome,p.skills,p.talent])).toEqual(state.pets.map(p=>[p.genome,p.skills,p.talent]));expect(after.balance).toBe(state.balance);expect(after.pets).toHaveLength(state.pets.length);
  await panel.getByRole('button',{name:'送它回家',exact:true}).click();await expect.poll(async()=>(await home.evaluate(()=>window.pawprint.getState())).data.cardVisitors.length).toBe(0);
 }finally{await app.close();}
});
