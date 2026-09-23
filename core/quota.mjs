export const QUOTA_WINDOWS = ["weekly", "session", "both"];
export const QUOTA_STALE_MS = 15 * 60_000;
export function parseQuotaLine(line, now = Date.now()) {
  if (!/"type"\s*:\s*"token_count"/.test(line)) return null;
  let r; try { r = JSON.parse(line); } catch { return null; }
  if (r.type !== "event_msg" || r.payload?.type !== "token_count") return null;
  const at = Date.parse(r.timestamp), q = r.payload.rate_limits;
  if (!Number.isFinite(at) || at > now + 60_000 || at < now - 2 * 86400000 ||
    !q || Array.isArray(q) || (q.limit_id ?? "codex") !== "codex") return null;
  const windows = {};
  for (const w of [q.primary, q.secondary]) {
    if (!w || !Number.isFinite(w.used_percent) || w.used_percent < 0 ||
      !Number.isSafeInteger(w.resets_at) || w.resets_at <= 0) continue;
    const key = w.window_minutes === 10080 ? "weekly" : w.window_minutes === 300 ? "session" : null;
    if (!key) continue;
    if (w.resets_at * 1000 > at + w.window_minutes * 60000 + 300000) continue;
    if (windows[key]) return null; // Ambiguous duplicate duration: do not choose a bucket silently.
    windows[key] = { used: w.used_percent, remaining: Math.max(0, Math.min(100, 100 - w.used_percent)), resetAt: w.resets_at * 1000 };
  }
  // Keep an explicit empty Codex snapshot so a removed window cannot linger from an older record.
  return { observedAt: at, windows };
}
export function quotaPresentation(snapshot, selection = "weekly", now = Date.now(), language = "zh") {
  const selected = selection === "both" ? ["session", "weekly"] : [selection === "session" ? "session" : "weekly"];
  const values = Object.fromEntries(["session", "weekly"].map(key => {
    const window = snapshot?.data?.windows?.[key];
    const stale = !!snapshot?.error || now - (snapshot?.data?.observedAt ?? 0) > QUOTA_STALE_MS;
    const status = !window ? "missing" : now >= window.resetAt ? "expired" : stale ? "stale" : "current";
    const remaining = window?.remaining;
    const percent = Number.isFinite(remaining) ? Number(remaining.toFixed(1)) : null;
    const abbr = key === "weekly" ? "W" : "5h", label = key === "weekly" ? "周" : "5 小时";
    const available = status === "current" || status === "stale";
    return [key, { ...window, status, label, percent,
      text: `${abbr} ${available ? `${stale ? "~" : ""}${percent}%` : "—"}`,
      detail: `${label}剩余：${available ? `${percent}%${stale ? "（旧快照）" : ""}` : status === "expired" ? "待更新（已过重置时间）" : "暂无记录"}`,
    }];
  }));
  const title = snapshot?.enabled ? selected.map(k => values[k].text).join(" · ") : "";
  const timestamp = snapshot?.data?.observedAt;
  const source = timestamp ? `本机额度快照：${new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN")}` : snapshot?.loading ? "正在读取本机额度记录…" : "等待 Codex 写入额度记录";
  return { title, values, source,
    tooltip: ["爪印 · Pawprint", ...(snapshot?.enabled ? [values.weekly.detail, values.session.detail, source, "~ 表示记录已变旧；W = 周。未向服务器实时查询。", ...(snapshot.error ? [snapshot.error] : [])] : [])].join("\n"),
  };
}
