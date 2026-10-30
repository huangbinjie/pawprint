// Isolated loopback requests only. GC makes retained data measurable without
// relying on the OS/allocator returning freed RSS pages immediately.
import assert from 'node:assert/strict';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexIdentityBridge} from '../electron/codex-identity-bridge.mjs';

assert.equal(typeof global.gc,'function','Run with node --expose-gc');
const root=await mkdtemp(path.join(os.tmpdir(),'paw-bridge-memory-'));
const streams=[],id='pawprint_'+'a'.repeat(32),MiB=1024*1024;
const bridge=new CodexIdentityBridge({
  dataDirectory:root,requireBindings:false,keychain:{get:async()=> 'dummy'},
  fetchImpl:()=>new Response(new ReadableStream({start(controller){
    controller.enqueue(Buffer.from('data: ready\n\n'));streams.push(controller);
  }})),
});
bridge.configure([{id,baseUrl:'http://unused',model:'fixed-model',modelSelection:'fixed'}]);
async function settledMemory(){
  for(let i=0;i<3;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
  return process.memoryUsage();
}
function post(body,encoding){
  return new Promise((resolve,reject)=>{
    const req=http.request(bridge.baseUrl(id)+'/responses',{method:'POST',headers:{'content-type':'application/json','content-encoding':encoding}},res=>{
      res.on('error',reject);res.resume();resolve(res);
    });
    req.on('error',reject);req.end(body);
  });
}
try{
  await bridge.start();
  for(const encoding of ['gzip','identity']){
    let body=Buffer.from(JSON.stringify({model:'picker-model',input:'work context '.repeat(Math.floor(8*MiB/13))}));
    if(encoding==='gzip')body=gzipSync(body);
    const before=await settledMemory();
    const responses=await Promise.all(Array.from({length:4},()=>post(body,encoding)));
    const during=await settledMemory();
    assert.equal(streams.length,4);
    const finished=responses.map(res=>new Promise(resolve=>res.once('end',resolve)));
    for(const controller of streams.splice(0))controller.close();
    await Promise.all(finished);
    const heap=during.heapUsed-before.heapUsed,buffers=during.arrayBuffers-before.arrayBuffers;
    console.log(JSON.stringify({encoding,concurrency:4,requestMiB:8,retainedHeapMiB:heap/MiB,retainedBuffersMiB:buffers/MiB}));
    // Four live replies must not retain four parsed transcripts or request
    // buffers. Leave a full request's worth of headroom for runtime overhead.
    assert.ok(heap<8*MiB,`${encoding}: parsed transcripts retained during SSE`);
    assert.ok(buffers<8*MiB,`${encoding}: request buffers retained during SSE`);
  }
}finally{
  for(const controller of streams.splice(0))controller.close();
  await bridge.close();await rm(root,{recursive:true,force:true});
}
