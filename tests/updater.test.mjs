import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {newer,selectRelease,checksumFrom,verifiedDownload,UpdateService} from '../electron/updater.mjs';
const run=promisify(execFile);
const asset=(name,size=120000)=>({name,size,browser_download_url:`https://github.com/huangbinjie/pawprint/releases/download/v0.11.3/${name}`});
const release={tag_name:'v0.11.3',draft:false,prerelease:false,body:'Updates',assets:[asset('Pawprint-0.11.3-mac-arm64.zip'),asset('Pawprint-0.11.3-mac-arm64.zip.sha256',80)]};
test('only newer stable releases with exact Mac assets can be selected',()=>{
 assert.equal(newer('0.11.3','0.11.2'),true);assert.equal(newer('0.11.2','0.11.2'),false);
 assert.equal(newer('0.10.9','0.11.2'),false);assert.equal(newer('1.0.0-beta','0.11.2'),false);
 assert.equal(selectRelease(release,'0.11.2').version,'0.11.3');
 assert.equal(selectRelease({...release,prerelease:true},'0.11.2'),null);
 assert.equal(selectRelease({...release,assets:[asset('Pawprint-0.11.3-mac-arm64.zip')]},'0.11.2'),null);
 assert.equal(selectRelease({...release,assets:[{...release.assets[0],browser_download_url:'https://elsewhere.test/malware.zip'},release.assets[1]]},'0.11.2'),null);
});
test('download verifies checksum and size before returning an installable archive',async()=>{
 const bytes=Buffer.alloc(120000,31),name='Pawprint-0.11.3-mac-arm64.zip',hash=createHash('sha256').update(bytes).digest('hex');
 const dir=await mkdtemp(path.join(tmpdir(),'pawprint-update-test-'));
 const found=selectRelease(release,'0.11.2');
 const fetcher=async url=>new Response(url.endsWith('.sha256')?`${hash}  ${name}\n`:bytes,{status:200});
 const timeoutCalls=[],originalTimeout=AbortSignal.timeout;
 AbortSignal.timeout=duration=>{timeoutCalls.push(duration);return originalTimeout(duration)};
 let file;
 try{file=await verifiedDownload(found,dir,fetcher)}finally{AbortSignal.timeout=originalTimeout}
 assert.deepEqual(await readFile(file),bytes);
 assert.deepEqual(timeoutCalls,[45_000,600_000]);
 await assert.rejects(()=>verifiedDownload(found,dir,async url=>new Response(url.endsWith('.sha256')?`${'a'.repeat(64)}  ${name}\n`:bytes,{status:200})),/EEXIST|校验失败/);
 assert.equal(checksumFrom(`${hash}  ${name}`,name),hash);
 assert.throws(()=>checksumFrom(`${hash}  wrong.zip`,name));
});
test('updater reports unavailable releases and a later valid release',async()=>{
 let result=new Response('',{status:404});const updates=new UpdateService({installed:'0.11.2',appPath:'/Applications/Pawprint.app',fetcher:async()=>result});
 assert.equal((await updates.check()).status,'unreleased');
 result=new Response(JSON.stringify(release),{status:200,headers:{'content-type':'application/json'}});
 assert.equal((await updates.check()).release.version,'0.11.3');
});
test('installer swaps only after old process exits and restores on failure',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pawprint-installer-test-'));
 const current=path.join(dir,'Pawprint.app'),ready=path.join(dir,'.Pawprint-new.app'),staging=path.join(dir,'staging');
 await mkdir(staging);
 await mkdir(current);await mkdir(ready);await writeFile(path.join(current,'old'),'old');await writeFile(path.join(ready,'new'),'new');
 const script=path.resolve('electron/install-update.sh');
 await run('/bin/sh',[script,current,ready,staging,'99999999'],{env:{...process.env,PAWPRINT_TEST_INSTALL_NO_OPEN:'1'}});
 assert.equal((await stat(path.join(current,'new'))).isFile(),true);
 await mkdir(ready);await writeFile(path.join(ready,'next'),'next');
 await run('/bin/sh',[script,current,ready,staging,'99999999'],{env:{...process.env,PAWPRINT_TEST_INSTALL_NO_OPEN:'1'}});
 assert.equal((await stat(path.join(current,'next'))).isFile(),true);
 assert.equal((await stat(path.join(`${current}.previous`,'new'))).isFile(),true);
 await assert.rejects(()=>run('/bin/sh',[script,current,path.join(dir,'missing.app'),staging,'99999999'],{env:{...process.env,PAWPRINT_TEST_INSTALL_NO_OPEN:'1'}}));
 assert.equal((await stat(path.join(current,'next'))).isFile(),true);
});
