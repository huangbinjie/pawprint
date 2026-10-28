import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { validWorkId } from "../core/work.mjs";
import { cleanWorkLabel } from "./work-titles.mjs";

const MAX_RESULTS = 5000;
const MAX_MUTATIONS = 200;

function safeQuery(value) {
  return typeof value === "string" ? value.trim().slice(0, 120).toLocaleLowerCase() : "";
}

function projectName(cwd) {
  if (typeof cwd !== "string" || !cwd) return "";
  return cleanWorkLabel(cwd.includes("\\") ? path.win32.basename(cwd) : path.basename(cwd), 80);
}

function sessionRow(row, now) {
  // The raw title/preview columns can contain the initial prompt. Only the
  // explicit thread name is safe to render in the manager.
  const title = cleanWorkLabel(row.name, 240);
  const project = projectName(row.cwd);
  const at = Number(row.recency_at_ms ?? row.updated_at_ms ?? Number(row.updated_at) * 1000);
  return {
    id: row.id,
    title,
    project,
    at: Number.isFinite(at) ? at : now,
    archived: row.archived === 1,
    provider: cleanWorkLabel(row.model_provider, 80),
    model: cleanWorkLabel(row.model, 120),
    rolloutPath: typeof row.rollout_path === "string" ? row.rollout_path : null,
  };
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function fuzzyScore(query, row) {
  const text = [row.title, row.name, row.cwd, row.preview, row.first_user_message, row.id].filter(Boolean).join(" ").toLocaleLowerCase();
  const terms = query.match(/[\p{L}\p{N}]+/gu) || [query];
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  let score = text.includes(query) ? 1000 : 0;
  for (const term of terms) {
    if (text.includes(term)) { score += 100; continue; }
    const threshold = Math.max(1, Math.floor(term.length * 0.34));
    let best = Infinity;
    for (const word of words) {
      if (word.startsWith(term)) { best = 0; break; }
      if (Math.abs(word.length - term.length) <= threshold) best = Math.min(best, editDistance(term, word));
    }
    if (best > threshold) return null;
    score += 40 - best * 8;
  }
  return score;
}

function eligibleSource(columns) {
  const parts = [];
  if (columns.has("source")) parts.push("(source IS NULL OR (lower(source) NOT LIKE '%subagent%' AND lower(source) NOT LIKE '%remote%' AND lower(source) NOT LIKE '%cloud%'))");
  if (columns.has("thread_source")) parts.push("(thread_source IS NULL OR lower(thread_source) NOT LIKE '%subagent%')");
  return parts.join(" AND ") || "1";
}

export async function searchSessions(directory, { query = "", includeArchived = true } = {}) {
  const file = path.join(directory, "state_5.sqlite");
  await stat(file);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map(row => row.name));
    if (!columns.has("id")) throw new Error("会话数据库缺少线程表。");
    const title = columns.has("title") ? "title" : "NULL";
    const preview = columns.has("preview") ? "preview" : "NULL";
    const firstMessage = columns.has("first_user_message") ? "first_user_message" : "NULL";
    const name = columns.has("name") ? "name" : "NULL";
    const cwd = columns.has("cwd") ? "cwd" : "NULL";
    const provider = columns.has("model_provider") ? "model_provider" : "NULL";
    const model = columns.has("model") ? "model" : "NULL";
    const rollout = columns.has("rollout_path") ? "rollout_path" : "NULL";
    const at = columns.has("recency_at_ms") && columns.has("updated_at_ms")
      ? "COALESCE(recency_at_ms, updated_at_ms, updated_at * 1000)"
      : columns.has("updated_at_ms") ? "updated_at_ms" : "updated_at * 1000";
    const where = [eligibleSource(columns)];
    if (columns.has("archived") && !includeArchived) where.push("archived = 0");
    const text = safeQuery(query);
    const rows = db.prepare(`SELECT id,${title} AS title,${name} AS name,${cwd} AS cwd,${preview} AS preview,${firstMessage} AS first_user_message,${provider} AS model_provider,${model} AS model,${rollout} AS rollout_path,${at} AS recency_at_ms,${columns.has("archived") ? "archived" : "0"} AS archived FROM threads WHERE ${where.join(" AND ")} ORDER BY recency_at_ms DESC LIMIT ?`).all(MAX_RESULTS);
    const valid = rows.filter(row => validWorkId(row.id));
    if (!text) return valid.map(row => sessionRow(row, Date.now()));
    return valid.map(row => ({ row, score: fuzzyScore(text, row) })).filter(result => result.score !== null).sort((a, b) => b.score - a.score || b.row.recency_at_ms - a.row.recency_at_ms).map(result => sessionRow(result.row, Date.now()));
  } finally {
    db.close();
  }
}

function safeRolloutPath(directory, value) {
  if (typeof value !== "string" || !value) return null;
  const root = path.resolve(directory);
  const file = path.resolve(value);
  const sessions = `${path.join(root, "sessions")}${path.sep}`;
  const archived = `${path.join(root, "archived_sessions")}${path.sep}`;
  return file.startsWith(sessions) || file.startsWith(archived) ? file : null;
}

async function removeRollout(directory, rolloutPath) {
  const file = safeRolloutPath(directory, rolloutPath);
  if (!file) return;
  for (const candidate of [file, file.endsWith(".zst") ? file.slice(0, -4) : `${file}.zst`]) {
    try { await unlink(candidate); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function mutateSessions(directory, action, ids) {
  if (!['archive', 'unarchive', 'delete'].includes(action)) throw new Error("不支持的会话操作。");
  const selected = [...new Set((Array.isArray(ids) ? ids : []).filter(validWorkId))].slice(0, MAX_MUTATIONS);
  if (!selected.length) return { count: 0 };
  const file = path.join(directory, "state_5.sqlite");
  await stat(file);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  const placeholders = selected.map(() => "?").join(",");
  const paths = [];
  try {
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map(row => row.name));
    if (!columns.has("archived")) throw new Error("当前 Codex 版本不支持归档会话。");
    if (action === "delete" && columns.has("rollout_path")) {
      paths.push(...db.prepare(`SELECT rollout_path FROM threads WHERE id IN (${placeholders})`).all(...selected).map(row => row.rollout_path));
    }
    db.exec("BEGIN IMMEDIATE");
    if (action === "delete") db.prepare(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...selected);
    else if (columns.has("archived_at")) db.prepare(`UPDATE threads SET archived = ?, archived_at = ? WHERE id IN (${placeholders})`).run(action === "archive" ? 1 : 0, action === "archive" ? Date.now() : null, ...selected);
    else db.prepare(`UPDATE threads SET archived = ? WHERE id IN (${placeholders})`).run(action === "archive" ? 1 : 0, ...selected);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
  if (action === "delete") for (const rolloutPath of paths) await removeRollout(directory, rolloutPath);
  return { count: selected.length };
}
