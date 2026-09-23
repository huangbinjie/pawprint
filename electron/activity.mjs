import { readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

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

export class ActivityTracker {
  constructor({ since, topics = false }) {
    this.since = since;
    this.topics = topics;
    this.turns = new Map();
    this.seen = new Set();
    this.event = null;
    this.sequence = 0;
  }
  consume(line, source, now) {
    // Skip response bodies and tool outputs before parsing. Topic classification is opt-in.
    if (!/"type"\s*:\s*"event_msg"/.test(line)) return;
    const userMessage = /"type"\s*:\s*"(?:user_message|UserMessage)"/.test(line);
    if (userMessage && !this.topics) return;
    if (!userMessage && !/"type"\s*:\s*"(?:task_started|task_complete|turn_aborted|token_count)"/.test(line)) return;
    let record;
    try { record = JSON.parse(line); } catch { return; }
    if (record.type !== "event_msg") return;
    const p = record.payload;
    const at = Date.parse(record.timestamp);
    if (!p || !Number.isFinite(at) || at < this.since || at > now + 10_000 || now - at > LIVE_FOR) return;
    const validTurn = typeof p.turn_id === "string" && p.turn_id.length <= 180;
    const key = `${source}:${p.turn_id}`;
    if (p.type === "task_started" && validTurn) {
      if (this.seen.has(key)) return;
      this.seen.add(key);
      if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
      // One active turn per session. A fresh start supersedes a missing old end.
      for (const [id, t] of this.turns) if (t.source === source) this.turns.delete(id);
      this.turns.set(key, { source, lastSeen: now, topic: null });
      if (this.turns.size > 64) this.turns.delete(this.turns.keys().next().value);
      this.emit("started", "开工啦，我陪着你", now);
    } else if (["task_complete", "turn_aborted"].includes(p.type) && validTurn) {
      if (!this.turns.delete(key)) return; // No replayed history or duplicate completion.
      this.emit(p.type === "task_complete" ? "completed" : "stopped",
        p.type === "task_complete" ? "本轮回复结束啦" : "这轮已停止，休息一下", now);
    } else {
      for (const [turnKey, t] of this.turns) {
        if (t.source !== source || (validTurn && key !== turnKey)) continue;
        t.lastSeen = now;
        if (this.topics && (p.type === "user_message" || (p.type === "item_completed" && p.item?.type === "UserMessage"))) {
          const message = p.type === "user_message" ? p.message :
            (Array.isArray(p.item.content) ? p.item.content.slice(0, 20).filter(c => typeof c.text === "string").map(c => c.text.slice(0, 8000)).join("\n").slice(0, 8000) : "");
          const topic = topicCategory(message);
          if (topic && topic !== t.topic) {
            t.topic = topic;
            this.emit("started", `陪你${topic}`, now);
          }
        }
      }
    }
  }
  emit(kind, text, at) { this.event = { id: ++this.sequence, kind, text, at }; }
  forget(source) {
    for (const [id, t] of this.turns) if (t.source === source) this.turns.delete(id);
  }
  snapshot(now) {
    for (const [id, t] of this.turns) if (now - t.lastSeen > 2 * 60 * 60_000) this.turns.delete(id);
    const activeCount = [...this.turns.values()].filter(t => now - t.lastSeen < LIVE_FOR).length;
    return {
      status: activeCount ? "running" : this.turns.size ? "unknown" : "idle",
      activeCount,
      event: this.event && now - this.event.at < BUBBLE_FOR ? this.event : null,
    };
  }
}

// Read only appended data in recent session files. No transcript or cursor is persisted.
export class CodexActivity {
  constructor({ onChange, now = Date.now }) {
    this.onChange = onChange;
    this.now = now;
    this.cursors = new Map();
    this.config = null;
    this.generation = 0;
    this.value = { enabled: false, status: "off", activeCount: 0, event: null };
  }
  snapshot() { return this.value; }
  publish(value) {
    if (JSON.stringify(value) === JSON.stringify(this.value)) return;
    this.value = value;
    this.onChange(value);
  }
  async configure({ directory, enabled, topics }) {
    const config = JSON.stringify([directory, !!enabled, !!topics]);
    if (config === this.config) return;
    this.config = config;
    clearInterval(this.timer);
    const generation = ++this.generation;
    await this.pending;
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
        this.cursors.delete(file); this.tracker.forget(file);
      }
      for (const { file, info } of files) {
        if (generation !== this.generation) return;
        let cursor = this.cursors.get(file);
        if (!cursor || cursor.ino !== info.ino || info.size < cursor.offset) {
          this.tracker.forget(file);
          const reset = !!cursor;
          cursor = { ino: info.ino, offset: baseline || reset ? info.size : 0, decoder: new StringDecoder("utf8"), pending: "", discard: baseline || reset };
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
          this.tracker.forget(file); // Unknown gap must not produce a success animation.
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
            if (!cursor.discard) this.tracker.consume(cursor.pending, file, this.now());
            cursor.pending = ""; cursor.discard = false;
          }
        }
      }
      if (generation === this.generation) this.publish({ enabled: true, ...this.tracker.snapshot(this.now()) });
    } catch {
      if (generation === this.generation) this.publish({ enabled: true, status: "unavailable", activeCount: 0, event: null });
    }
  }
  async close() {
    ++this.generation;
    clearInterval(this.timer);
    await this.pending;
    this.cursors.clear();
  }
}
