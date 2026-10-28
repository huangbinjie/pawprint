import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {CodexBackgroundManager} from '../electron/codex-background-manager.mjs';

test('selected media and opening survive Pawprint restarts; replacing video with an image removes its opening',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-manager-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const readMedia=async file=>({media:`data:${file.endsWith('.png')?'image/png':'video/mp4'};base64,eA==`,dim:0});
 const options={directory:root,platform:'darwin',readMedia,probe:async()=>({pid:null,connected:false})};
 const manager=new CodexBackgroundManager(options);await manager.load();await manager.select('media','/chosen/video.mp4');await manager.select('intro','/chosen/opening.mp4');await manager.enable(true);
 const revision=manager.config.revision;const restored=new CodexBackgroundManager(options);await restored.load();
 assert.equal(restored.config.enabled,true);assert.equal(restored.config.revision,revision);assert.equal(restored.config.intro.name,'opening.mp4');assert.ok(restored.payload.intro);
 await restored.select('media','/chosen/photo.png');assert.equal(restored.config.intro,null);assert.equal(restored.payload.intro,undefined);
 assert.equal((await readdir(restored.directory)).length,2,'only current media and settings remain');
 await restored.enable(false);const again=new CodexBackgroundManager(options);await again.load();assert.equal(again.config.enabled,false);
 await assert.rejects(restored.select('intro','/chosen/photo.png'),/先选择视频/);
});

test('restoration follows new client processes and page reloads, never restarts an existing startup session',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-manager-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let client={pid:10,connected:false};const applied=[],launched=[];
 const manager=new CodexBackgroundManager({directory:root,platform:'darwin',readMedia:async()=>({media:'data:video/mp4;base64,eA==',dim:0}),probe:async()=>client,apply:async x=>applied.push(x),launch:async x=>launched.push(x.pid)});
 await manager.load();await manager.select('media','/picked.mp4');await manager.enable(true);assert.deepEqual(launched,[]);
 client={pid:null,connected:false};await manager.sync();client={pid:20,connected:false};await manager.sync();await manager.sync();assert.deepEqual(launched,[20]);
 client={pid:21,connected:true,windows:[{id:'window',visible:true,revision:null,applied:false}]};await manager.sync();assert.equal(applied.length,1);assert.equal(applied[0].prepared.revision,manager.config.revision);
 client.windows[0].revision=manager.config.revision;client.windows[0].applied=true;await manager.sync();assert.equal(applied.length,1,'no reinjection on routine checks');
 client.windows[0].revision=null;await manager.sync();assert.equal(applied.length,2,'page reload reapplies the saved media');
 await manager.enable(false);assert.equal(applied.at(-1).restore,true);
 manager.close();const count=applied.length;await manager.sync();assert.equal(applied.length,count);
});

test('corrupt configuration is reported without enabling or overwriting it',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-manager-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const manager=new CodexBackgroundManager({directory:root});await manager.save();const file=path.join(manager.directory,'settings.json');await writeFile(file,'broken');
 const restored=new CodexBackgroundManager({directory:root});await restored.load();assert.equal(restored.config.enabled,false);assert.equal(restored.status,'error');assert.equal(await readFile(file,'utf8'),'broken');
});

test('preset selection is atomic on download failure and persists without QQ Music',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-manager-'));t.after(()=>rm(root,{recursive:true,force:true}));let fail=false;const requested=[];
 const options={directory:root,platform:'darwin',probe:async()=>({pid:null,connected:false}),readMedia:async()=>({media:'data:video/mp4;base64,eA==',dim:0}),assetFile:async(id,folder,{onProgress})=>{requested.push(id);if(fail)throw Error('offline');await mkdir(folder,{recursive:true});const file=path.join(folder,id+'.mp4');await writeFile(file,'x');onProgress(1);return file;}};
 const manager=new CodexBackgroundManager(options);await manager.load();assert.equal((await manager.presets()).length,3);
 await manager.selectPreset('night');assert.deepEqual(requested,['night-idle','night-intro']);assert.equal(manager.config.presetId,'night');assert.ok(manager.payload.intro);
 const restored=new CodexBackgroundManager(options);await restored.load();assert.equal(restored.config.presetId,'night');assert.equal(restored.config.enabled,true);
 fail=true;await assert.rejects(restored.selectPreset('cat'),/offline/);assert.equal(restored.config.presetId,'night');assert.equal(restored.downloading,null);
 fail=false;await restored.selectPreset('cat');assert.equal(restored.config.intro,null);assert.equal(restored.payload.intro,undefined);
 await restored.selectPreset('default');assert.equal(restored.config.enabled,false);await assert.rejects(restored.selectPreset('../asset'),/无效/);
});


test('cat skin upgrades the transition clip to seated idle on restart or reselection',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-background-manager-'));t.after(()=>rm(root,{recursive:true,force:true}));let offline=false;const downloads=[];
 const options={directory:root,platform:'darwin',probe:async()=>({pid:null,connected:false}),readMedia:async file=>({media:await readFile(file,'utf8'),dim:0}),assetFile:async(id,folder)=>{downloads.push(id);if(offline)throw Error('offline');await mkdir(folder,{recursive:true});const file=path.join(folder,id+'.mp4');await writeFile(file,'seated idle');return file;}};
 const original=new CodexBackgroundManager(options);await mkdir(path.join(original.directory,'assets'),{recursive:true});await writeFile(path.join(original.directory,'assets/cat-idle.mp4'),'wake-up transition');
 original.config={...original.config,enabled:true,presetId:'cat',media:{file:'assets/cat-idle.mp4',name:'cat',mime:'video/mp4'}};await original.save();const revision=original.config.revision;
 offline=true;const failed=new CodexBackgroundManager(options);await failed.load();assert.equal(failed.config.media.file,'assets/cat-idle.mp4');assert.equal(failed.config.enabled,true);assert.equal(failed.payload.media,'wake-up transition');
 offline=false;const upgraded=new CodexBackgroundManager(options);await upgraded.load();assert.equal(upgraded.config.media.file,'assets/cat-idle-v2.mp4');assert.equal(upgraded.payload.media,'seated idle');assert.notEqual(upgraded.config.revision,revision);
 const persisted=JSON.parse(await readFile(path.join(original.directory,'settings.json'),'utf8'));assert.equal(persisted.media.file,'assets/cat-idle-v2.mp4');
 original.config.enabled=false;await original.save();downloads.length=0;const disabled=new CodexBackgroundManager(options);await disabled.load();assert.deepEqual(downloads,[]);
 await disabled.selectPreset('cat');assert.deepEqual(downloads,['cat-idle-v2']);assert.equal(disabled.config.media.file,'assets/cat-idle-v2.mp4');assert.equal(disabled.payload.media,'seated idle');
});
