import { createReadStream } from "node:fs";
import {
  readdir,
  stat,
  readFile,
  writeFile,
  rename,
  mkdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { dayKey } from "../../core/economy.mjs";
import {
  tokenCounts,
  canonicalModel,
  estimateCost,
  PRICING_VERSION,
} from "./pricing.mjs";
export const READER_VERSION = "builtin-codex-v1";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const MAX_LINE = 1024 * 1024;
const relevant = /"type"\s*:\s*"(?:session_meta|turn_context|event_msg)"/;

// Keeps at most one bounded line in memory. Oversized response bodies never enter JSON.parse.
async function* lines(file, deadline) {
  let pending = "",
    discard = false,
    ordinal = 0;
  const stream = createReadStream(file, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  for await (const chunk of stream) {
    if (Date.now() > deadline) {
      stream.destroy();
      throw new Error("scan-budget");
    }
    let start = 0;
    for (let i = 0; i < chunk.length; i++)
      if (chunk[i] === "\n") {
        const piece = chunk.slice(start, i);
        if (!discard && pending.length + piece.length <= MAX_LINE)
          yield { text: pending + piece, ordinal, tail: false };
        else yield { text: pending.slice(0, 512), ordinal, oversized: true };
        ordinal++;
        pending = "";
        discard = false;
        start = i + 1;
      }
    if (!discard) {
      pending += chunk.slice(start);
      if (pending.length > MAX_LINE) {
        pending = pending.slice(0, 512);
        discard = true;
      }
    }
  }
  if (pending || discard)
    yield { text: pending, ordinal, tail: true, oversized: discard };
}
function difference(a, b) {
  const value = Object.fromEntries(
    ["input", "cached", "write", "output", "total"].map((k) => [
      k,
      a[k] - b[k],
    ]),
  );
  return Object.values(value).every((x) => x >= 0) &&
    value.cached + value.write <= value.input
    ? value
    : null;
}
function same(a, b) {
  return (
    a &&
    b &&
    ["input", "cached", "write", "output", "total"].every((k) => a[k] === b[k])
  );
}
function validTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function validCachedData(data) {
  return (
    data &&
    typeof data.complete === "boolean" &&
    Array.isArray(data.issues) &&
    data.issues.every((x) => typeof x === "string") &&
    Array.isArray(data.rows) &&
    data.rows.length <= 100001 &&
    data.rows.every(
      (r) =>
        typeof r.id === "string" &&
        r.id.length === 64 &&
        Number.isFinite(r.at) &&
        typeof r.date === "string" &&
        typeof r.model === "string" &&
        r.model.length <= 100 &&
        Number.isSafeInteger(r.tokens) &&
        r.tokens >= 0 &&
        (r.usd === null || (Number.isFinite(r.usd) && r.usd >= 0)) &&
        typeof r.gap === "boolean",
    )
  );
}

export async function parseSession(
  file,
  { startMs, endMs, deadline = Date.now() + 45000 } = {},
) {
  let id = null,
    created = null,
    fork = false,
    boundary = null,
    model = "unknown",
    tier = null,
    turn = "",
    previous = null,
    provider = "openai";
  let sawMeta = false,
    malformed = false;
  const rows = [],
    issues = new Set();
  for await (const line of lines(file, deadline)) {
    if (!relevant.test(line.text)) continue;
    // Large user/assistant messages are not metering records. Their text is discarded.
    if (
      /"type"\s*:\s*"event_msg"/.test(line.text) &&
      !/"type"\s*:\s*"(?:token_count|thread_settings_applied)"/.test(line.text)
    )
      continue;
    if (line.oversized) {
      malformed = true;
      issues.add("oversized-stat-record");
      continue;
    }
    let record;
    try {
      record = JSON.parse(line.text);
    } catch {
      if (!line.tail) {
        malformed = true;
        issues.add("malformed-stat-record");
      }
      continue;
    }
    const payload = record.payload;
    if (!payload || typeof payload !== "object") continue;
    if (record.type === "session_meta") {
      if (sawMeta) {
        malformed = true;
        issues.add("multiple-session-identities");
        continue;
      }
      sawMeta = true;
      const key = payload.id ?? payload.session_id;
      if (typeof key === "string" && key.length <= 180) id = hash(key);
      created = validTimestamp(payload.timestamp ?? record.timestamp);
      provider = payload.model_provider ?? "openai";
      boundary =
        Number.isSafeInteger(payload.subagent_history_start_ordinal) &&
        payload.subagent_history_start_ordinal >= 0
          ? payload.subagent_history_start_ordinal
          : null;
      fork = Boolean(
        payload.forked_from_id ||
        payload.parent_thread_id ||
        boundary !== null ||
        /subagent/.test(JSON.stringify(payload.source ?? "")) ||
        /subagent/.test(JSON.stringify(payload.thread_source ?? "")),
      );
      continue;
    }
    if (record.type === "turn_context") {
      model = canonicalModel(payload.model);
      tier =
        typeof payload.service_tier === "string" ? payload.service_tier : null;
      turn =
        typeof payload.turn_id === "string"
          ? payload.turn_id.slice(0, 180)
          : "";
      continue;
    }
    if (record.type !== "event_msg") continue;
    if (payload.type === "thread_settings_applied") {
      const settings = payload.settings ?? payload;
      if (typeof settings.model === "string")
        model = canonicalModel(settings.model);
      if (typeof settings.service_tier === "string")
        tier = settings.service_tier;
      continue;
    }
    if (payload.type !== "token_count" || !payload.info) continue;
    const total = tokenCounts(payload.info.total_token_usage);
    const last = tokenCounts(payload.info.last_token_usage);
    const timestamp = validTimestamp(record.timestamp);
    const old = previous;
    if (total) previous = total;
    const inherited =
      fork &&
      (boundary !== null
        ? line.ordinal < boundary
        : created === null || timestamp === null || timestamp < created);
    if (inherited) continue;
    if (timestamp === null) {
      malformed = true;
      issues.add("invalid-usage-date");
      continue;
    }
    if (timestamp < startMs || timestamp > endMs) continue;
    if (!id) {
      malformed = true;
      issues.add("missing-session-identity");
      continue;
    }
    if (
      total &&
      old &&
      total.input === old.input &&
      total.output === old.output
    )
      continue; // Completion repeats/cache corrections add no new use.
    if (!total || !last) {
      malformed = true;
      issues.add("invalid-token-counters");
      continue;
    }
    if (
      ["input", "cached", "write", "output"].some((k) => last[k] > total[k])
    ) {
      malformed = true;
      issues.add("invalid-token-counters");
      continue;
    }
    if (last.total === 0) continue;
    const delta = old ? difference(total, old) : total;
    // A counter reset is a new segment: only its witnessed last request is billable.
    // Missing requests cannot be priced at a made-up average context size/model.
    const gap = delta
      ? !same(delta, last)
      : old && total.input >= old.input && total.output >= old.output;
    const signature = hash(`${id}|${turn}|${total.input}|${total.output}`);
    const usd = provider === "openai" ? estimateCost(model, last, tier) : null;
    rows.push({
      id: signature,
      at: timestamp,
      date: dayKey(timestamp),
      model,
      tokens: last.total,
      usd,
      gap: !!gap,
    });
    if (gap) issues.add("missing-request-details");
    if (rows.length > 100000) {
      malformed = true;
      issues.add("too-many-usage-records");
      break;
    }
  }
  return { rows, issues: [...issues], complete: !malformed };
}
async function discover(root, startMs, deadline) {
  const found = [],
    issues = [];
  let present = 0;
  async function walk(dir) {
    if (Date.now() > deadline) {
      issues.push("scan-budget");
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code !== "ENOENT") issues.push("unreadable-directory");
      return;
    }
    for (const entry of entries) {
      if (found.length >= 20000) {
        issues.push("too-many-files");
        return;
      }
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await stat(file);
          if (info.mtimeMs >= startMs)
            found.push({
              file,
              size: info.size,
              stamp: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`,
              mtime: info.mtimeMs,
            });
        } catch {
          issues.push("unreadable-session");
        }
      }
    }
  }
  for (const name of ["sessions", "archived_sessions"]) {
    const folder = path.join(root, name);
    try {
      if ((await stat(folder)).isDirectory()) {
        present++;
        await walk(folder);
      }
    } catch (e) {
      if (e.code !== "ENOENT") issues.push("unreadable-directory");
    }
  }
  if (!present)
    throw new Error(
      "没有找到 Codex 本地使用记录。请先使用 Codex 桌面端或 CLI，或在设置中选择正确的记录目录。",
    );
  return { files: found.sort((a, b) => b.mtime - a.mtime), issues };
}
export async function scanUsage({
  codexHome,
  cacheDirectory,
  now = Date.now(),
  days = 7,
  budgetMs = 45000,
}) {
  const started = Date.now(),
    deadline = started + budgetMs;
  let root;
  try {
    root = await realpath(codexHome);
  } catch {
    throw new Error(
      "没有找到 Codex 记录目录。可在设置中手动选择 .codex 文件夹。",
    );
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const startMs = start.getTime(),
    scope = hash(
      `${READER_VERSION}|parser-3|${PRICING_VERSION}|${root}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    );
  const sourceId = hash(`${READER_VERSION}|${PRICING_VERSION}|${root}`);
  const { files, issues: discoveryIssues } = await discover(
    root,
    startMs,
    deadline,
  );
  const cacheFile = path.join(
    cacheDirectory,
    `usage-${scope.slice(0, 20)}.json`,
  );
  let cached = {};
  try {
    const info = await stat(cacheFile);
    if (info.size < 64 * 1024 * 1024) {
      const data = JSON.parse(await readFile(cacheFile, "utf8"));
      if (data.scope === scope) cached = data.files ?? {};
    }
  } catch {}
  const next = {},
    seen = new Map(),
    issues = new Set(discoveryIssues);
  let complete = !discoveryIssues.length,
    scannedFiles = 0,
    cachedFiles = 0;
  for (const entry of files) {
    if (Date.now() > deadline) {
      complete = false;
      issues.add("scan-budget");
      break;
    }
    const key = hash(entry.file);
    let parsed;
    const old = cached[key];
    if (
      old?.stamp === entry.stamp &&
      old.startMs <= startMs &&
      old.endMs <= now &&
      validCachedData(old.data)
    ) {
      parsed = old.data;
      cachedFiles++;
    } else {
      try {
        parsed = await parseSession(entry.file, {
          startMs,
          endMs: now,
          deadline,
        });
        scannedFiles++;
      } catch (error) {
        complete = false;
        issues.add(
          error.message === "scan-budget"
            ? "scan-budget"
            : "unreadable-session",
        );
        continue;
      }
    }
    // A recently changing file is a safe prefix; do not cache it under a newer size.
    next[key] = { stamp: entry.stamp, startMs, endMs: now, data: parsed };
    complete = complete && parsed.complete;
    parsed.issues.forEach((x) => issues.add(x));
    for (const row of parsed.rows) {
      if (row.at < startMs || row.at > now) continue;
      const prior = seen.get(row.id);
      if (!prior) seen.set(row.id, row);
      else if (
        prior.tokens !== row.tokens ||
        prior.model !== row.model ||
        prior.usd !== row.usd
      ) {
        complete = false;
        issues.add("conflicting-duplicate");
      }
    }
  }
  // Persist only counters/prices/hash identities, never transcripts, instructions or project paths.
  try {
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    const serialized = JSON.stringify({ scope, files: next });
    if (Buffer.byteLength(serialized) < 64 * 1024 * 1024) {
      await writeFile(`${cacheFile}.tmp`, serialized, { mode: 0o600 });
      await rename(`${cacheFile}.tmp`, cacheFile);
    }
  } catch {
    issues.add("cache-unavailable");
  }
  const totals = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    totals.set(dayKey(d), {
      date: dayKey(d),
      totalTokens: 0,
      totalCost: 0,
      unpriced: 0,
      models: new Map(),
    });
  }
  for (const row of seen.values()) {
    const day = totals.get(row.date);
    if (!day) continue;
    day.totalTokens += row.tokens;
    if (row.usd === null || row.gap) day.unpriced++;
    if (row.usd !== null) day.totalCost += row.usd;
    const model = day.models.get(row.model) ?? {
      modelName: row.model,
      cost: 0,
      totalTokens: 0,
      unpriced: 0,
    };
    model.totalTokens += row.tokens;
    if (row.usd === null || row.gap) model.unpriced++;
    else model.cost += row.usd;
    day.models.set(row.model, model);
  }
  const daily = [...totals.values()].map(({ models, ...day }) => ({
    ...day,
    totalCost: day.unpriced ? null : day.totalCost,
    modelBreakdowns: [...models.values()].map((m) => ({
      ...m,
      cost: m.unpriced ? null : m.cost,
    })),
  }));
  const unpriced = daily.reduce((n, d) => n + d.unpriced, 0);
  return [
    {
      provider: "codex",
      source: "local",
      adapter: READER_VERSION,
      sourceId,
      recordDirectory: root,
      pricingVersion: PRICING_VERSION,
      updatedAt: new Date(now).toISOString(),
      historyCoverageIsEstablished: complete,
      coverage: { unpriced },
      daily,
      diagnostics: {
        files: files.length,
        scannedFiles,
        cachedFiles,
        observations: seen.size,
        issues: [...issues],
        elapsedMs: Date.now() - started,
      },
      notes:
        "本机 Codex 使用记录；API 等价费用估算。未标注服务档位按标准价计算。",
    },
  ];
}
