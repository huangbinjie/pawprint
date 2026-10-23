import path from 'node:path';
import {lstat,readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validWorkId} from '../core/work.mjs';

const fileFor=directory=>path.join(directory,'codex-route-evidence.json');
const turnsFile=directory=>path.join(directory,'codex-turn-routes.json');
export function nativeTurnId(headers){
  try{
    const value=headers['x-codex-turn-metadata'];if(typeof value!=='string'||value.length>8192)return null;
    const metadata=JSON.parse(value);
    return validWorkId(headers['thread-id'])&&metadata.thread_id===headers['thread-id']&&validWorkId(metadata.turn_id)?metadata.turn_id:null;
  }catch{return null;}
}
export async function readTurnRoutes(directory){
  if(!directory)return {};
  try{
    const file=turnsFile(directory),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4*1024*1024)return {};
    const data=JSON.parse(await readFile(file,'utf8'));
    return Object.fromEntries(Object.entries(data).filter(([key,r])=>{
      const [thread,turn,...extra]=key.split(':');
      return !extra.length&&validWorkId(thread)&&validWorkId(turn)&&/^pawprint_[a-f0-9]{32}$/.test(r?.providerId)&&typeof r.model==='string'&&r.model.length>0&&r.model.length<=160&&!/[\x00-\x1f]/.test(r.model)&&Number.isSafeInteger(r.at)&&r.at>=0&&(r.ambiguous===undefined||typeof r.ambiguous==='boolean');
    }));
  }catch{return {};}
}
export async function readRouteEvidence(directory){
  if(!directory)return {};
  try{
    const file=fileFor(directory),info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)return {};
    const data=JSON.parse(await readFile(file,'utf8'));
    return Object.fromEntries(Object.entries(data).filter(([id,r])=>validWorkId(id)&&/^pawprint_[a-f0-9]{32}$/.test(r?.providerId)&&typeof r.model==='string'&&r.model.length>0&&r.model.length<=160&&!/[\x00-\x1f]/.test(r.model)&&Number.isSafeInteger(r.at)&&r.at>=0));
  }catch{return {};}
}

// Retain only observed request destinations, including failed attempts, not
// evidence of success or billing. Never store request contents,
// identity headers, credentials or the bridge capability URL.
export class CodexRouteEvidence{
  constructor(directory){this.directory=directory;this.queue=Promise.resolve();}
  record({threadId,providerId,model}){
    if(!validWorkId(threadId)||!/^pawprint_[a-f0-9]{32}$/.test(providerId)||typeof model!=='string'||!model||model.length>160||/[\x00-\x1f]/.test(model))return Promise.resolve();
    const task=this.queue.then(async()=>{
      const rows=await readRouteEvidence(this.directory);
      rows[threadId]={providerId,model,at:Date.now()};
      const latest=Object.fromEntries(Object.entries(rows).sort((a,b)=>b[1].at-a[1].at).slice(0,512));
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const file=fileFor(this.directory),tmp=file+'.'+randomUUID()+'.tmp';
      try{await writeFile(tmp,JSON.stringify(latest),{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await rm(tmp,{force:true});}
    });
    this.queue=task.catch(()=>{});return task;
  }
  // Separate successful HTTP delivery from the attempted-route title marker.
  // Token quantities still come from Codex's own metering records, not this map.
  recordTurn({threadId,turnId,providerId,model}){
    if(!validWorkId(threadId)||!validWorkId(turnId)||!/^pawprint_[a-f0-9]{32}$/.test(providerId)||typeof model!=='string'||!model||model.length>160||/[\x00-\x1f]/.test(model))return Promise.resolve();
    const at=Date.now();
    const task=this.queue.then(async()=>{
        this.turns??=await readTurnRoutes(this.directory);
        const key=threadId+':'+turnId,prior=this.turns[key];
        if(prior?.providerId===providerId&&prior.model===model)return;
        this.turns[key]={providerId,model,at,...(prior?{ambiguous:true}:{})};
        this.turns=Object.fromEntries(Object.entries(this.turns).filter(([,r])=>r.at>Date.now()-35*86400000).sort((a,b)=>b[1].at-a[1].at).slice(0,10000));
        await mkdir(this.directory,{recursive:true,mode:0o700});const turns=turnsFile(this.directory),staging=turns+'.'+randomUUID()+'.tmp';
        try{await writeFile(staging,JSON.stringify(this.turns),{mode:0o600,flag:'wx'});await rename(staging,turns);}finally{await rm(staging,{force:true});}
    });
    this.queue=task.catch(()=>{});return task;
  }
}
