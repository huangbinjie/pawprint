import net from 'node:net';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Observed Desktop coordination protocol, not a public API. This only asks the
// account menu and capability checks to reread local config; no UI acknowledgement.
export async function refreshCodexProviderIndicator({directory, socketPath=path.join(directory,'ipc','ipc.sock'), timeoutMs=1500}) {
  const unavailable={status:'unavailable'};
  try {
    const info=await lstat(socketPath);
    if(!info.isSocket()||info.isSymbolicLink()||(process.getuid&&info.uid!==process.getuid()))return unavailable;
  }catch{return unavailable;}
  return new Promise(resolve=>{
    let socket,buffer=Buffer.alloc(0),done=false,initialized=false;
    const requestId=randomUUID();
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);socket?.destroy();resolve(result);};
    const timer=setTimeout(()=>finish(unavailable),timeoutMs);
    const send=(message,callback)=>{
      const bytes=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);
      socket.write(Buffer.concat([header,bytes]),callback);
    };
    try {
      socket=net.createConnection(socketPath);
      socket.on('error',()=>finish(unavailable));socket.on('close',()=>finish(unavailable));
      socket.on('connect',()=>send({type:'request',method:'initialize',requestId,sourceClientId:'initializing-client',version:0,params:{clientType:'pawprint-provider-refresh'}}));
      socket.on('data',bytes=>{
        if(done)return;
        try {
          buffer=Buffer.concat([buffer,bytes]);
          if(buffer.length>65540)throw Error('Oversized IPC response');
          while(buffer.length>=4){
            const length=buffer.readUInt32LE(0);if(!length||length>65536)throw Error('Invalid IPC frame');
            if(buffer.length<length+4)return;
            const message=JSON.parse(buffer.subarray(4,length+4));buffer=buffer.subarray(length+4);
            if(message.type==='client-discovery-request'){
              send({type:'client-discovery-response',requestId:message.requestId,response:{canHandle:false}});continue;
            }
            if(initialized||message.type!=='response'||message.requestId!==requestId)continue;
            if(message.method!=='initialize'||message.resultType!=='success'||typeof message.result?.clientId!=='string'||!message.result.clientId)throw Error('Incompatible IPC');
            initialized=true;
            // Dot checks the required effective-config query, independently of
            // the account menu. Invalidate only local root-config dependencies.
            const keys=[['user-saved-config','local',null],['config','read-response','local',null],['config','layered-response','local',null],['config','effective','local',null]];
            let pending=keys.length;
            for(const queryKey of keys)send({type:'broadcast',method:'query-cache-invalidate',version:0,sourceClientId:message.result.clientId,params:{queryKey}},error=>{if(error)finish(unavailable);else if(--pending===0)finish({status:'requested'});});
          }
        }catch{finish(unavailable);}
      });
    }catch{finish(unavailable);}
  });
}

export function providerRefreshNotice(status) {
  if(status==='requested')return '默认连接已切换，已请求客户端刷新左下角。界面更新尚未确认；已有会话保持原连接。';
  if(status==='config-changed')return '切换后配置再次变化，无法确认默认连接；请刷新状态后检查。';
  return '默认连接已切换，但无法通知客户端刷新左下角。请重新打开账号菜单；仍未更新时重启客户端。已有会话保持原连接。';
}
