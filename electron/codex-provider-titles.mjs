import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse} from 'smol-toml';
import {validWorkId} from '../core/work.mjs';
import {cleanWorkLabel,readWorkTitles} from './work-titles.mjs';

export function providerTitle(title, providerId, label) {
  if (!providerId || providerId === 'openai') return null;
  const name = cleanWorkLabel(label || providerId, 60).replace(/[\[\]]/g,'').trim();
  if (!name || typeof title !== 'string' || !title.trim()) return null;
  const prefix = `[${name}] `;
  if (title.startsWith(prefix)) return null;
  return prefix + title;
}
export async function readProviderTitleCandidates(directory) {
  let db;
  try {
    const file=path.join(directory,'state_5.sqlite');await stat(file);
    const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true});
    const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
    if(!['id','model_provider','updated_at'].every(k=>columns.has(k)))return [];
    const filters=["model_provider IS NOT NULL","model_provider != ''","model_provider != 'openai'",columns.has('archived')?'archived=0':'1',columns.has('source')?"(source IS NULL OR source NOT LIKE '%subagent%')":'1'];
    const rows=db.prepare(`SELECT id,model_provider FROM threads WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT 64`).all().filter(r=>validWorkId(r.id));
    const titles=new Map((await readWorkTitles(directory,rows.map(r=>r.id))).map(r=>[r.threadId,r.title]));
    return rows.filter(r=>titles.get(r.id)).map(r=>({id:r.id,providerId:r.model_provider,title:titles.get(r.id)}));
  } catch { return []; } finally { db?.close(); }
}
export async function findCodexBinary() {
  const candidates=[...String(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,process.platform==='win32'?'codex.exe':'codex')),
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex','/opt/homebrew/bin/codex','/usr/local/bin/codex'];
  for(const file of candidates)try{await access(file,constants.X_OK);return file;}catch{}
  throw Error('未找到 Codex CLI，无法自动标注标题。');
}
// Only metadata reads and supported name changes. No turns, prompts or approvals.
export class CodexTitleClient {
  constructor({binary,directory}) {Object.assign(this,{binary,directory});this.pending=new Map();this.sequence=0;this.buffer='';}
  async connect() {
    this.child=spawn(this.binary,['app-server','--stdio'],{env:{...process.env,CODEX_HOME:this.directory},stdio:['pipe','pipe','ignore']});
    this.child.on('error',()=>this.fail());this.child.on('exit',()=>this.fail());this.child.stdin.on('error',()=>this.fail());
    this.child.stdout.on('data',chunk=>{
      this.buffer+=chunk;if(this.buffer.length>4*1024*1024){this.fail();this.child.kill();return;}
      let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}
        const p=this.pending.get(m.id);if(!p)continue;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('Codex 拒绝修改标题，请稍后重试。')):p.resolve(m.result);
      }
    });
    await this.request('initialize',{clientInfo:{name:'pawprint_provider_titles',version:'1'}});
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return this;
  }
  request(method,params) {
    if(!['initialize','thread/read','thread/name/set'].includes(method))return Promise.reject(Error('Unsupported title operation'));
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex 标题接口超时。'));},8000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  }
  fail(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex 标题连接已断开。'));}this.pending.clear();}
  async close(){this.fail();const child=this.child;if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1000);timer.unref?.();});}
}
export class CodexProviderTitles {
  constructor({directory,dataDirectory,onChange=()=>{},readCandidates=readProviderTitleCandidates,clientFactory,now=Date.now}) {
    Object.assign(this,{directory,dataDirectory,onChange,readCandidates,now});
    this.file=path.join(dataDirectory,'codex-provider-titles.json');this.state={enabled:true,edits:{}};
    this.clientFactory=clientFactory|| (async()=>new CodexTitleClient({binary:await findCodexBinary(),directory}).connect());
    this.value={status:'idle',error:null,updated:0};
  }
  snapshot(){return {enabled:this.state.enabled,...this.value};}
  publish(value){Object.assign(this.value,value);this.onChange();}
  async load(){try{const saved=JSON.parse(await readFile(this.file,'utf8'));if(typeof saved.enabled==='boolean')this.state.enabled=saved.enabled;if(saved.edits&&typeof saved.edits==='object'&&!Array.isArray(saved.edits))this.state.edits=saved.edits;}catch(e){if(e.code!=='ENOENT')this.publish({status:'error',error:'标题标注记录无法读取。'});}}
  async save(){await mkdir(this.dataDirectory,{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(this.state),{mode:0o600,flag:'wx'});await rename(tmp,this.file);}finally{const{rm}=await import('node:fs/promises');await rm(tmp,{force:true});}}
  async configure(enabled){if(typeof enabled!=='boolean')throw Error('Invalid title setting');this.state.enabled=enabled;await this.save();if(enabled)await this.refresh();else this.publish({status:'off',error:null});return this.snapshot();}
  start(){if(this.timer)return;void this.refresh();this.timer=setInterval(()=>void this.refresh(),15000);this.timer.unref?.();}
  refresh(){if(this.pending)return this.pending;if(!this.state.enabled||this.closed)return Promise.resolve();this.pending=this.run().catch(()=>this.publish({status:'error',error:'自动标题标注暂不可用，请稍后重试。'})).finally(()=>{this.pending=null;});return this.pending;}
  async run(){
    const candidates=await this.readCandidates(this.directory);if(!candidates.length){this.publish({status:'watching',error:null});return;}
    let config={};try{config=parse(await readFile(path.join(this.directory,'config.toml'),'utf8'));}catch{throw Error('Cannot read provider names');}
    let accounts=[];try{accounts=JSON.parse(await readFile(path.join(this.dataDirectory,'codex-accounts.json'),'utf8')).providers||[];}catch{}
    const labelFor=id=>accounts.find(p=>p.id===id)?.name||config.model_providers?.[id]?.name||id;
    const plans=candidates.map(row=>{const previous=this.state.edits[row.id];const title=previous&&previous.after===row.title?previous.before:row.title;return {...row,baseTitle:title,after:providerTitle(title,row.providerId,labelFor(row.providerId))};}).filter(r=>r.after&&r.after!==r.title);
    if(!plans.length){this.publish({status:'watching',error:null});return;}
    let client;try{
      client=await this.clientFactory();
      for(const plan of plans){
        if(this.closed||!this.state.enabled)break;
        // Recheck authoritative local metadata immediately before the write.
        const current=(await this.readCandidates(this.directory)).find(r=>r.id===plan.id);
        if(!current||current.title!==plan.title||current.providerId!==plan.providerId)continue;
        const response=await client.request('thread/read',{threadId:plan.id,includeTurns:false});
        if(response?.thread?.id!==plan.id||response.thread.modelProvider!==plan.providerId)continue;
        const fresh=(await this.readCandidates(this.directory)).find(r=>r.id===plan.id);
        if(!fresh||fresh.title!==plan.title||fresh.providerId!==plan.providerId)continue;
        // Persist intent first, so an interrupted update can be retried idempotently.
        const record={before:plan.baseTitle,after:plan.after,providerId:plan.providerId,at:this.now()};
        this.state.edits[plan.id]=record;await this.save();
        await client.request('thread/name/set',{threadId:plan.id,name:plan.after});
        this.publish({status:'watching',error:null,updated:this.value.updated+1});
      }
    }finally{await client?.close();}
  }
  async close(){this.closed=true;clearInterval(this.timer);await this.pending;}
}
