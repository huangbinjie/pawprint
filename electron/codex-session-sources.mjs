import path from 'node:path';
import {stat} from 'node:fs/promises';
import {validWorkId} from '../core/work.mjs';
import {cleanWorkLabel,readWorkTitles} from './work-titles.mjs';

// Metadata only. A recorded provider is not evidence of a completed API request.
export async function readCodexSessionSources(directory) {
  let db;
  try {
    const file=path.join(directory,'state_5.sqlite');await stat(file);
    const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true});
    const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
    if(!['id','model_provider','updated_at'].every(c=>columns.has(c)))return {status:'unavailable',items:[]};
    const filters=[columns.has('archived')?'archived=0':'1',columns.has('source')?"(source IS NULL OR (lower(source) NOT LIKE '%subagent%' AND lower(source) NOT LIKE '%remote%' AND lower(source) NOT LIKE '%cloud%'))":'1'];
    const rows=db.prepare(`SELECT id,model_provider,${columns.has('model')?'model':'NULL AS model'} FROM threads WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT 8`).all().filter(r=>validWorkId(r.id));
    const titles=new Map((await readWorkTitles(directory,rows.map(r=>r.id))).map(r=>[r.threadId,r.title]));
    return {status:'available',items:rows.map(r=>({id:r.id,title:titles.get(r.id)||null,providerId:cleanWorkLabel(r.model_provider,160)||null,model:cleanWorkLabel(r.model,160)||null,requestVerified:false}))};
  }catch{return {status:'unavailable',items:[]};}finally{db?.close();}
}
