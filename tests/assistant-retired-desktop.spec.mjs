import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../core/store.mjs';
import {seedMatureCompanion} from './fixtures/game.mjs';
import {openHome} from './helpers.mjs';
test('API chat is absent and old provider settings cannot affect startup or local companionship',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-api-retired-')),state=await seedMatureCompanion(dir),codex=path.join(dir,'codex');await mkdir(path.join(codex,'sessions'),{recursive:true});state.settings.language='en';state.pets[0].name='Pudding';const store=new Store(dir);await store.load();await store.save(state);
 // A broken retired config used to block service initialization. It is now opaque.
 const oldConfig='RETIRED AND INVALID PROVIDER CONFIG';await writeFile(path.join(dir,'assistant.json'),oldConfig);
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_CODEX_HOME:codex,PAWPRINT_TEST_LAN:'1'}});
 try{
  const home=await openHome(app,'settings');await expect(home.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible();await expect(home.getByTestId('assistant-settings')).toHaveCount(0);await expect(home.getByText('API chat',{exact:true})).toHaveCount(0);
  const result=await home.evaluate(async()=>({state:(await window.pawprint.getState()).data,methods:Object.keys(window.pawprint).filter(k=>k.startsWith('assistant'))}));expect(result.methods).toEqual([]);expect(result.state).not.toHaveProperty('assistant');expect(result.state.balance).toBe(state.balance);expect(result.state.ledger).toEqual(state.ledger);expect(result.state.pets[0].genome).toEqual(state.pets[0].genome);expect(result.state.pets[0].skills).toEqual(state.pets[0].skills);expect(result.state.pets[0].name).toBe(state.pets[0].name);expect(result.state.pets[0].activeDays).toEqual(expect.arrayContaining(state.pets[0].activeDays));
  expect((await home.evaluate(()=>window.pawprint.previewCompanion())).ok).toBe(true);await expect.poll(()=>app.windows().some(w=>w.url().startsWith('data:text/html'))).toBe(true);await expect(app.windows().find(w=>w.url().startsWith('data:text/html')).getByRole('status')).toContainText(/here|Meow|nap|pet|passing/);
  expect(await readFile(path.join(dir,'assistant.json'),'utf8')).toBe(oldConfig);await home.screenshot({path:info.outputPath('english-preferences-no-api-chat.png')});
 }finally{await app.close();}
});
