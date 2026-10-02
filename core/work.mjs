export const validWorkId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function workState(state, now=Date.now()){const w=state.work || {version:1,recent:[],pinned:null};return {...w,recent:w.recent.map(r=>({...r,kind:r.kind==='running'&&now-r.at>=120000?'unknown':r.kind}))};}
export function workTarget(state,activity) {
  const w=workState(state),pinned=w.recent.find(r=>r.threadId===w.pinned);
  const target=pinned || activity?.target || w.recent[0];
  return target ? {...w.recent.find(r=>r.threadId===target.threadId),...target} : null;
}
export function attentionTarget(state){
  return workState(state).recent.filter(r=>r.attention).sort((a,b)=>Number(a.attention.seen)-Number(b.attention.seen)||b.attention.at-a.attention.at)[0] || null;
}
function boundWorkRows(w){
  const candidates=w.recent.filter((r,i)=>i<5||r.threadId===w.pinned||r.attention);
  candidates.sort((a,b)=>Number(b.threadId===w.pinned)-Number(a.threadId===w.pinned)||Number(!!b.attention)-Number(!!a.attention)||b.at-a.at);
  w.recent=candidates.slice(0,64).sort((a,b)=>b.at-a.at);
}
export function workTransition(state,command,{now}) {
  const w=structuredClone(workState(state));
  if(command.type==='_work-attention') {
    for(const event of command.events || []){
      if(!validWorkId(event.threadId)||!Number.isFinite(event.at))continue;
      let row=w.recent.find(r=>r.threadId===event.threadId);
      if(event.action==='waiting'&&['approval','question'].includes(event.kind)&&/^[a-f0-9]{64}$/.test(event.requestId||'')){
        if(!row){row={threadId:event.threadId,at:event.at,kind:'unknown',bookmark:'',unread:false};w.recent.unshift(row);}
        const pending=row.attentions || (row.attention?[row.attention]:[]);
        if(pending.some(a=>a.id===event.requestId))continue;
        row.attentions=[...pending,{kind:event.kind,id:event.requestId,at:event.at,seen:false}].slice(-16);
        row.at=Math.max(row.at,event.at);
      } else if(row?.attention){
        row.attentions=(row.attentions || [row.attention]).filter(a=>!(event.at>=a.at&&(event.action==='clear'||event.requestId===a.id)));
      }
      if(row?.attentions?.length)row.attention=[...row.attentions].sort((a,b)=>Number(a.seen)-Number(b.seen)||b.at-a.at)[0];
      else if(row){delete row.attention;delete row.attentions;}
    }
    w.recent.sort((a,b)=>b.at-a.at);
    boundWorkRows(w);
  } else if(command.type==='attention-settings') {
    if(typeof command.enabled!=='boolean')throw new Error('Choose a valid attention reminder setting.');
    state.settings.attentionEnabled=command.enabled;
    if(!command.enabled)for(const row of w.recent){delete row.attention;delete row.attentions;}
  } else if(command.type==='_work-metadata') {
    for(const metadata of command.rows || []) {
      const row=w.recent.find(r=>r.threadId===metadata.threadId);
      if(!row)continue;
      for(const [key,limit] of [['title',240],['project',60]]) {
        if(typeof metadata[key]==='string' && metadata[key].trim() && [...metadata[key]].length<=limit && !/[\u0000-\u001f]/.test(metadata[key]))row[key]=metadata[key];
      }
    }
  } else if(command.type==='_work-observe') {
    for(const row of command.recent || []) {
      if(!validWorkId(row.threadId)||!Number.isFinite(row.at))continue;
      const existing=w.recent.find(r=>r.threadId===row.threadId);
      if(existing){existing.at=Math.max(row.at,existing.at);existing.kind=row.kind;}
      else w.recent.push({threadId:row.threadId,at:row.at,kind:row.kind,bookmark:'',unread:false});
    }
    if(command.completed && validWorkId(command.completed.threadId)) {
      const row=w.recent.find(r=>r.threadId===command.completed.threadId);
      if(row){row.unread=true;row.completedAt=now;}
    }
    w.recent.sort((a,b)=>b.at-a.at);
    // Keep the pinned conversation even if five newer conversations arrive.
    boundWorkRows(w);
  } else if(command.type==='work-settings') {
    if(!['quiet','sound','system'].includes(command.reminder)||typeof command.dnd!=='boolean')throw new Error('Choose valid work reminder settings.');
    state.settings.workReminder=command.reminder;state.settings.workDnd=command.dnd;
  } else {
    const row=w.recent.find(r=>r.threadId===command.threadId);
    if(command.type==='work-pin'&&command.threadId===null)w.pinned=null;
    else {
      if(!row || !validWorkId(command.threadId))throw new Error('This conversation is no longer in your recent list.');
      if(command.type==='work-pin')w.pinned=row.threadId;
      if(command.type==='work-read'){row.unread=false;if(row.attention){row.attention.seen=true;for(const a of row.attentions||[])a.seen=true;}}
      if(command.type==='work-bookmark'){
        if(typeof command.text!=='string'||[...command.text].length>160||/[\u0000-\u001f]/.test(command.text))throw new Error('Keep your bookmark to 160 visible characters.');
        row.bookmark=command.text.trim();
      }
    }
  }
  state.work=w;return state;
}
export function validWorkState(w) {
  return w===undefined || (w?.version===1&&Array.isArray(w.recent)&&w.recent.length<=64&&new Set(w.recent.map(r=>r.threadId)).size===w.recent.length&&w.recent.every(r=>validWorkId(r.threadId)&&Number.isFinite(r.at)&&['running','unknown','completed','stopped'].includes(r.kind)&&typeof r.bookmark==='string'&&[...r.bookmark].length<=160&&!/[\u0000-\u001f]/.test(r.bookmark)&&typeof r.unread==='boolean'&&(r.completedAt===undefined||Number.isFinite(r.completedAt))&&(r.attentions===undefined||(Array.isArray(r.attentions)&&r.attentions.length<=16&&new Set(r.attentions.map(a=>a.id)).size===r.attentions.length&&r.attentions.every(a=>['approval','question'].includes(a.kind)&&/^[a-f0-9]{64}$/.test(a.id)&&Number.isFinite(a.at)&&typeof a.seen==='boolean')&&r.attentions.some(a=>a.id===r.attention?.id)))&&(r.attention===undefined||(['approval','question'].includes(r.attention.kind)&&/^[a-f0-9]{64}$/.test(r.attention.id)&&Number.isFinite(r.attention.at)&&typeof r.attention.seen==='boolean'))&&[['title',240],['project',60]].every(([key,limit])=>r[key]===undefined||(typeof r[key]==='string'&&[...r[key]].length<=limit&&!/[\u0000-\u001f]/.test(r[key]))))&&(w.pinned===null||w.recent.some(r=>r.threadId===w.pinned)));
}
