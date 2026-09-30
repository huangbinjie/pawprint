// API-equivalent text-token prices per million, bundled/offline. No external calculator.
// Sources verified 2026-09-20:
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/models/gpt-6-astra
export const PRICING_VERSION = "openai-2026-09-20";
const modern = (input, cache, write, output) => ({
  input,
  cache,
  write,
  output,
  long: true,
  fast: 2,
});
const legacy = (input, cache, output, options = {}) => ({
  input,
  cache,
  output,
  ...options,
});
export const PRICES = {
  "gpt-6-astra": modern(10, 1, 12.5, 50),
  "gpt-5.6-sol": modern(4, 0.4, 5, 20),
  "gpt-5.6-terra": modern(2, 0.2, 2.5, 12),
  "gpt-5.6-luna": modern(0.2, 0.02, 0.25, 1.2),
  "gpt-5.5": legacy(5, 0.5, 30, { long: true, fast: 2.5 }),
  "gpt-5.5-pro": legacy(30, null, 180, { long: true }),
  "gpt-5.4": legacy(2.5, 0.25, 15, { long: true, fast: 2 }),
  "gpt-5.4-pro": legacy(30, null, 180, { long: true }),
  "gpt-5.4-mini": legacy(0.75, 0.075, 4.5, { fast: 2 }),
  "gpt-5.4-nano": legacy(0.2, 0.02, 1.25),
  "gpt-5.3-codex": legacy(1.75, 0.175, 14, { fast: 2 }),
  "gpt-5.2": legacy(1.75, 0.175, 14, { fast: 2 }),
  "gpt-5.2-pro": legacy(21, null, 168),
  "gpt-5.1": legacy(1.25, 0.125, 10, { fast: 2 }),
  "gpt-5": legacy(1.25, 0.125, 10, { fast: 2 }),
  "gpt-5-mini": legacy(0.25, 0.025, 2, { fast: 1.8 }),
  "gpt-5-nano": legacy(0.05, 0.005, 0.4),
  "gpt-5-pro": legacy(15, null, 120),
};
export function canonicalModel(model) {
  if (typeof model !== "string") return "unknown";
  const clean = model.trim().toLowerCase();
  if (PRICES[clean]) return clean;
  const dated = clean.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return PRICES[dated] ? dated : clean.slice(0, 100);
}
export function tokenCounts(value) {
  if (!value || typeof value !== "object") return null;
  const n = {
    input: value.input_tokens,
    cached: value.cached_input_tokens ?? 0,
    write: value.cache_write_input_tokens ?? 0,
    output: value.output_tokens,
  };
  if (!Object.values(n).every((x) => Number.isSafeInteger(x) && x >= 0))
    return null;
  if (n.cached + n.write > n.input) return null;
  if (
    value.reasoning_output_tokens != null &&
    (!Number.isSafeInteger(value.reasoning_output_tokens) ||
      value.reasoning_output_tokens < 0 ||
      value.reasoning_output_tokens > n.output)
  )
    return null;
  if (value.total_tokens != null && value.total_tokens !== n.input + n.output)
    return null;
  return { ...n, total: n.input + n.output };
}
export function estimateCost(model, counts, tier, catalog, provider = "openai") {
  const dynamic = catalog?.[provider]?.models;
  const clean = String(model).trim().toLowerCase().replace(/^openai\//, "");
  const entry = dynamic?.[clean] ?? dynamic?.[clean.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (entry?.cost) return catalogCost(entry, counts, tier);
  if (provider !== "openai") return null;
  const price = PRICES[canonicalModel(model)];
  if (!price) return null;
  const service = tier ?? "default";
  if (
    ![
      "default",
      "standard",
      "auto",
      "priority",
      "fast",
      "flex",
      "batch",
    ].includes(service)
  )
    return null;
  const isFast = service === "priority" || service === "fast";
  if (isFast && !price.fast) return null;
  // The older fast pricing table does not specify long-context fast rates.
  const long = price.long && counts.input > 272000;
  if (long && isFast && !price.write) return null;
  if (counts.cached && price.cache == null) return null;
  if (counts.write && price.write == null) return null;
  const inputFactor = long ? 2 : 1,
    outputFactor = long ? 1.5 : 1;
  const mode = isFast
    ? price.fast
    : service === "flex" || service === "batch"
      ? 0.5
      : 1;
  const ordinary = counts.input - counts.cached - counts.write;
  const usd =
    (((ordinary * price.input +
      counts.cached * (price.cache ?? 0) +
      counts.write * (price.write ?? 0)) *
      inputFactor +
      counts.output * price.output * outputFactor) *
      mode) /
    1e6;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

function catalogCost(entry, counts, tier = "default") {
  if (!["default", "standard", "auto", "priority", "fast", "flex", "batch"].includes(tier ?? "default")) return null;
  let cost = entry.cost;
  const contextTiers = (cost.tiers ?? []).filter(t => t.tier?.type === "context" && Number.isFinite(t.tier.size)).sort((a,b) => a.tier.size-b.tier.size);
  for (const t of contextTiers) if (counts.input > t.tier.size) cost = t;
  const fast = tier === "priority" || tier === "fast";
  if (fast) {
    const fastCost = entry.experimental?.modes?.fast?.cost;
    if (!fastCost) return null;
    // Do not invent a fast long-context multiplier when the catalog omits it.
    if (cost !== entry.cost) return null;
    cost = fastCost;
  }
  const ordinary = counts.input - counts.cached - counts.write;
  const parts = [[ordinary, cost.input], [counts.cached, cost.cache_read], [counts.write, cost.cache_write], [counts.output, cost.output]];
  if (parts.some(([n, rate]) => n > 0 && (!Number.isFinite(rate) || rate < 0))) return null;
  const factor = tier === "flex" || tier === "batch" ? 0.5 : 1;
  return parts.reduce((sum, [n, rate]) => sum + (n ? n * rate : 0), 0) * factor / 1e6;
}
