import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {readFileSync} from 'node:fs';
const bundled=JSON.parse(readFileSync(new URL('../../core/model-catalog.json',import.meta.url),'utf8'));
export const CATALOG_URL='https://raw.githubusercontent.com/huangbinjie/pawprint/main/core/model-catalog.json';
export function validateCatalog(value){
 if(value?.schemaVersion!==1||typeof value.revision!=='string'||value.revision.length>40||!Array.isArray(value.models)||!value.models.length||value.models.length>40)throw new Error('模型目录格式无效。');
 const ids=new Set();
 for(const m of value.models){
  if(typeof m.id!=='string'||!/^[a-z0-9][a-z0-9._/-]*:[a-z0-9._-]+$/.test(m.id)||m.id.length>100||m.id.includes('..')||ids.has(m.id)||typeof m.name!=='string'||m.name.length>80||!Number.isFinite(m.sizeGB)||m.sizeGB<=0||m.sizeGB>100||!Number.isInteger(m.minMemoryGB)||m.minMemoryGB<2||m.minMemoryGB>256||!Number.isInteger(m.memoryGB)||m.memoryGB<m.minMemoryGB||!Array.isArray(m.languages)||!m.languages.length||!m.languages.every(l=>['zh','en'].includes(l))||!Array.isArray(m.roles)||!m.roles.every(r=>['light','balanced','quality'].includes(r))||m.supportsTools!==true||![2048,4096,8192].includes(m.contextTokens))throw new Error('模型目录包含无效条目。');
  if(m.languagePriority && (!Object.keys(m.languagePriority).every(k=>['zh','en'].includes(k)) || !Object.values(m.languagePriority).every(v=>Number.isInteger(v)&&v>=0&&v<=100)))throw new Error('模型目录语言权重无效。');
  ids.add(m.id);
 }
 if(!['light','balanced','quality'].every(role=>value.models.some(m=>m.roles.includes(role))))throw new Error('模型目录缺少推荐档位。');
 return value;
}
validateCatalog(bundled);
export const MODEL_CATALOG=bundled.models;
export function recommendModels(models,{memoryGB,language='zh',accelerated=true}){
 const select=role=>{
  const candidates=models.filter(m=>m.roles.includes(role)&&m.languages.includes(language));
  if(role!=='balanced')return candidates[0];
  const fitting=candidates.filter(m=>m.memoryGB<=(accelerated?memoryGB:Math.min(memoryGB,16)));
  return (fitting.length?fitting:candidates).sort((a,b)=>fitting.length?((b.languagePriority?.[language]||0)-(a.languagePriority?.[language]||0))||b.memoryGB-a.memoryGB:a.minMemoryGB-b.minMemoryGB)[0];
 };
 return ['light','balanced','quality'].map(tier=>{const m=select(tier);return m?{...m,tier,compatible:memoryGB>=m.minMemoryGB}:null;}).filter(Boolean);
}
export class ModelCatalog{
 constructor({directory,fetcher=fetch,remote=true}={}){this.directory=directory;this.fetcher=fetcher;this.remote=remote;this.value=bundled;this.source='bundled';this.lastCheck=0;}
 async refresh(force=false){
  if(this.directory&&this.source==='bundled'){try{this.value=validateCatalog(JSON.parse(await readFile(path.join(this.directory,'model-catalog.json'),'utf8')));this.source='cache';}catch{}}
  if(!this.remote||(!force&&Date.now()-this.lastCheck<3600000))return this.value;this.lastCheck=Date.now();
  try{
   const r=await this.fetcher(CATALOG_URL,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});if(!r.ok)throw Error('Unavailable');
   const text=await r.text();if(text.length>65536)throw Error('Too large');const value=validateCatalog(JSON.parse(text));
   if(this.directory){await mkdir(this.directory,{recursive:true});const target=path.join(this.directory,'model-catalog.json');await writeFile(target+'.tmp',JSON.stringify(value),{mode:0o600});await rename(target+'.tmp',target);}
   this.value=value;this.source='github';
  }catch{}
  return this.value;
 }
}
