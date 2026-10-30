import assert from 'node:assert/strict';
import net from 'node:net';
import {ApprovalObserver,ApprovalRequests} from '../electron/approval-observer.mjs';

assert.equal(typeof global.gc,'function','Run with node --expose-gc');
const threadId='01a0f1ea-4534-7651-b950-000000000001';
const frame=value=>{const body=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
const request={id:81,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn'}};
const snapshot={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',targetClientIds:['self'],params:{hostId:'local',conversationId:threadId,change:{type:'snapshot',revision:0,conversationState:{id:threadId,requests:[request],turns:[{input:'context '.repeat(Math.floor(24*1024*1024/8))}]}}}};
let peer;
const server=net.createServer(socket=>{peer=socket;
  let pending=Buffer.alloc(0);socket.on('error',()=>{});
  socket.on('data',bytes=>{pending=Buffer.concat([pending,bytes]);while(pending.length>=4&&pending.length>=4+pending.readUInt32LE(0)){
    const size=pending.readUInt32LE(0),message=JSON.parse(pending.subarray(4,4+size));pending=pending.subarray(4+size);
    if(message.method==='initialize')socket.write(frame({type:'response',requestId:message.requestId,resultType:'success',result:{clientId:'self'}}));
  }});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address(),observer=new ApprovalObserver({socketPath:{host:'127.0.0.1',port:address.port},getDirectory:()=>'',getThreads:()=>[],onEvents:async()=>{}});
try{
  observer.connect({host:'127.0.0.1',port:address.port});
  while(observer.status!=='connected')await new Promise(resolve=>setTimeout(resolve,5));
  observer.following.set(threadId,{owner:'owner',state:new ApprovalRequests(threadId),ids:new Set()});
  global.gc();const before=process.resourceUsage().maxRSS;
  peer.write(frame(snapshot));
  while(observer.following.get(threadId).state.revision!==0)await new Promise(resolve=>setTimeout(resolve,5));
  global.gc();const peak=(process.resourceUsage().maxRSS-before)*1024;
  console.log(JSON.stringify({snapshotMiB:24,peakIncreaseMiB:peak/1024/1024}));
  assert.ok(peak<512*1024*1024,`large IPC snapshot caused ${Math.round(peak/1024/1024)} MiB peak`);
}finally{
  await observer.close();peer?.destroy();await new Promise(resolve=>server.close(resolve));
}
