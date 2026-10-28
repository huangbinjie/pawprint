import net from 'node:net';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const CAPACITY_RETRY_DELAY=30_000;
export const CAPACITY_RETRIES_PER_ROUND=5;
export const CAPACITY_RETRY_ROUNDS=3;
export const CAPACITY_RETRY_LIMIT=CAPACITY_RETRIES_PER_ROUND*CAPACITY_RETRY_ROUNDS;

export async function retryCapacityTurn({directory,threadId,turnId,signal,socketPath,platform=process.platform}) {
  const endpoint=socketPath||(platform==='win32'?'\\\\.\\pipe\\codex-ipc':path.join(directory,'ipc','ipc.sock'));
  if(platform!=='win32'){
    const info=await lstat(endpoint);
    if(!info.isSocket()||info.isSymbolicLink()||(process.getuid&&info.uid!==process.getuid()))throw Error('Unavailable client socket');
  }
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(endpoint);
    let buffer=Buffer.alloc(0),client='initializing-client',owner,pending,done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(result);};
    const abort=()=>finish(signal.reason||Error('Cancelled'));
    const timer=setTimeout(()=>finish(Error('Client retry timed out')),5000);
    const send=message=>{const bytes=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);socket.write(Buffer.concat([header,bytes]));};
    const request=(method,params,targetClientId)=>{
      signal.throwIfAborted();pending={requestId:randomUUID(),method};
      send({type:'request',...pending,sourceClientId:client,version:method==='initialize'?0:method==='thread-follower-start-turn'?2:1,params,targetClientId});
    };
    signal.addEventListener('abort',abort,{once:true});
    socket.on('error',()=>finish(Error('Client retry connection unavailable')));
    socket.on('close',()=>finish(Error('Client retry connection closed')));
    socket.on('connect',()=>request('initialize',{clientType:'pawprint-capacity-retry'}));
    socket.on('data',bytes=>{
      try{
        buffer=Buffer.concat([buffer,bytes]);
        while(buffer.length>=4){
          const length=buffer.readUInt32LE(0);
          if(!length||length>64*1024*1024)throw Error('Unsupported IPC frame');
          if(buffer.length<length+4)return;
          const m=JSON.parse(buffer.subarray(4,length+4));buffer=buffer.subarray(length+4);
          if(m.type==='client-discovery-request'){send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});continue;}
          if(m.type==='response'&&m.requestId===pending?.requestId){
            if(m.resultType!=='success'||m.method!==pending.method)throw Error('Client rejected retry');
            if(pending.method==='initialize'){
              if(typeof m.result?.clientId!=='string'||!m.result.clientId)throw Error('Unsupported client');
              client=m.result.clientId;request('thread-owner-discovery',{hostId:'local',conversationId:threadId});
            }else if(pending.method==='thread-owner-discovery'){
              if(typeof m.handledByClientId!=='string'||!m.handledByClientId)throw Error('No local thread owner');
              owner=m.handledByClientId;pending=null;
              send({type:'broadcast',method:'thread-stream-following-changed',sourceClientId:client,targetClientIds:[owner],version:1,params:{hostId:'local',conversationId:threadId,following:true}});
            }else{finish(null,{status:'retried'});return;}
          }else if(m.type==='broadcast'&&m.method==='thread-stream-state-changed'&&m.sourceClientId===owner&&m.params?.hostId==='local'&&m.params.conversationId===threadId&&(!m.targetClientIds||m.targetClientIds.includes(client))&&!pending){
            if(m.version!==11||m.params.change?.type!=='snapshot')throw Error('Unsupported thread snapshot');
            const state=m.params.change.conversationState;
            if(state?.id!==threadId||!Array.isArray(state.requests))throw Error('Unsupported thread state');
            const history=state.turnHistory?.kind==='canonical'?state.turnHistory.history:null;
            const entry=history?.islands?.flatMap(island=>island.entries).at(-1);
            const latest=history?history.entitiesByKey?.[entry?.value]:state.turns?.at(-1);
            // A native/manual continuation or stop supersedes this failed turn.
            if(!['idle','systemError'].includes(state.threadRuntimeStatus?.type)||state.requests.length||latest?.turnId!==turnId||latest.status!=='failed'||latest.error?.codexErrorInfo!=='serverOverloaded'){
              finish(null,{status:'skipped'});return;
            }
            // Match native capacity retry: empty input, inherited model/mode/permissions.
            request('thread-follower-start-turn',{conversationId:threadId,turnStart:{request:{threadId,input:[],turnTrigger:'capacity_retry_automatic'}}},owner);
          }
        }
      }catch{finish(Error('Client retry unavailable'));}
    });
  });
}

export class CodexCapacityRetry {
  constructor({retry=retryCapacityTurn,onChange=()=>{},now=Date.now,platform=process.platform}={}){
    Object.assign(this,{retry,onChange,now,platform});this.entries=new Map();this.enabled=false;this.status='off';this.lastAttempt=null;
  }
  snapshot(){
    const progress=attempt=>({attempt:(attempt-1)%CAPACITY_RETRIES_PER_ROUND+1,maxAttempts:CAPACITY_RETRIES_PER_ROUND,round:Math.ceil(attempt/CAPACITY_RETRIES_PER_ROUND),maxRounds:CAPACITY_RETRY_ROUNDS});
    const scheduled=[...this.entries].filter(([,entry])=>entry.timer).map(([threadId,entry])=>({threadId,turnId:entry.turnId,retryAt:entry.retryAt,...progress(entry.attempts+1)})).sort((a,b)=>a.retryAt-b.retryAt);
    return {enabled:this.enabled,supported:['darwin','win32'].includes(this.platform),status:this.status,pending:scheduled.length,scheduled,lastAttempt:this.lastAttempt&&{...this.lastAttempt,...progress(this.lastAttempt.attempt)}};
  }
  publish(status){this.status=status;this.onChange();}
  configure({enabled,directory}){
    enabled=enabled&&['darwin','win32'].includes(this.platform);
    if(this.enabled===enabled&&this.directory===directory)return;
    this.close();this.directory=directory;this.enabled=enabled;this.publish(enabled?'watching':'off');
  }
  consume(event){
    if(!this.enabled)return;
    const previous=this.entries.get(event.threadId);
    if(event.type==='task_started'){
      if(previous)clearTimeout(previous.timer);
      const automatic=event.trigger==='capacity_retry_automatic';
      if(!automatic)previous?.controller?.abort();
      const attempts=automatic?(previous?.attempts??1):0;
      this.entries.set(event.threadId,{turnId:event.turnId,attempts,automatic,controller:automatic?previous?.controller:null});
      if(automatic){
        if(this.lastAttempt?.threadId===event.threadId){this.lastAttempt.status='started';this.lastAttempt.retryTurnId=event.turnId;}
        else this.lastAttempt={threadId:event.threadId,turnId:event.turnId,retryTurnId:event.turnId,attempt:attempts,at:event.at,status:'started'};
      }
      this.publish('watching');return;
    }
    if(previous?.turnId!==event.turnId)return;
    if(previous.automatic&&this.lastAttempt?.retryTurnId===event.turnId)this.lastAttempt.status=event.type==='turn_aborted'?'stopped':event.failed?'failed':'completed';
    if(event.type!=='task_complete'||event.errorCode!=='server_overloaded'){
      clearTimeout(previous.timer);previous.controller?.abort();this.entries.delete(event.threadId);this.publish('watching');return;
    }
    if(previous.timer)return;
    if(previous.attempts>=CAPACITY_RETRY_LIMIT){this.publish('exhausted');return;}
    const delay=previous.attempts>0&&previous.attempts%CAPACITY_RETRIES_PER_ROUND===0?CAPACITY_RETRY_DELAY:0;
    previous.retryAt=event.at+delay;
    previous.timer=setTimeout(()=>{
      previous.timer=null;previous.attempts++;const controller=new AbortController();previous.controller=controller;
      const attempt={threadId:event.threadId,turnId:event.turnId,attempt:previous.attempts,at:this.now(),status:'requesting'};this.lastAttempt=attempt;
      this.publish('retrying');
      void this.retry({directory:this.directory,threadId:event.threadId,turnId:event.turnId,signal:controller.signal,platform:this.platform})
        .then(result=>{if(!controller.signal.aborted){if(attempt.status==='requesting')attempt.status=result.status==='retried'?'requested':'skipped';this.publish(result.status==='retried'?'watching':'skipped');}})
        .catch(()=>{if(!controller.signal.aborted){if(attempt.status==='requesting')attempt.status='unavailable';this.publish('unavailable');}})
        .finally(()=>{if(previous.controller===controller)previous.controller=null;});
    },Math.max(0,previous.retryAt-this.now()));
    previous.timer.unref?.();this.publish('waiting');
  }
  close(){for(const entry of this.entries.values()){clearTimeout(entry.timer);entry.controller?.abort();}this.entries.clear();this.enabled=false;this.lastAttempt=null;}
}
