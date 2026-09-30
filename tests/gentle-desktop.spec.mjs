import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {seedMatureCompanion} from './fixtures/game.mjs';import {openHome} from './helpers.mjs';
import {TRAITS,phenotype,geneOdds,formatChance} from '../core/genetics.mjs';
test('gentle portrait hides complete absent parts, preserves extreme genes and adapts tailless skills',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-gentle-'));const state=await seedMatureCompanion(dir);
 const combos=[{ears:1,tail:1,eyeSize:1,white:1},{ears:7,tail:7,fur:3,body:8,face:7},{ears:7,tail:4,body:2,face:4,eyeSize:3},{ears:2,tail:7,body:5,face:2,eyeSize:4},{ears:5,tail:2,eyes:8,eyeSize:5}];
 state.capacity=6;state.pets=combos.map((traits,i)=>{const p=structuredClone(state.pets[0]);p.id=`combo-${i}`;p.name=`组合${i}`;for(const [k,v]of Object.entries(traits))p.genome[k]=[v,v];p.skills.idle='chase';return p});state.activePetId='combo-0';await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'talents');const errors=[];home.on('pageerror',e=>errors.push(e.message));
  for(let i=0;i<combos.length;i++){
   await home.getByLabel('选择才艺伙伴').selectOption(`combo-${i}`);
   const cat=home.locator('.talent-stage .cat'),p=phenotype(state.pets[i].genome);
   await expect(cat).toHaveAttribute('data-phenotype',JSON.stringify(p));
   await expect(cat.locator('[data-part=ear]')).toHaveCount(p.ears===7?0:2);
   await expect(cat.locator('[data-part=tail]')).toHaveCount(p.tail===7?0:1);
   await expect(cat.locator('[data-motion]')).toHaveCount(0);
   await cat.screenshot({path:info.outputPath(`combo-${i}.png`)});
   const blink=await cat.locator('.cat-eye').first().evaluate(async el=>{
    const anim=el.getAnimations().find(a=>a.animationName==='gentle-blink');await anim.ready;anim.pause();await anim.ready;anim.currentTime=Number(anim.effect.getTiming().duration)*1.43+Number(anim.effect.getTiming().delay);
    await new Promise(requestAnimationFrame);
    return new DOMMatrix(getComputedStyle(el).transform).d;
   });expect(blink).toBeLessThan(.1);
   if(p.tail===7){await home.getByRole('button',{name:'试试追自己的尾巴',exact:true}).click();await expect(cat).toHaveClass(/tailless-look/);expect(await cat.locator('.cat-body').evaluate(el=>getComputedStyle(el).animationName)).toBe('gentle-look');await expect(home.getByText('无尾伙伴会原地左右张望，不做追尾旋转。').first()).toBeVisible();}
  }
  await home.getByRole('button',{name:'基因图鉴',exact:true}).click();
  for(const [key,name]of [['ears','耳形'],['tail','尾形']]){
   await home.getByRole('tab',{name:new RegExp(`^${name}`)}).click();
   const card=home.locator(`[data-gene-id="${key}:7"]`);
   await expect(card.locator('h3')).toHaveText(TRAITS[key][7].name);
   await expect(card.locator('.gene-prob strong')).toHaveText(formatChance(geneOdds(key,7).visible));
   await card.screenshot({path:info.outputPath(`${key}-catalog.png`)});
  }
  const after=(await home.evaluate(()=>window.pawprint.getState())).data;
  for(let i=0;i<state.pets.length;i++)for(const key of ['id','name','genome','skills','talent','breedCount'])expect(after.pets[i][key]).toEqual(state.pets[i][key]);expect(after.ledger).toEqual(state.ledger);expect(after.balance).toBe(state.balance);expect(errors).toEqual([]);
 }finally{await app.close()}
});

test('cursor pursuit keeps inherited appearance and absent parts during faster front-view footsteps',async({},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pawprint-chase-genes-'));const state=await seedMatureCompanion(dir);
 const pet=state.pets[0];pet.genome.ears=[7,7];pet.genome.tail=[7,7];pet.genome.coat=[5,5];pet.genome.body=[5,5];await writeFile(path.join(dir,'save-v1.json'),JSON.stringify(state));
 const app=await electron.launch({args:['.'],env:{...process.env,PAWPRINT_TEST_MODE:'1',PAWPRINT_TEST_DATA:dir,PAWPRINT_TEST_LAN:'1',PAWPRINT_TEST_CODEX_HOME:path.join(dir,'no-history')}});
 try{
  const floating=await app.firstWindow(),home=await openHome(app,'talents');
  await app.evaluate(({screen,BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'));const a=screen.getDisplayMatching(w.getBounds()).workArea;w.setPosition(a.x+100,a.y+100);screen.getCursorScreenPoint=()=>({x:a.x+540,y:a.y+220});});
  const response=await home.evaluate(id=>window.pawprint.performSkill(id,'mouse'),pet.id);expect(response.ok).toBe(true);
  const side=floating.locator('.behavior-mouse.phase-approach .cat');await expect(side).toBeVisible({timeout:6000});
  await expect(side).toHaveAttribute('data-phenotype',JSON.stringify(phenotype(pet.genome)));
  await expect(side.locator('[data-part="ear"]')).toHaveCount(0);await expect(side.locator('[data-part="tail"]')).toHaveCount(0);
  expect(await side.locator('.cat-frontpaw-left').evaluate(el=>getComputedStyle(el).animationName)).toBe('idle-step-paw');
  await floating.screenshot({path:info.outputPath('chase-absent-parts.png'),omitBackground:true});
  const after=(await home.evaluate(()=>window.pawprint.getState())).data;expect(after.pets[0].genome).toEqual(pet.genome);
 }finally{await app.close();}
});
