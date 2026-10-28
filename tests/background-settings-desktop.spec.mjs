import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile,mkdir,copyFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {openHome} from './helpers.mjs';import {CodexBackgroundManager} from '../electron/codex-background-manager.mjs';

test('Codex skin gallery shows previews, replaces file pickers and persists the selected preset',async()=>{
 test.skip(process.platform!=='darwin','Client skins currently support macOS.');
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-settings-'));let app;
 const profile=path.join(root,'profile');await mkdir(profile,{recursive:true});
 const photo=path.join(root,'fixture.png');await writeFile(photo,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII=','base64'));
 const manager=new CodexBackgroundManager({directory:profile,probe:async()=>({pid:null,connected:false})});await manager.load();await manager.select('media',photo);manager.config.presetId='night';
 await mkdir(path.join(manager.directory,'assets'),{recursive:true});await copyFile(photo,path.join(manager.directory,'assets/night-idle.mp4'));manager.config.media.file='assets/night-idle.mp4';await manager.save();
 const launch=()=>electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:profile,PAWPRINT_TEST_CODEX_HOME:path.join(root,'codex'),PAWPRINT_TEST_LAN:'1'}});
 try{
  app=await launch();let home=await openHome(app,'settings');await expect(home.getByTestId('client-skins')).toHaveCount(0);
  home=await openHome(app,'codex');await home.getByRole('button',{name:'Skins',exact:true}).click();let gallery=home.getByTestId('client-skins');
  await expect(gallery.locator('.skin-card')).toHaveCount(3);await expect(gallery.locator('img')).toHaveCount(3);
  await expect.poll(()=>gallery.locator('img').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0))).toBe(true);
  await expect(gallery.getByRole('button',{name:/Choose image|Choose video/})).toHaveCount(0);
  await gallery.getByRole('button',{name:/Night Companion/}).click();await expect(gallery.getByRole('button',{name:/Night Companion/})).toHaveAttribute('aria-pressed','true');
  await app.close();app=await launch();home=await openHome(app,'codex');await home.getByRole('button',{name:'Skins',exact:true}).click();gallery=home.getByTestId('client-skins');
  await expect(gallery.getByRole('button',{name:/Night Companion/})).toHaveAttribute('aria-pressed','true');
  await gallery.getByRole('button',{name:/Original/}).click();await expect(gallery.getByRole('button',{name:/Original/})).toHaveAttribute('aria-pressed','true');
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
});
