import { readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import relay from './attention-hook.cjs';

const CHUNK = 256 * 1024;
const LIVE_FOR = 120_000;
const BUBBLE_FOR = 8000;

// Only a fixed category leaves this function; never display a transcript excerpt.
export function topicCategory(text) {
  if (typeof text !== "string") return null;
  const value = text.slice(0, 8000);
  for (const [pattern, label] of [
    [/修复|报错|调试|bug|debug|error/i, "排查问题"],
    [/代码|编程|实现|功能|code|implement|function/i, "写代码"],
    [/设计|界面|配色|design|layout/i, "做设计"],
    [/分析|数据|统计|分析|analy[sz]|data/i, "分析资料"],
    [/文案|文章|写作|翻译|write|translat/i, "整理文字"],
    [/搜索|查找|调研|research|search/i, "查资料"],
  ]) if (pattern.test(value)) return label;
  return null;
}

export const validThreadId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function activityHeader(line) {
  try {
    const r = JSON.parse(line);
    if (r.type !== 'session_meta' || !r.payload) return {};
    const p = r.payload;
    return {
      threadId: validThreadId(p.id ?? p.session_id) ? (p.id ?? p.session_id).toLowerCase() : null,
      forkAt: (p.forked_from_id || p.parent_thread_id || p.subagent_history_start_ordinal != null) && Number.isFinite(Date.parse(p.timestamp ?? r.timestamp)) ? Date.parse(p.timestamp ?? r.timestamp) : null,
      historyStart: Number.isSafeInteger(p.subagent_history_start_ordinal) && p.subagent_history_start_ordinal >= 0 ? p.subagent_history_start_ordinal : null,
    };
  } catch { return {}; }
}
export class ActivityTracker {
  constructor({ since, topics = false }) {
    this.since = since; this.topics = topics; this.turns = new Map(); this.seen = new Set();
    this.sessions = new Map(); this.uncertain = new Map(); this.outcomes = new Map();
    this.recent = new Map(); this.event = null; this.sequence = 0; this.observation = 0;
    this.questionCalls=new Map();this.attentionEvents=[];
  }
  attentionRecord(line,source,now,historical=false){
    if(!/request_user_input|function_call_output|send_user_message_question_reply|task_complete|turn_aborted/.test(line))return;
    let r;try{r=JSON.parse(line);}catch{return;}
    const p=r.payload,threadId=this.sessions.get(source),at=Date.parse(r.timestamp);
    if(!p||!threadId||!Number.isFinite(at)||(!historical&&at<this.since)||at>now+10000||now-at>(historical?24*60*60_000:LIVE_FOR))return;
    const push=(action,id)=>this.attentionEvents.push({version:1,eventId:`log:${action}:${id||threadId}:${at}`,threadId,at,action,kind:action==='clear'?null:'question',requestId:id||null});
    const key=callId=>relay.requestKey({session_id:threadId,tool_use_id:callId},'question');
    if(r.type==='response_item'&&p.type==='function_call'&&relay.questionTool(p.name)&&typeof p.call_id==='string'&&p.call_id.length<=180){
      let args;try{args=JSON.parse(p.arguments);}catch{return;}
      if(!Array.isArray(args.questions)||!args.questions.length)return;
      const id=key(p.call_id);this.questionCalls.set(`${threadId}:${p.call_id}`,{id,name:p.name});if(this.questionCalls.size>256)this.questionCalls.delete(this.questionCalls.keys().next().value);if(!p.name.endsWith('_async'))push('waiting',id);
    } else if(r.type==='response_item'&&p.type==='function_call_output'){
      const call=this.questionCalls.get(`${threadId}:${p.call_id}`);if(!call)return;
      let output;try{output=typeof p.output==='string'?JSON.parse(p.output):p.output;}catch{output=null;}
      if(call.name.endsWith('_async')){
        if(output?.accepted===true){push('waiting',call.id);return;}
        if(output?.accepted!==false&&!output?.error&&!output?.isError&&!output?.answers)return;
      }
      this.questionCalls.delete(`${threadId}:${p.call_id}`);push('resolved',call.id);
    } else if(r.type==='event_msg'&&p.type==='user_message'&&typeof p.message==='string'){
      const match=/^\s*<send_user_message_question_reply>\s*(\[[\s\S]*\])\s*<\/send_user_message_question_reply>\s*$/.exec(p.message);
      if(!match)return;
      try{for(const reply of JSON.parse(match[1])){
        const parts=JSON.parse(reply.questionItemId);if(!Array.isArray(parts)||!relay.questionTool(parts[0])||typeof parts[1]!=='string')continue;
        this.questionCalls.delete(`${threadId}:${parts[1]}`);push('resolved',key(parts[1]));
      }}catch{}
    } else if(r.type==='event_msg'&&['task_complete','turn_aborted'].includes(p.type)){
      for(const k of this.questionCalls.keys())if(k.startsWith(threadId+':'))this.questionCalls.delete(k);
      push('clear',null);
    }
  }
  takeAttentionEvents(){const events=this.attentionEvents;this.attentionEvents=[];return events;}
  bind(source, threadId, at = this.since) {
    const next=validThreadId(threadId)?threadId.toLowerCase():null;
    if((this.sessions.get(source)||null)!==next) {
      for(const [key,t] of this.turns)if(t.source===source)this.turns.delete(key);
      for(const [key,t] of this.outcomes)if(t.source===source)this.outcomes.delete(key);
      if(this.event?.source===source)this.event=null;
    }
    if(next){this.sessions.set(source,next);if(!this.recent.has(next))this.recent.set(next,{threadId:next,kind:"unknown",at});if(this.recent.size>64){const oldest=[...this.recent.values()].sort((a,b)=>a.at-b.at)[0];this.recent.delete(oldest.threadId);}}else this.sessions.delete(source);
    for(const [key,t] of [...this.uncertain])if(t.source===source){
      this.uncertain.delete(key);this.uncertain.set(next||source,{...t,threadId:next});
    }
  }
  consume(line, source, now) {
    if (!/"type"\s*:\s*"event_msg"/.test(line)) return;
    const userMessage = /"type"\s*:\s*"(?:user_message|UserMessage)"/.test(line);
    if (userMessage && !this.topics) return;
    if (!userMessage && !/"type"\s*:\s*"(?:task_started|task_complete|turn_aborted|token_count)"/.test(line)) return;
    let record; try { record = JSON.parse(line); } catch { return; }
    if (record.type !== 'event_msg') return;
    const p = record.payload, at = Date.parse(record.timestamp);
    if (!p || !Number.isFinite(at) || at < this.since || at > now + 10000 || now - at > LIVE_FOR) return;
    const order=++this.observation;
    const validTurn = typeof p.turn_id === 'string' && p.turn_id.length > 0 && p.turn_id.length <= 180;
    const threadId = this.sessions.get(source) || null, sessionKey = threadId || source;
    const key = `${sessionKey}:${p.turn_id}`;
    if (p.type === 'task_started' && validTurn) {
      if (this.seen.has(key)) return;
      this.seen.add(key); if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
      for (const [id,t] of this.turns) if (t.sessionKey === sessionKey) this.turns.delete(id);
      this.uncertain.delete(sessionKey); this.outcomes.delete(sessionKey);
      this.turns.set(key, {source,sessionKey,threadId,lastSeen:now,order,topic:null});
      if (this.turns.size > 64) this.turns.delete(this.turns.keys().next().value);
      if(threadId)this.recent.set(threadId,{threadId,kind:"running",at:now});
      this.emit('started','开工啦，我陪着你',now,source,threadId);
    } else if (['task_complete','turn_aborted'].includes(p.type) && validTurn) {
      const started = this.turns.delete(key), missingStart = this.uncertain.has(sessionKey);
      if (!started && !missingStart) return;
      this.uncertain.delete(sessionKey);
      const kind = p.type === 'task_complete' ? 'completed' : 'stopped';
      if(threadId)this.recent.set(threadId,{threadId,kind,at:now});
      this.outcomes.set(sessionKey,{kind,at:now,source,threadId,order});
      if (this.outcomes.size > 64) this.outcomes.delete(this.outcomes.keys().next().value);
      // A matching observed start is required for the celebration animation.
      if (started) this.emit(kind,kind==='completed'?'本轮回复结束啦':'这轮已停止，休息一下',now,source,threadId);
    } else {
      let matched = false;
      for (const [turnKey,t] of this.turns) {
        if (t.sessionKey !== sessionKey || (validTurn && key !== turnKey)) continue;
        matched = true; t.lastSeen = now; t.order=order;
        if (this.topics && (p.type==='user_message' || (p.type==='item_completed' && p.item?.type==='UserMessage'))) {
          const message = p.type==='user_message' ? p.message : (Array.isArray(p.item.content) ? p.item.content.slice(0,20).filter(c=>typeof c.text==='string').map(c=>c.text.slice(0,8000)).join('\n').slice(0,8000) : '');
          const topic = topicCategory(message);
          if (topic && topic !== t.topic) { t.topic=topic; this.emit('started',`陪你${topic}`,now,source,threadId); }
        }
      }
      const priorOutcome=this.outcomes.get(sessionKey);
      if (!matched && p.type==='token_count' && (!priorOutcome || now-priorOutcome.at>=LIVE_FOR)) {
        if(validTurn && this.seen.has(key))return;
        for(const [id,t]of this.turns)if(t.sessionKey===sessionKey)this.turns.delete(id);
        this.markUncertain(source,now,threadId);
      }
    }
  }
  markUncertain(source, now, threadId=this.sessions.get(source)||null) {
    if(threadId && this.recent.has(threadId))this.recent.set(threadId,{threadId,kind:"unknown",at:now});
    if(this.event && (this.event.source===source || (threadId && this.event.threadId===threadId)))this.event=null;
    const sessionKey=threadId||source;this.uncertain.set(sessionKey,{source,threadId,lastSeen:now,order:++this.observation});
    if(this.uncertain.size>64)this.uncertain.delete(this.uncertain.keys().next().value);
  }
  emit(kind,text,at,source,threadId) { this.event={id:++this.sequence,kind,text,at,source,threadId}; }
  forget(source, now, gap=false) {
    let removed=false;
    for(const [id,t] of this.turns)if(t.source===source){this.turns.delete(id);removed=true;}
    for(const [id,t] of this.outcomes)if(t.source===source)this.outcomes.delete(id);
    if(this.event?.source===source)this.event=null;
    if(gap||removed)this.markUncertain(source,now);else this.uncertain.delete(this.sessions.get(source)||source);
    const recentId=this.sessions.get(source);if(recentId&&this.recent.has(recentId))this.recent.get(recentId).kind="unknown";
    this.sessions.delete(source);
  }
  snapshot(now) {
    for(const [id,t] of this.turns)if(now-t.lastSeen>2*60*60_000){this.turns.delete(id);this.markUncertain(t.source,now,t.threadId);}
    const fresh=[...this.turns.values()].filter(t=>now-t.lastSeen<LIVE_FOR);
    const stale=[...this.turns.values()].filter(t=>now-t.lastSeen>=LIVE_FOR);
    const unknown=[...this.uncertain.values()];
    const latest=[...this.outcomes.values()].filter(t=>now-t.at<30*60_000).sort((a,b)=>b.at-a.at||b.order-a.order)[0];
    const event=this.event&&now-this.event.at<BUBBLE_FOR ? (({source,...value})=>value)(this.event) : null;
    const focus = event?.threadId ? {...event,kind:event.kind==='started'?'running':event.kind} :
      [...fresh].sort((a,b)=>b.lastSeen-a.lastSeen||b.order-a.order).map(t=>({...t,kind:'running',at:t.lastSeen})).find(t=>t.threadId) ||
      [...stale,...unknown].sort((a,b)=>b.lastSeen-a.lastSeen||b.order-a.order).map(t=>({...t,kind:'unknown',at:t.lastSeen})).find(t=>t.threadId) || latest;
    return {
      status:fresh.length?'running':stale.length+unknown.length?'unknown':latest?.kind||'idle',
      activeCount:fresh.length,uncertainCount:stale.length+unknown.length,
      event,lastOutcome:latest?{kind:latest.kind,at:latest.at}:null,
      recent:[...this.recent.values()].sort((a,b)=>b.at-a.at).slice(0,5).map(r=>({...r,kind:this.turns.size && [...this.turns.values()].some(t=>t.threadId===r.threadId && now-t.lastSeen>=LIVE_FOR)?"unknown":r.kind})),
      target:focus?.threadId?{threadId:focus.threadId,kind:focus.kind,at:focus.at}:null,
    };
  }
}

// Read only appended data in recent session files. No transcript or cursor is persisted.
export class CodexActivity {
  constructor({ onChange, onAttention, now = Date.now }) {
    this.onChange = onChange;
    this.onAttention=onAttention;
    this.now = now;
    this.cursors = new Map();
    this.config = null;
    this.generation = 0;
    this.value = { enabled: false, status: "off", activeCount: 0, event: null };
  }
  snapshot() { return this.value; }
  refreshAttention(){
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.readHistoricalAttention().finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  async readHistoricalAttention(){
    await this.pending;
    if(!this.enabled||!this.tracker||!this.onAttention)return;
    const generation=this.generation,tracker=this.tracker;
    for(const [file,cursor] of this.cursors){
      // Root threads only: an inherited prefix must never create a new request.
      if(!cursor.header?.threadId||cursor.header.forkAt!=null||cursor.header.historyStart!=null)continue;
      try{
        const handle=await open(file,'r');
        try{const info=await handle.stat(),start=Math.max(0,info.size-512*1024),buffer=Buffer.alloc(info.size-start);const {bytesRead}=await handle.read(buffer,0,buffer.length,start);const lines=buffer.subarray(0,bytesRead).toString('utf8').split('\n');if(start)lines.shift();
          for(const line of lines)tracker.attentionRecord(line,file,this.now(),true);
        }finally{await handle.close();}
      }catch{}
    }
    if(generation===this.generation){const events=tracker.takeAttentionEvents().sort((a,b)=>a.at-b.at);if(events.length)await this.onAttention(events);}
  }
  publish(value) {
    if (JSON.stringify(value) === JSON.stringify(this.value)) return;
    this.value = value;
    this.onChange(value);
  }
  async configure({ directory, enabled, topics }) {
    const config = JSON.stringify([directory, !!enabled, !!topics]);
    if (config === this.config) return;
    this.config = config;
    // Theme preferences affect future classification, not the work lifecycle cursor.
    if(this.directory===directory && this.enabled===!!enabled && this.tracker) {
      this.tracker.topics=!!topics;
      if(!topics){for(const t of this.tracker.turns.values())t.topic=null;
        if(this.tracker.event?.kind==='started' && this.tracker.event.text.startsWith('陪你'))this.tracker.event.text='开工啦，我陪着你';}
      this.publish({enabled:this.enabled,...this.tracker.snapshot(this.now())});
      return;
    }
    clearInterval(this.timer);
    const generation = ++this.generation;
    this.publish({enabled:!!enabled,status:enabled?"connecting":"off",activeCount:0,event:null});
    await Promise.all([this.pending,this.refreshing]);
    if (generation !== this.generation) return;
    this.directory = directory;
    this.enabled = !!enabled;
    this.cursors.clear();
    this.inventoryAt = null;
    this.tracker = new ActivityTracker({ since: this.now(), topics });
    this.publish({ enabled: this.enabled, status: enabled ? "connecting" : "off", activeCount: 0, event: null });
    if (!enabled) return;
    await this.poll(true);
    if (generation !== this.generation) return;
    this.timer = setInterval(() => void this.poll(), 2000);
    this.timer.unref?.();
  }
  async files() {
    // Sessions may stay open across midnight. Keep known cursors as well as two calendar days.
    const days = new Set();
    for (const offset of [0, -86400000]) {
      const date = new Date(this.now() + offset);
      days.add([date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("/"));
      days.add(date.toISOString().slice(0, 10).replaceAll("-", "/"));
    }
    const root = path.join(this.directory, "sessions");
    await stat(root);
    const files = new Set(this.cursors.keys());
    // Older sessions can be resumed days later; refresh their metadata too.
    if (this.inventoryAt === null || this.now() - this.inventoryAt >= 15_000) {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      if (entries.length > 30_000) throw new Error("session-inventory-limit");
      for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.add(path.join(entry.parentPath, entry.name));
      this.inventoryAt = this.now();
    }
    for (const day of days) {
      const directory = path.join(this.directory, "sessions", day);
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (e) { if (e.code === "ENOENT") continue; throw e; }
      for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".jsonl")) files.add(path.join(directory, entry.name));
    }
    const found = [], paths = [...files];
    for (let start = 0; start < paths.length; start += 64) {
      found.push(...(await Promise.all(paths.slice(start, start + 64).map(async file => {
        try { return { file, info: await stat(file) }; } catch { return null; }
      }))).filter(Boolean));
    }
    found.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    found.length = Math.min(found.length, 64);
    return found;
  }
  poll(baseline = false) {
    if(this.refreshing)return this.refreshing;
    if (this.pending) return this.pending;
    this.pending = this.read(baseline).finally(() => { this.pending = null; });
    return this.pending;
  }
  async read(baseline) {
    const generation = this.generation;
    try {
      const files = await this.files();
      if (generation !== this.generation) return;
      const present = new Set(files.map(x => x.file));
      for (const file of this.cursors.keys()) if (!present.has(file)) {
        this.cursors.delete(file); this.tracker.forget(file, this.now());
      }
      for (const { file, info } of files) {
        if (generation !== this.generation) return;
        let cursor = this.cursors.get(file);
        if (!cursor || cursor.ino !== info.ino || info.size < cursor.offset) {
          this.tracker.forget(file, this.now());
          const reset = !!cursor;
          cursor = { ino: info.ino, offset: baseline || reset ? info.size : 0, decoder: new StringDecoder("utf8"), pending: "", discard: baseline || reset };
          cursor.ordinal=cursor.offset?null:0;
          const headerHandle=await open(file,'r');
          try {
            const first=Buffer.alloc(Math.min(CHUNK,info.size));
            const {bytesRead}=await headerHandle.read(first,0,first.length,0);
            cursor.header=activityHeader(first.subarray(0,bytesRead).toString('utf8').split('\n')[0]);
            this.tracker.bind(file,cursor.header.threadId,info.mtimeMs);
          } finally {await headerHandle.close();}
          // Starting at EOF may cut a JSON line; discard through its next newline.
          if (cursor.offset) {
            const handle = await open(file, "r");
            try {
              const last = Buffer.alloc(1);
              await handle.read(last, 0, 1, cursor.offset - 1);
              cursor.discard = last[0] !== 10;
            } finally { await handle.close(); }
          } else cursor.discard = false;
          this.cursors.set(file, cursor);
        }
        if (info.size === cursor.offset) continue;
        if (info.size - cursor.offset > 4 * CHUNK) {
          cursor.offset = info.size - CHUNK;
          cursor.pending = ""; cursor.discard = true; cursor.decoder = new StringDecoder("utf8");
          this.tracker.forget(file, this.now(), true); this.tracker.bind(file,cursor.header?.threadId); cursor.ordinal=null; // Unknown gap must not produce a success animation.
        }
        const handle = await open(file, "r");
        let content;
        try {
          const buffer = Buffer.alloc(Math.min(CHUNK, info.size - cursor.offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor.offset);
          cursor.offset += bytesRead;
          content = cursor.decoder.write(buffer.subarray(0, bytesRead));
        } finally { await handle.close(); }
        if (generation !== this.generation) return;
        for (const part of content.split(/(?<=\n)/)) {
          const ended = part.endsWith("\n");
          if (!cursor.discard) {
            cursor.pending += part;
            if (cursor.pending.length > CHUNK) { cursor.pending = ""; cursor.discard = true; }
          }
          if (ended) {
            if (!cursor.discard) {
              if(cursor.ordinal===0){cursor.header=activityHeader(cursor.pending);this.tracker.bind(file,cursor.header.threadId,info.mtimeMs);}
              const recordAt=cursor.header?.forkAt!=null?Date.parse(/"timestamp"\s*:\s*"([^"]+)"/.exec(cursor.pending)?.[1]):null;
              const inheritedByTime=cursor.header?.forkAt!=null && Number.isFinite(recordAt) && recordAt<cursor.header.forkAt;
              if(!inheritedByTime && (cursor.ordinal===null || cursor.header?.historyStart==null || cursor.ordinal>=cursor.header.historyStart)) {
                this.tracker.attentionRecord(cursor.pending,file,this.now());this.tracker.consume(cursor.pending,file,this.now());
              }
            }
            if(cursor.ordinal!==null)cursor.ordinal++;
            cursor.pending = ""; cursor.discard = false;
          }
        }
      }
      if (generation === this.generation){const events=this.tracker.takeAttentionEvents();if(events.length)await this.onAttention?.(events);this.publish({ enabled: true, ...this.tracker.snapshot(this.now()) });}
    } catch {
      if (generation === this.generation) this.publish({ enabled: true, status: "unavailable", activeCount: 0, event: null });
    }
  }
  async close() {
    ++this.generation;
    clearInterval(this.timer);
    await Promise.all([this.pending,this.refreshing]);
    this.cursors.clear();
  }
}
