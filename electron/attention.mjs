import {mkdir,readFile,writeFile,rename,copyFile,open,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validWorkId} from '../core/work.mjs';

const MARKER='--pawprint-attention-v1';
const questionMatcher='request_user_input(_async)?$|AskUserQuestion$';
export const PAWPRINT_HOOKS=[
  {event:'PermissionRequest',label:'Pawprint · Approval alerts',purpose:'Shows when the client requests approval.'},
  {event:'PreToolUse',label:'Pawprint · Question alerts',purpose:'Tracks explicit questions before a blocking tool waits.'},
  {event:'PostToolUse',label:'Pawprint · Answered request cleanup',purpose:'Keeps accepted async questions waiting and clears answered requests.'},
  {event:'SessionEnd',label:'Pawprint · Closed chat cleanup',purpose:'Clears requests when the chat closes.'},
  {event:'UserPromptSubmit',label:'Pawprint · Resumed chat cleanup',purpose:'Clears old requests when the user resumes the chat.'},
  {event:'Stop',label:'Pawprint · Finished turn cleanup',purpose:'Clears requests when the turn finishes.'},
  {event:'Interrupt',label:'Pawprint · Stopped turn cleanup',purpose:'Clears requests when the user interrupts the turn.'},
];
const quote=value=>`'${String(value).replaceAll("'", "'\\''")}'`;
export function validAttentionEvent(r,now=Date.now()){
  return r?.version===1&&typeof r.eventId==='string'&&r.eventId.length>0&&r.eventId.length<=100&&validWorkId(r.threadId)&&Number.isFinite(r.at)&&r.at<=now+10000&&now-r.at<24*60*60*1000&&['waiting','resolved','clear'].includes(r.action)&&
    (r.action==='clear'||(['approval','question'].includes(r.kind)&&typeof r.requestId==='string'&&/^[a-f0-9]{64}$/.test(r.requestId)));
}
export class AttentionBridge{
  constructor({dataDirectory,directory,execPath,relayPath,onEvents,onChange,platform=process.platform,now=Date.now}){
    Object.assign(this,{dataDirectory,directory,execPath,relayPath,onEvents,onChange,platform,now});
    this.root=path.join(dataDirectory,'attention');this.journal=path.join(this.root,'events.jsonl');this.relay=path.join(this.root,'relay.cjs');this.offset=0;this.pending='';this.inode=null;this.seen=new Set();this.value={status:'off',supported:platform==='darwin',lastEventAt:null};
  }
  snapshot(){return {...this.value,rules:PAWPRINT_HOOKS,sourceFile:path.join(this.directory,'hooks.json')};}
  publish(value){this.value={...this.value,...value};this.onChange?.();}
  async prepareDefaults(){
    if(this.platform!=='darwin'){this.publish({status:'question-only'});return;}
    try{
      if(!(await stat(this.directory)).isDirectory())return;
    }catch{this.publish({status:'question-only'});return;}
    try{
      let rules={};try{rules=JSON.parse(await readFile(path.join(this.directory,'hooks.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      const installed=PAWPRINT_HOOKS.every(r=>rules.hooks?.[r.event]?.some(g=>g.hooks?.some(h=>h.command?.includes(MARKER)&&h.command.includes(quote(this.relay))&&h.command.includes(quote(this.execPath))&&h.statusMessage===r.label)));
      if(installed){try{await stat(this.relay);this.publish({status:'installed'});return;}catch{}}
      await this.install();
    }catch{this.publish({status:'error'});}
  }
  install(){
    if(this.installing)return this.installing;
    this.installing=this.installRules().finally(()=>{this.installing=null;});return this.installing;
  }
  async installRules(){
    if(this.platform!=='darwin')throw new Error('Attention hook setup is currently available on macOS.');
    await mkdir(this.root,{recursive:true,mode:0o700});await mkdir(this.directory,{recursive:true,mode:0o700});
    const file=path.join(this.directory,'hooks.json');let current={};
    try{current=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Existing hooks.json could not be read. It has not been changed.');}
    if(!current||typeof current!=='object'||Array.isArray(current)||(current.hooks!==undefined&&(!current.hooks||typeof current.hooks!=='object'||Array.isArray(current.hooks))))throw new Error('Existing hooks.json is invalid. It has not been changed.');
    const command=`ELECTRON_RUN_AS_NODE=1 ${quote(this.execPath)} ${quote(this.relay)} ${quote(this.journal)} ${MARKER}`;
    const next=structuredClone(current);next.hooks||={};
    const owned=h=>typeof h.command==='string'&&h.command.includes(MARKER)&&h.command.includes(quote(this.relay));
    const entries=[['PermissionRequest',null],['PreToolUse',questionMatcher],['PostToolUse','Bash|apply_patch|mcp__.*|request_user_input(_async)?$|AskUserQuestion$'],['Stop',null],['Interrupt',null],['SessionEnd',null],['UserPromptSubmit',null]];
    for(const [event,matcher] of entries){
      const groups=next.hooks[event]||[];
      if(!Array.isArray(groups))throw new Error('Existing hook rules are invalid. They have not been changed.');
      next.hooks[event]=groups.map(group=>({...group,hooks:(group.hooks||[]).filter(h=>!owned(h))})).filter(g=>g.hooks.length);
      next.hooks[event].push({...matcher?{matcher}:{},hooks:[{type:'command',command,timeout:3,statusMessage:PAWPRINT_HOOKS.find(r=>r.event===event).label}]});
    }
    await writeFile(this.relay,await readFile(this.relayPath),{mode:0o600});
    try{await copyFile(file,path.join(this.root,`hooks-before-${this.now()}-${randomUUID()}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
    const temporary=file+'.pawprint.tmp';await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600,flush:true});await rename(temporary,file);
    await writeFile(path.join(this.root,'installation.json'),JSON.stringify({directory:this.directory,command}),{mode:0o600});
    this.publish({status:'installed'});return {file,command};
  }
  async configure(enabled){
    clearInterval(this.timer);await this.polling;
    if(!enabled){this.publish({status:'off'});return;}
    this.publish({status:['installed','connected'].includes(this.value.status)?this.value.status:'question-only'});await this.poll();
    this.timer=setInterval(()=>void this.poll(),1000);this.timer.unref?.();
  }
  async uninstall(){
    const file=path.join(this.directory,'hooks.json');let current;
    try{current=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'){await this.configure(false);return;}throw new Error('Existing hooks.json could not be read. It has not been changed.');}
    const next=structuredClone(current);
    const owned=h=>typeof h.command==='string'&&h.command.includes(MARKER)&&h.command.includes(quote(this.relay));
    for(const [event,groups] of Object.entries(next.hooks||{})){
      if(!Array.isArray(groups))continue;
      next.hooks[event]=groups.map(group=>({...group,hooks:(group.hooks||[]).filter(h=>!owned(h))})).filter(g=>g.hooks.length);
      if(!next.hooks[event].length)delete next.hooks[event];
    }
    await copyFile(file,path.join(this.root,`hooks-before-disconnect-${this.now()}-${randomUUID()}.json`));
    const temporary=file+'.pawprint.tmp';await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600,flush:true});await rename(temporary,file);
    await this.configure(false);
  }
  poll(){if(this.polling)return this.polling;this.polling=this.read().catch(()=>this.publish({status:'error'})).finally(()=>{this.polling=null;});return this.polling;}
  async read(){
    let info;try{info=await stat(this.journal);}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(this.inode!==info.ino||info.size<this.offset){this.inode=info.ino;this.offset=Math.max(0,info.size-256*1024);this.pending='';this.discard=this.offset>0;}
    if(info.size===this.offset)return;
    const file=await open(this.journal,'r');let bytes;
    try{const buffer=Buffer.alloc(Math.min(256*1024,info.size-this.offset));const r=await file.read(buffer,0,buffer.length,this.offset);this.offset+=r.bytesRead;bytes=buffer.subarray(0,r.bytesRead).toString('utf8');}finally{await file.close();}
    const events=[];
    const lines=(this.pending+bytes).split('\n');this.pending=lines.pop();
    for(const line of lines){
      if(this.discard){this.discard=false;continue;}
      try{const r=JSON.parse(line);if(validAttentionEvent(r,this.now())&&!this.seen.has(r.eventId)){this.seen.add(r.eventId);events.push(r);if(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);}}catch{}
    }
    if(this.pending.length>10000)this.pending='';
    if(events.length){this.publish({status:'connected',lastEventAt:Math.max(...events.map(e=>e.at))});await this.onEvents(events);}
  }
  async close(){clearInterval(this.timer);await this.polling;}
}
