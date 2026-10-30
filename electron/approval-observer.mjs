import net from 'node:net';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {validWorkId} from '../core/work.mjs';

const METHODS=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval']);
const MAX_FRAME=64*1024*1024;
const forbidden=new Set(['__proto__','prototype','constructor']);
export function approvalId(threadId,request){return createHash('sha256').update(JSON.stringify(['desktop-ipc',threadId,request.method,request.id])).digest('hex');}
function project(r){
  if(!r||!['string','number'].includes(typeof r.id)||typeof r.method!=='string')throw Error('Unsupported request');
  return {id:r.id,method:r.method,params:{threadId:r.params?.threadId,turnId:r.params?.turnId}};
}
// Keep only request identity. Never retain chat text, commands or review rationale.
export class ApprovalRequests {
  constructor(threadId){this.threadId=threadId;this.revision=null;this.requests=[];}
  consume(change){
    if(!Number.isSafeInteger(change?.revision)||change.revision<0)throw Error('Unsupported revision');
    if(change.type==='snapshot'){
      if(change.conversationState?.id!==this.threadId||!Array.isArray(change.conversationState.requests))throw Error('Unsupported snapshot');
      this.requests=change.conversationState.requests.map(project);
    }else if(change.type==='patches'){
      if(this.revision===null||change.baseRevision!==this.revision||change.revision<=this.revision||!Array.isArray(change.patches))throw Error('Missed snapshot or patch');
      const requests=structuredClone(this.requests);
      for(const p of change.patches){
        if(!Array.isArray(p.path)||p.path.some(k=>forbidden.has(String(k)))||!['add','replace','remove'].includes(p.op))throw Error('Unsupported patch');
        if(p.path.length===0)throw Error('Root patch needs a snapshot');
        if(p.path[0]!=='requests')continue;
        const keys=p.path.slice(1);
        if(!keys.length){if(p.op==='remove'||!Array.isArray(p.value))throw Error('Unsupported request list');requests.splice(0,requests.length,...p.value.map(project));continue;}
        const index=keys[0];
        if(!Number.isSafeInteger(index)||index<0||index>requests.length)throw Error('Unsupported index');
        if(keys.length===1){
          if(p.op==='add')requests.splice(index,0,project(p.value));
          else {if(index>=requests.length)throw Error('Missing request');if(p.op==='remove')requests.splice(index,1);else requests[index]=project(p.value);}
        }else{
          if(!requests[index])throw Error('Missing request');
          const field=keys[1];
          if(!['id','method','params'].includes(field))continue;
          if(field==='params'){
            if(keys.length===2){requests[index].params={threadId:p.value?.threadId,turnId:p.value?.turnId};continue;}
            if(!['threadId','turnId'].includes(keys[2])||keys.length!==3)continue;
            if(p.op==='remove')delete requests[index].params[keys[2]];else requests[index].params[keys[2]]=p.value;
          }else{if(keys.length!==2||p.op==='remove')throw Error('Missing request identity');requests[index][field]=p.value;}
        }
      }
      this.requests=requests.map(project);
    }else throw Error('Unsupported change');
    if(this.requests.length>128)throw Error('Too many requests');
    this.revision=change.revision;
    return new Set(this.requests.filter(r=>METHODS.has(r.method)&&r.params.threadId===this.threadId).map(r=>approvalId(this.threadId,r)));
  }
}

// Internal desktop IPC, observed read-only: no task or approval-response methods.
export class ApprovalObserver {
  constructor({getDirectory,getThreads,onEvents,onChange,platform=process.platform,now=Date.now,socketPath}){
    Object.assign(this,{getDirectory,getThreads,onEvents,onChange,platform,now,socketPath});
    this.enabled=false;this.status='off';this.client='initializing-client';this.pending=new Map();this.following=new Map();this.attempts=new Map();this.frameHeader=Buffer.alloc(0);this.frameChunks=[];this.frameBytes=0;this.expectedFrameBytes=null;this.eventQueue=Promise.resolve();
  }
  snapshot(){return {status:this.status,source:'desktop-ipc',supported:['darwin','win32'].includes(this.platform)};}
  publish(status){if(this.status!==status){this.status=status;this.onChange?.();}}
  emit(threadId,action,requestId){const event={version:1,eventId:randomUUID(),threadId,at:this.now(),kind:'approval',action,requestId,source:'desktop-ipc'};this.eventQueue=this.eventQueue.then(()=>this.onEvents([event])).catch(()=>this.publish('unavailable'));}
  clear(entry,threadId){for(const id of entry.ids)this.emit(threadId,'resolved',id);entry.ids.clear();}
  async configure(enabled){
    clearInterval(this.timer);this.enabled=false;this.disconnect();await this.eventQueue;
    this.enabled=enabled;this.publish(enabled?'unavailable':'off');
    if(enabled){void this.refresh();this.timer=setInterval(()=>void this.refresh(),2000);this.timer.unref?.();}
  }
  endpoint(){return this.socketPath||(this.platform==='win32'?'\\\\.\\pipe\\codex-ipc':path.join(this.getDirectory(),'ipc','ipc.sock'));}
  async refresh(){
    if(!this.enabled||this.refreshing)return;
    this.refreshing=true;
    try{
      const endpoint=this.endpoint();
      if(this.connectedPath&&endpoint!==this.connectedPath)this.disconnect();
      if(!this.socket){
        if(this.platform!=='win32'){const info=await stat(endpoint);if(!info.isSocket()||(process.getuid&&info.uid!==process.getuid()))throw Error('Not an owned socket');}
        if(!this.enabled)return;
        this.connect(endpoint);return;
      }
      if(this.client==='initializing-client')return;
      const threads=new Set(this.getThreads().filter(validWorkId).slice(0,64));
      for(const [threadId,entry] of this.following)if(!threads.has(threadId)){this.follow(threadId,entry.owner,false);this.clear(entry,threadId);this.following.delete(threadId);}
      await Promise.all([...threads].filter(id=>!this.following.has(id)&&this.now()-(this.attempts.get(id)??-Infinity)>5000).map(async threadId=>{
        this.attempts.set(threadId,this.now());const socket=this.socket;
        try{const owner=await this.request('thread-owner-discovery',{hostId:'local',conversationId:threadId});if(!this.enabled||this.socket!==socket||owner.resultType!=='success'||typeof owner.handledByClientId!=='string')return;
          this.following.set(threadId,{owner:owner.handledByClientId,state:new ApprovalRequests(threadId),ids:new Set()});this.follow(threadId,owner.handledByClientId,true);
        }catch{}
      }));
    }catch{this.publish('unavailable');}finally{this.refreshing=false;}
  }
  connect(endpoint){
    const socket=net.createConnection(endpoint);this.socket=socket;this.connectedPath=endpoint;
    socket.on('connect',async()=>{try{const r=await this.request('initialize',{clientType:'pawprint-approval-observer'});if(this.socket!==socket)return;if(r.resultType!=='success'||typeof r.result?.clientId!=='string')throw Error('Unsupported IPC');this.client=r.result.clientId;this.publish('connected');void this.refresh();}catch{socket.destroy();}});
    socket.on('data',bytes=>{if(this.socket!==socket)return;try{
      for(let offset=0;offset<bytes.length;){
        if(this.expectedFrameBytes===null){
          const take=Math.min(4-this.frameHeader.length,bytes.length-offset);
          this.frameHeader=Buffer.concat([this.frameHeader,bytes.subarray(offset,offset+take)]);offset+=take;
          if(this.frameHeader.length<4)continue;
          const length=this.frameHeader.readUInt32LE(0);this.frameHeader=Buffer.alloc(0);
          if(!length||length>MAX_FRAME)throw Error('Invalid frame');
          this.expectedFrameBytes=length;this.frameChunks=[];this.frameBytes=0;
        }
        const take=Math.min(this.expectedFrameBytes-this.frameBytes,bytes.length-offset);
        if(take){this.frameChunks.push(bytes.subarray(offset,offset+take));this.frameBytes+=take;offset+=take;}
        if(this.frameBytes===this.expectedFrameBytes){
          const message=JSON.parse(Buffer.concat(this.frameChunks,this.frameBytes).toString());
          this.frameChunks=[];this.frameBytes=0;this.expectedFrameBytes=null;this.message(message);
        }
      }
    }catch{socket.destroy();}});
    socket.on('error',()=>{});socket.on('close',()=>{if(this.socket===socket){this.disconnect();this.publish(this.enabled?'unavailable':'off');}});
  }
  send(message){if(!this.socket?.writable)throw Error('Disconnected');const bytes=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);this.socket.write(Buffer.concat([header,bytes]));}
  request(method,params){
    if(!['initialize','thread-owner-discovery'].includes(method))throw Error('Read-only IPC');
    const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('Timeout'));},3000);timer.unref?.();this.pending.set(requestId,{resolve,reject,timer});try{this.send({type:'request',requestId,sourceClientId:this.client,version:method==='initialize'?0:1,method,params});}catch(e){clearTimeout(timer);this.pending.delete(requestId);reject(e);}});
  }
  follow(threadId,owner,following){try{this.send({type:'broadcast',method:'thread-stream-following-changed',sourceClientId:this.client,targetClientIds:[owner],version:1,params:{hostId:'local',conversationId:threadId,following}});}catch{}}
  message(m){
    if(m.type==='response'){const p=this.pending.get(m.requestId);if(p){clearTimeout(p.timer);this.pending.delete(m.requestId);p.resolve(m);}return;}
    if(m.type==='client-discovery-request'){this.send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
    if(m.type!=='broadcast')return;
    if(m.method==='client-status-changed'&&m.params?.status==='disconnected'){for(const [id,entry] of this.following)if(entry.owner===m.params.clientId){this.clear(entry,id);this.following.delete(id);}return;}
    if(m.method!=='thread-stream-state-changed'||m.params?.hostId!=='local'||(m.targetClientIds&&!m.targetClientIds.includes(this.client)))return;
    const id=m.params.conversationId,entry=this.following.get(id);if(!entry||entry.owner!==m.sourceClientId)return;
    try{
      if(m.version!==11)throw Error('Unsupported stream version');
      const next=entry.state.consume(m.params.change);
      for(const previous of entry.ids)if(!next.has(previous))this.emit(id,'resolved',previous);
      for(const current of next)if(!entry.ids.has(current))this.emit(id,'waiting',current);
      entry.ids=next;
    }catch{this.clear(entry,id);this.follow(id,entry.owner,false);this.following.delete(id);this.publish('unavailable');}
  }
  disconnect(){
    for(const [id,entry] of this.following){this.follow(id,entry.owner,false);this.clear(entry,id);}
    this.following.clear();this.attempts.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Disconnected'));}this.pending.clear();
    const socket=this.socket;this.socket=null;this.connectedPath=null;this.client='initializing-client';this.frameHeader=Buffer.alloc(0);this.frameChunks=[];this.frameBytes=0;this.expectedFrameBytes=null;if(socket){socket.end();setTimeout(()=>socket.destroy(),200).unref?.();}
  }
  async close(){await this.configure(false);}
}
