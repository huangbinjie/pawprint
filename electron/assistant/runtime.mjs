import {readFile,access,mkdir,mkdtemp,rename,rm,stat,readdir} from 'node:fs/promises';
import {createWriteStream,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {Transform,Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
const run=promisify(execFile),manifest=JSON.parse(readFileSync(new URL('../../core/ollama-runtime.json',import.meta.url),'utf8'));
export class ManagedRuntime{
 constructor({directory,fetcher=fetch,platform=process.platform,arch=process.arch,extract}={}){Object.assign(this,{directory,fetcher,platform,arch,extract});this.asset=manifest.assets[platform+'-'+arch];this.root=path.join(directory,'runtime',manifest.version);}
 async find(){if(!this.asset)return null;const exe=path.join(this.root,this.asset.executable);try{await access(exe);return exe;}catch{return null;}}
 async ensure(signal,onProgress){
  const existing=await this.find();if(existing)return existing;if(!this.asset)throw Error('这台设备暂不支持自动准备本地引擎。');
  await mkdir(path.dirname(this.root),{recursive:true});const stage=await mkdtemp(path.join(path.dirname(this.root),'prepare-'));const archive=path.join(stage,'runtime.'+this.asset.format),out=path.join(stage,'files');
  try{
   const response=await this.fetcher(this.asset.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30*60000)]),redirect:'follow'});if(!response.ok||!response.body)throw Error('本地引擎下载失败，请重试。');
   const hash=createHash('sha256');let loaded=0,last=0;
   const meter=new Transform({transform:(chunk,_,done)=>{loaded+=chunk.length;if(loaded>this.asset.bytes)return done(Error('本地引擎大小不匹配。'));hash.update(chunk);if(Date.now()-last>200||loaded===this.asset.bytes){last=Date.now();onProgress({kind:'runtime',completed:loaded,total:this.asset.bytes,status:'正在准备本地引擎…'});}done(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(archive));if(loaded!==this.asset.bytes||hash.digest('hex')!==this.asset.sha256)throw Error('本地引擎校验失败。');if(signal.aborted)throw signal.reason;
   await mkdir(out);onProgress({kind:'runtime',completed:loaded,total:this.asset.bytes,status:'正在解压本地引擎…'});
   if(this.extract)await this.extract(archive,out,signal);
   else if(this.platform==='win32'){const script="Expand-Archive -LiteralPath $env:PAW_RUNTIME_ARCHIVE -DestinationPath $env:PAW_RUNTIME_DEST -Force";await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{signal,env:{...process.env,PAW_RUNTIME_ARCHIVE:archive,PAW_RUNTIME_DEST:out},windowsHide:true,timeout:180000});}
   else if(this.asset.format==='zip')await run('/usr/bin/ditto',['-x','-k',archive,out],{signal,timeout:180000});
   else await run('/usr/bin/tar',['-xzf',archive,'-C',out],{signal,timeout:180000});
   await access(path.join(out,this.asset.executable));if(signal.aborted)throw signal.reason;await rename(out,this.root);return path.join(this.root,this.asset.executable);
  }finally{await rm(stage,{recursive:true,force:true});}
 }
 async installed(){
  const root=path.join(this.directory,'models','manifests','registry.ollama.ai');const models=[];
  const walk=async(dir,parts)=>{let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
   for(const e of entries){if(models.length>=200)return;const full=path.join(dir,e.name);if(e.isDirectory()&&parts.length<4)await walk(full,[...parts,e.name]);else if(e.isFile()&&parts.length>=2){try{if((await stat(full)).size>1048576)continue;const m=JSON.parse(await readFile(full,'utf8'));const prefix=parts[0]==='library'?parts.slice(1):parts;models.push({name:prefix.join('/')+':'+e.name,size:(m.layers||[]).reduce((n,l)=>n+(l.size||0),0)+(m.config?.size||0)});}catch{}}}
  };await walk(root,[]);return models;
 }
 async start(binary,baseURL){
  const models=path.join(this.directory,'models');await mkdir(models,{recursive:true});
  return new Promise((resolve,reject)=>{const child=spawn(binary,['serve'],{stdio:'ignore',windowsHide:true,env:{...process.env,OLLAMA_HOST:new URL(baseURL).host,OLLAMA_MODELS:models,OLLAMA_CONTEXT_LENGTH:'4096',OLLAMA_KEEP_ALIVE:'2m',OLLAMA_NUM_PARALLEL:'1'}});child.once('error',reject);child.once('spawn',()=>{this.child=child;child.unref();resolve();});});
 }
 close(){this.child?.kill();this.child=null;}
}
