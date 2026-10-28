import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
import {ensureSkinFile} from '../electron/codex-skin-assets.mjs';

test('skin downloads verify size/hash, report progress and reuse the offline cache',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-skin-download-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=Buffer.from('video fixture'),manifest={fixture:{size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};let requests=0;const progress=[];
 const fetcher=async url=>{requests++;assert.match(url,/\/skin-assets-v1\/fixture.mp4$/);return new Response(bytes);};
 const file=await ensureSkinFile('fixture',root,{manifest,fetcher,onProgress:(n,total)=>progress.push([n,total])});assert.deepEqual(await readFile(file),bytes);assert.deepEqual(progress.at(-1),[bytes.length,bytes.length]);
 await ensureSkinFile('fixture',root,{manifest,fetcher:async()=>{throw Error('offline');}});assert.equal(requests,1);
 await writeFile(file,Buffer.alloc(bytes.length));await ensureSkinFile('fixture',root,{manifest,fetcher});assert.equal(requests,2,'corrupt cached bytes are downloaded again');
});

test('failed downloads never publish partial or unverified assets',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'paw-skin-download-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const manifest={fixture:{size:3,sha256:createHash('sha256').update('abc').digest('hex')}};
 for(const body of ['abcdef','xyz'])await assert.rejects(ensureSkinFile('fixture',root,{manifest,fetcher:async()=>new Response(body)}),/大小|校验/);
 await assert.rejects(ensureSkinFile('fixture',root,{manifest,fetcher:async()=>new Response(null,{status:404})}),/下载失败/);
 assert.deepEqual(await readdir(root),[]);
 await assert.rejects(ensureSkinFile('../other',root),/无效/);
});
