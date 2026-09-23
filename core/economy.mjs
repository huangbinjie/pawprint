export const RULES = Object.freeze({
  version: "local-v2",
  dailyCap: 120,
  eggPrice: 240,
  expansionPrice: 600,
  expansionStep: 300,
  maxSlots: 12,
  incubationMs: 20_000,
  breedingCooldownMs: 48 * 60 * 60_000,
  matureActiveDays: 3,
  breedingWindowMs: 7 * 24 * 60 * 60_000,
  breedsPerWindow: 2,
});
export const housePets = (state) =>
  state.pets.filter((p) => p.residence !== "garden");
export const gardenPets = (state) =>
  state.pets.filter((p) => p.residence === "garden");
export const pendingOutgoing = (state) =>
  Object.values(state.lanTransactions ?? {}).filter(
    (t) =>
      t.direction === "out" &&
      ["reserved", "cancel-requested"].includes(t.status),
  );
export const heldCoins = (state) =>
  pendingOutgoing(state).reduce((n, t) => n + t.fee, 0);
export const availableCoins = (state) => state.balance - heldCoins(state);
export const reservedPet = (state, id) =>
  pendingOutgoing(state).some((t) => t.petId === id);
export const usedSlots = (state) =>
  housePets(state).length + state.eggs.length + pendingOutgoing(state).length;
export const expansionCost = (state) =>
  RULES.expansionPrice + Math.max(0, state.capacity - 3) * RULES.expansionStep;
export function companionDays(pet, now) {
  return (pet.activeDays ?? []).filter((d) => d <= dayKey(now)).length;
}
export function recordCompanionDay(state, now) {
  const date = dayKey(now);
  for (const pet of housePets(state)) {
    if (!Number.isFinite(pet.hatchedAt) || now < pet.hatchedAt) continue;
    pet.activeDays = [...new Set([...(pet.activeDays ?? []), date])].sort();
  }
}
export function breedingEligibility(pet, now, state) {
  if (state && pet && reservedPet(state, pet.id))
    return {
      allowed: false,
      reason: "正在等待局域网配种确认。",
      days: companionDays(pet, now),
    };
  if (!pet || pet.residence === "garden")
    return {
      allowed: false,
      reason: "请先接回小屋，再安排繁育。",
      days: pet ? companionDays(pet, now) : 0,
    };
  const days = companionDays(pet, now);
  if (days < RULES.matureActiveDays)
    return {
      allowed: false,
      reason: `还在长大 · 陪伴 ${days}/${RULES.matureActiveDays} 个活跃日`,
      days,
    };
  const history = (pet.breedHistory ?? [])
    .filter((at) => at > now - RULES.breedingWindowMs)
    .sort((a, b) => a - b);
  const cooldownUntil =
    pet.lastBredAt == null ? 0 : pet.lastBredAt + RULES.breedingCooldownMs;
  const quotaUntil =
    history.length >= RULES.breedsPerWindow
      ? history[history.length - RULES.breedsPerWindow] + RULES.breedingWindowMs
      : 0;
  const readyAt = Math.max(cooldownUntil, quotaUntil);
  if (now < readyAt)
    return {
      allowed: false,
      reason:
        quotaUntil >= cooldownUntil
          ? "近 7 天已繁育 2 次，休息后再见。"
          : "正在休息，48 小时冷却结束后可繁育。",
      readyAt,
      days,
    };
  return { allowed: true, reason: "已经长大，可以安排繁育。", days };
}
export function migrateEconomy(state, now = Date.now()) {
  if (state.economyVersion === RULES.version) return state;
  if (state.economyVersion !== "local-v1")
    throw new Error("Unsupported economy version");
  const next = structuredClone(state),
    today = dayKey(now);
  next.economyVersion = RULES.version;
  for (const pet of next.pets) {
    pet.residence = pet.residence ?? "home";
    const born = dayKey(pet.hatchedAt ?? pet.createdAt);
    const known = Object.entries(next.usage.days)
      .filter(([d, row]) => d >= born && d <= today && row.maxTokens > 0)
      .map(([d]) => d);
    pet.activeDays = pet.activeDays ?? [...new Set([born, ...known])].sort();
    pet.breedHistory =
      pet.breedHistory ??
      [
        ...new Set(
          [...next.pets, ...next.eggs]
            .filter((child) => child.parents?.[0]?.id === pet.id)
            .map((child) => child.createdAt)
            .concat(pet.lastBredAt == null ? [] : [pet.lastBredAt]),
        ),
      ].sort((a, b) => a - b);
    pet.residenceHistory = pet.residenceHistory ?? [];
  }
  if (
    next.activePetId &&
    !housePets(next).some((p) => p.id === next.activePetId)
  )
    next.activePetId = housePets(next)[0]?.id ?? null;
  return next;
}
export function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function rewardForUSD(usd) {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  // First $5 equivalent: 20 coins/$; thereafter 2 coins/$, maximum 120/day.
  return Math.min(
    RULES.dailyCap,
    Math.floor(Math.min(usd, 5) * 20 + Math.max(usd - 5, 0) * 2 + 1e-7),
  );
}
export function normalizeReport(raw, now) {
  if (!Array.isArray(raw)) throw new Error("本地用量报告格式不受支持。");
  const report = raw.find(
    (x) => x.provider === "codex" && x.source === "local",
  );
  if (!report || report.error)
    throw new Error("暂未读取到有效的 Codex 本地用量。");
  if (!Array.isArray(report.daily)) throw new Error("用量报告缺少每日记录。");
  const byDate = new Map();
  for (const row of report.daily) {
    if (
      typeof row.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      byDate.has(row.date)
    )
      throw new Error("用量报告包含无效或重复日期。");
    if (!Number.isSafeInteger(row.totalTokens) || row.totalTokens < 0)
      throw new Error("Token 记录无效，未兑换宠物币。");
    const cost = row.totalCost;
    if (cost != null && (!Number.isFinite(cost) || cost < 0))
      throw new Error("费用估算无效，未兑换宠物币。");
    byDate.set(row.date, {
      date: row.date,
      tokens: row.totalTokens,
      usd: cost ?? null,
      unpriced: row.unpriced ?? report.coverage?.unpriced ?? 0,
      models: (row.modelBreakdowns || []).map((m) => ({
        name: String(m.modelName).slice(0, 90),
        usd: Number.isFinite(m.cost) ? m.cost : null,
      })),
    });
  }
  const updated = Date.parse(report.updatedAt);
  const fresh =
    Number.isFinite(updated) &&
    updated <= now + 5 * 60_000 &&
    now - updated < 30 * 60_000;
  return {
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt: report.updatedAt || null,
    fetchedAt: now,
    complete: report.historyCoverageIsEstablished === true,
    fresh,
    unpriced: report.coverage?.unpriced || 0,
    source: report.adapter ?? "legacy-local",
    sourceId: report.sourceId ?? "legacy-local",
    recordDirectory: report.recordDirectory ?? null,
    pricingVersion: report.pricingVersion ?? null,
    diagnostics: report.diagnostics ?? null,
  };
}
export function observeUsage(state, report, now) {
  state.usage.report = report;
  state.usage.lastError = null;
  const date = dayKey(now);
  const row = report.days.find((d) => d.date === date);
  if (
    !report.complete ||
    !report.fresh ||
    (row?.unpriced ?? report.unpriced) > 0 ||
    !row ||
    row.usd === null
  )
    return;
  const existing = state.usage.days[date];
  const previous = existing || {
    maxTokens: 0,
    maxUSD: 0,
    eligibleUSD: 0,
    claimed: 0,
  };
  const sourceId = report.sourceId ?? "legacy-local";
  if (existing && (existing.sourceId ?? "legacy-local") !== sourceId) {
    // Switching reader, directory or pricing catalog must not reward old use a second time.
    previous.maxTokens = row.tokens;
    previous.maxUSD = row.usd;
    previous.sourceId = sourceId;
    state.usage.days[date] = previous;
    return;
  }
  const costDelta = Math.max(0, row.usd - previous.maxUSD);
  if (row.tokens > previous.maxTokens) previous.eligibleUSD += costDelta;
  previous.maxTokens = Math.max(previous.maxTokens, row.tokens);
  previous.maxUSD = Math.max(previous.maxUSD, row.usd);
  previous.sourceId = sourceId;
  state.usage.days[date] = previous;
}
export function availableReward(state, now) {
  const today = state.usage.days[dayKey(now)];
  return today
    ? Math.max(0, rewardForUSD(today.eligibleUSD) - today.claimed)
    : 0;
}
