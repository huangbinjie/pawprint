import path from 'node:path';
import {lstat,readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validWorkId} from '../core/work.mjs';
import {readRouteEvidence,readTurnRoutes} from './codex-route-evidence.mjs';

const providerId=id=>id==='openai'||/^pawprint_[a-f0-9]{32}$/.test(id);
const failure=()=>Error('会话服务绑定记录无法读取，已停止转发；请检查 Pawprint 数据目录。');
export class CodexSessionBindings{
 constructor(directory){this.file=path.join(directory,'codex-session-bindings.json');this.directory=directory;this.queue=Promise.resolve();}
 serial(fn){const job=this.queue.then(fn);this.queue=job.catch(()=>{});return job;}
 async load(){
  if(this.state)return;
  try{
   const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw failure();
   const state=JSON.parse(await readFile(this.file,'utf8'));
   if(state.version!==1||!state.threads||typeof state.threads!=='object'||Array.isArray(state.threads)||(state.initialized!==undefined&&typeof state.initialized!=='boolean'))throw failure();
   for(const [id,row] of Object.entries(state.threads))if(!validWorkId(id)||!providerId(row?.providerId)||!Number.isSafeInteger(row.at)||row.at<0)throw failure();
   this.state=state;
  }catch(e){if(e.code!=='ENOENT')throw failure();this.state={version:1,threads:{}};}
 }
 async save(){
  await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,JSON.stringify(this.state),{flag:'wx',mode:0o600});await rename(tmp,this.file);}finally{await rm(tmp,{force:true});}
 }
 async existing(directory){
  try{await lstat(path.join(directory,'state_5.sqlite'));}catch(e){
   if(e.code!=='ENOENT')throw e;
   try{
    const file=path.join(directory,'session_index.jsonl'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw failure();
    const rows=new Map();for(const line of (await readFile(file,'utf8')).split('\n')){try{const row=JSON.parse(line);if(validWorkId(row.id))rows.set(row.id,{id:row.id,model_provider:'openai'});}catch{}}
    return [...rows.values()];
   }catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(directory,'state_5.sqlite'),{readOnly:true});
  try{return db.prepare('SELECT id,model_provider FROM threads').all().filter(r=>validWorkId(r.id));}finally{db.close();}
 }
 prepare({directory,currentProviderId,requireExisting=false}){return this.serial(async()=>{
  if(!providerId(currentProviderId))throw Error('无效的默认服务。');
  if(requireExisting)try{await lstat(this.file);}catch{throw failure();}
  await this.load();const rows=await this.existing(directory),routes=await readRouteEvidence(this.directory),turns=await readTurnRoutes(this.directory);
  for(const [key,row] of Object.entries(turns)){const id=key.split(':')[0];if(!row.ambiguous&&(!routes[id]||routes[id].at<row.at))routes[id]=row;}
  const next=structuredClone(this.state);
  for(const row of rows){
   if(Object.hasOwn(next.threads,row.id))continue;
   const known=providerId(row.model_provider)&&row.model_provider!=='openai'?row.model_provider:routes[row.id]?.providerId;
   if(row.model_provider&&row.model_provider!=='openai'&&!providerId(row.model_provider))continue;
   const id=known||(this.state.initialized?currentProviderId:'openai');
   next.threads[row.id]={providerId:id,at:Date.now(),source:known?'observed':'existing'};
  }
  next.initialized=true;
  const previous=this.state;this.state=next;
  try{await this.save();}catch(e){this.state=previous;throw e;}
 });}
 resolve(threadId,fallback){return this.serial(async()=>{
  if(!validWorkId(threadId)||!providerId(fallback))throw Error('请求缺少有效的会话标识，已停止转发。');
  await this.load();const previous=this.state.threads[threadId];
  if(previous)return previous.providerId;
  this.state.threads[threadId]={providerId:fallback,at:Date.now(),source:'request'};
  try{await this.save();}catch(e){delete this.state.threads[threadId];throw e;}
  return fallback;
 });}
 bind(threadId,id){return this.serial(async()=>{
  if(!validWorkId(threadId)||!providerId(id))throw Error('无效的会话服务绑定。');await this.load();
  if(this.state.threads[threadId]?.providerId&&this.state.threads[threadId].providerId!==id)throw Error('此会话已绑定其他服务，不能通过默认 Provider 切换修改。');
  const previous=this.state.threads[threadId];this.state.threads[threadId]={providerId:id,at:Date.now(),source:'manual'};
  try{await this.save();}catch(e){if(previous)this.state.threads[threadId]=previous;else delete this.state.threads[threadId];throw e;}
 });}
 async snapshot(){await this.queue;await this.load();return structuredClone(this.state.threads);}
}
