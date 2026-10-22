import { readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { parseQuotaLine } from "../../core/quota.mjs";
import {readRouteEvidence} from '../codex-route-evidence.mjs';
export async function scanQuota({ directory, dataDirectory, now = Date.now(), deadline = Date.now() + 10_000 }) {
  const root = path.join(directory, "sessions"), files = [];
  let entriesSeen = 0;
  async function walk(folder, depth = 0) {
    if (depth > 4 || Date.now() > deadline || entriesSeen > 30000) throw new Error("quota-budget");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (++entriesSeen > 30000 || Date.now() > deadline) throw new Error("quota-budget");
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const info = await stat(file);
        if (info.mtimeMs >= now - 2 * 86400000) files.push({ file, info });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  const routes=await readRouteEvidence(dataDirectory);
  let latest = null,eligibleFiles=0;
  for (const { file, info } of files.slice(0, 64)) {
    if(eligibleFiles>=16)break;
    if (Date.now() > deadline) throw new Error("quota-budget");
    const size = Math.min(info.size, 512 * 1024), start = info.size - size;
    const handle = await open(file, "r");
    let text;
    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, start);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await handle.close(); }
    const lines = text.split("\n");
    if (start > 0) lines.shift();
    lines.pop(); // A partial final record must never become a displayed quota.
    const threadId=path.basename(file).match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$/i)?.[1];
    let eligible=false;
    for (const line of lines) {
      const q = parseQuotaLine(line, now);
      // Compatible proxy chats are also labelled OpenAI. Their empty quota
      // events do not revoke an official account's last quota observation.
      if(q&&routes[threadId]&&!Object.keys(q.windows).length)continue;
      if(q)eligible=true;
      if (q && (!latest || q.observedAt > latest.observedAt)) latest = q;
      else if (q && q.observedAt === latest.observedAt && JSON.stringify(q.windows) !== JSON.stringify(latest.windows))
        latest = { observedAt: q.observedAt, windows: {}, ambiguous: true };
    }
    if(eligible)eligibleFiles++;
  }
  return latest;
}
