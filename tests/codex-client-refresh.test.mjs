import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm,writeFile,symlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {refreshCodexProviderIndicator} from '../electron/codex-client-refresh.mjs';

const unix={skip:process.platform==='win32'};
const frame=value=>{const bytes=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
async function fixture(t,handle){
  const directory=await mkdtemp(path.join(os.tmpdir(),'paw-refresh-')),socketPath=path.join(directory,'ipc.sock'),seen=[],sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let data=Buffer.alloc(0);
    socket.on('data',bytes=>{data=Buffer.concat([data,bytes]);while(data.length>=4){const n=data.readUInt32LE(0);if(data.length<n+4)return;const message=JSON.parse(data.subarray(4,n+4));data=data.subarray(n+4);seen.push(message);handle(socket,message);}});
  });
  await new Promise(r=>server.listen(socketPath,r));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  return {directory,socketPath,seen};
}
test('framed IPC refreshes local account and Dot config dependencies without login or prompts',unix,async t=>{
  const f=await fixture(t,(socket,m)=>{if(m.method==='initialize'){
    socket.write(frame({type:'response',method:'initialize',requestId:'unrelated',resultType:'success',result:{clientId:'wrong'}}));
    const reply=frame({type:'response',method:'initialize',requestId:m.requestId,resultType:'success',result:{clientId:'refresh-test'}});
    socket.write(reply.subarray(0,2));socket.write(reply.subarray(2));
  }});
  assert.deepEqual(await refreshCodexProviderIndicator(f),{status:'requested'});
  for(let i=0;i<30&&f.seen.length<5;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.seen.length,5);assert.equal(f.seen[0].method,'initialize');
  assert.deepEqual(f.seen[1],{type:'broadcast',method:'query-cache-invalidate',version:0,sourceClientId:'refresh-test',params:{queryKey:['user-saved-config','local',null]}});
  assert.deepEqual(f.seen.slice(2).map(m=>m.params.queryKey),[['config','read-response','local',null],['config','layered-response','local',null],['config','effective','local',null]]);
  assert.ok(!JSON.stringify(f.seen).includes('account/login'));assert.ok(!JSON.stringify(f.seen).includes('turn/start'));
});
test('unavailable, incompatible and malformed IPC never reports a refreshed indicator',unix,async t=>{
  for(const mode of ['timeout','rejected','malformed','disconnect']){
    await t.test(mode,async t=>{
      const f=await fixture(t,(socket,m)=>{if(m.method!=='initialize')return;
        if(mode==='rejected')socket.write(frame({type:'response',method:'initialize',requestId:m.requestId,resultType:'error'}));
        if(mode==='malformed'){const bytes=Buffer.alloc(4);bytes.writeUInt32LE(65537);socket.write(bytes);}
        if(mode==='disconnect')socket.destroy();
      });
      assert.deepEqual(await refreshCodexProviderIndicator({...f,timeoutMs:60}),{status:'unavailable'});
      assert.equal(f.seen.some(m=>m.type==='broadcast'),false);
    });
  }
});
test('missing socket and ordinary files are ignored without leaking local paths',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paw-refresh-file-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const socketPath=path.join(directory,'not-socket');
  assert.deepEqual(await refreshCodexProviderIndicator({directory,socketPath}),{status:'unavailable'});
  await writeFile(socketPath,'private-data');assert.deepEqual(await refreshCodexProviderIndicator({directory,socketPath}),{status:'unavailable'});
  if(process.platform!=='win32'){const link=path.join(directory,'linked');await symlink(socketPath,link);assert.deepEqual(await refreshCodexProviderIndicator({directory,socketPath:link}),{status:'unavailable'});}
});
