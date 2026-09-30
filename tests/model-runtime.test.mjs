import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {ManagedRuntime} from '../electron/assistant/runtime.mjs';
test('runtime download reports bytes, verifies its hash before extraction and reuses an installed engine',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-runtime-')),bytes=Buffer.from('verified-runtime');let downloads=0,extractions=0;
 const r=new ManagedRuntime({directory,fetcher:async()=>{downloads++;return new Response(bytes);},extract:async(_archive,out)=>{extractions++;await mkdir(path.join(out,'bin'));await writeFile(path.join(out,'bin/ollama'),'test executable');}});
 r.asset={url:'https://github.com/ollama/ollama/releases/download/test/runtime.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),executable:'bin/ollama',format:'zip'};
 const progress=[];const file=await r.ensure(new AbortController().signal,p=>progress.push(p));assert.equal(await readFile(file,'utf8'),'test executable');assert.ok(progress.some(p=>p.completed===bytes.length));await r.ensure(new AbortController().signal,()=>{});assert.equal(downloads,1);assert.equal(extractions,1);
});
test('corrupt runtime never reaches extraction or execution',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'paw-runtime-bad-')),bytes=Buffer.from('bad');const r=new ManagedRuntime({directory,fetcher:async()=>new Response(bytes),extract:()=>assert.fail('Extracted unverified bytes')});r.asset={url:'https://example.test/runtime',bytes:3,sha256:'0'.repeat(64),executable:'bin/ollama',format:'zip'};await assert.rejects(()=>r.ensure(new AbortController().signal,()=>{}),/校验/);
});
