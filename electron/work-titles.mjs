import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validWorkId } from '../core/work.mjs';

export const cleanWorkLabel = (value, limit = 240) => typeof value === 'string'
  ? [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('')
  : '';

export async function readRecentWorkChats(directory,now=Date.now()){
  let db;
  try{
    const file=path.join(directory,'state_5.sqlite');await stat(file);
    const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true});
    const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
    if(!columns.has('updated_at'))throw new Error('Older metadata schema');
    const order=columns.has('recency_at_ms')&&columns.has('updated_at_ms')?'COALESCE(recency_at_ms,updated_at_ms,updated_at*1000)':'updated_at*1000';
    const where=[columns.has('archived')?'archived=0':'1',columns.has('source')?"(source IS NULL OR source NOT LIKE '%subagent%')":'1'];
    return db.prepare(`SELECT id,${order} AS at FROM threads WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT 5`).all()
      .filter(r=>validWorkId(r.id)&&Number.isFinite(r.at)&&r.at<=now+10000)
      .map(r=>({threadId:r.id,at:r.at,kind:'unknown'}));
  }catch{
    // Older clients still keep an explicit title index. Never derive a title or
    // a work outcome from message content or replay old completion events.
    try{
      const file=await open(path.join(directory,'session_index.jsonl'),'r');
      try{
        const info=await file.stat(),start=Math.max(0,info.size-1024*1024),buffer=Buffer.alloc(info.size-start);
        const {bytesRead}=await file.read(buffer,0,buffer.length,start);const lines=buffer.subarray(0,bytesRead).toString('utf8').split('\n');if(start)lines.shift();
        const rows=new Map();for(const line of lines){try{const r=JSON.parse(line),at=Date.parse(r.updated_at);if(validWorkId(r.id)&&cleanWorkLabel(r.thread_name)&&Number.isFinite(at)&&at<=now+10000)rows.set(r.id,{threadId:r.id,at,kind:'unknown'});}catch{}}
        return [...rows.values()].sort((a,b)=>b.at-a.at).slice(0,5);
      }finally{await file.close();}
    }catch{return [];}
  }finally{db?.close();}
}

// Only explicit title metadata is selected. Never fall back to first_user_message,
// previews, or the raw `title` column (which can contain a whole initial prompt).
export async function readWorkTitles(directory, threadIds) {
  const ids = [...new Set(threadIds.filter(validWorkId))].slice(0, 64);
  const result = new Map(ids.map(id => [id, { threadId: id }]));
  if (!ids.length) return [];
  try {
    const file = await open(path.join(directory, 'session_index.jsonl'), 'r');
    try {
      const info = await file.stat();
      const start = Math.max(0, info.size - 1024 * 1024);
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      if (start) lines.shift();
      for (const line of lines) {
        try {
          const row = JSON.parse(line), target = result.get(row.id);
          const title = cleanWorkLabel(row.thread_name);
          if (target && title) target.title = title;
        } catch { /* A partial or invalid index row is not a conversation. */ }
      }
    } finally { await file.close(); }
  } catch { /* The index is optional, including for older Codex versions. */ }
  let db;
  try {
    const file = path.join(directory, 'state_5.sqlite');
    await stat(file);
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare(`SELECT id, name, cwd FROM threads WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    let labels = {};
    try {
      const file = path.join(directory, '.codex-global-state.json');
      if ((await stat(file)).size <= 2 * 1024 * 1024)
        labels = JSON.parse(await readFile(file, 'utf8'))['electron-workspace-root-labels'] || {};
    } catch { /* A folder name is enough when the project label is unavailable. */ }
    for (const row of rows) {
      const target = result.get(row.id), title = cleanWorkLabel(row.name);
      if (title) target.title = title;
      if (typeof row.cwd === 'string') {
        const basename = row.cwd.includes('\\') ? path.win32.basename(row.cwd) : path.basename(row.cwd);
        target.project = cleanWorkLabel(labels[row.cwd] || basename, 60);
      }
    }
  } catch { /* Missing, busy or unsupported databases retain the index titles. */ }
  finally { db?.close(); }
  return [...result.values()].filter(row => row.title || row.project);
}
