import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const TTL = 24 * 60 * 60_000;
export async function loadCatalog({ cacheDirectory, now = Date.now(), fetchImpl = fetch }) {
  const file = path.join(cacheDirectory, "model-prices.json");
  let cached;
  try {
    cached = JSON.parse(await readFile(file, "utf8"));
    if (!valid(cached.catalog) || !Number.isFinite(cached.fetchedAt)) cached = null;
  } catch {}
  let status = "cached";
  let unknown = false;
  if (cached && now - cached.fetchedAt >= 15 * 60_000) {
    try {
      const files = (await readdir(cacheDirectory)).filter(n => /^usage-.*\.json$/.test(n)).slice(-8);
      for (const name of files) {
        const report = JSON.parse(await readFile(path.join(cacheDirectory, name), "utf8"));
        unknown ||= Object.values(report.files ?? {}).some(f => f.data?.rows?.some(r => r.usd === null && !r.gap));
      }
    } catch {}
  }
  if (!cached || unknown || now - cached.fetchedAt >= TTL) {
    try {
      const response = await fetchImpl("https://models.dev/api.json", { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("catalog-http");
      const body = await response.text();
      if (Buffer.byteLength(body) > 20 * 1024 * 1024) throw new Error("catalog-size");
      const catalog = JSON.parse(body);
      if (!valid(catalog)) throw new Error("catalog-invalid");
      cached = { catalog, fetchedAt: now };
      status = "updated";
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(cached), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    } catch { status = cached ? "stale" : "offline-fallback"; }
  }
  const catalog = cached?.catalog;
  return {
    catalog,
    pricingVersion: catalog ? `models.dev-${createHash("sha256").update(JSON.stringify(catalog)).digest("hex").slice(0,12)}` : undefined,
    pricingStatus: { source: catalog ? "models.dev" : "bundled", status, fetchedAt: cached?.fetchedAt ?? null },
  };
}
function valid(catalog) {
  return catalog && typeof catalog === "object" && !Array.isArray(catalog) &&
    Object.keys(catalog.openai?.models ?? {}).length > 10 &&
    Object.values(catalog.openai.models).some(m => Number.isFinite(m.cost?.input) && Number.isFinite(m.cost?.output));
}
