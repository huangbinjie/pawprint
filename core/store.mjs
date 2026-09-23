import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { migrateTalents, talentById } from "./talents.mjs";
import { migrateSkills, validSkills } from "./skills.mjs";
import { heldCoins } from "./economy.mjs";
import { initialState } from "./game.mjs";
import { TRAITS, migrateGenetics } from "./genetics.mjs";
import { migrateEconomy, usedSlots, housePets, RULES } from "./economy.mjs";
function validGenome(genome) {
  return (
    genome &&
    (genome.$schema === undefined || genome.$schema === "expression-v3") &&
    Object.entries(TRAITS).every(
      ([key, values]) =>
        Array.isArray(genome[key]) &&
        genome[key].length === 2 &&
        genome[key].every(
          (value) =>
            Number.isInteger(value) && value >= 0 && value < values.length,
        ),
    )
  );
}
export function validateState(state) {
  if (
    state?.version !== 1 ||
    !Number.isSafeInteger(state.balance) ||
    state.balance < 0 ||
    !Array.isArray(state.pets) ||
    !Array.isArray(state.eggs) ||
    !state.usage?.days ||
    !state.settings ||
    !Array.isArray(state.ledger)
  )
    throw new Error("Unsupported save");
  if (
    !Number.isInteger(state.capacity) ||
    state.capacity < 3 ||
    state.capacity > 12 ||
    usedSlots(state) > state.capacity
  )
    throw new Error("Invalid capacity");
  if (
    !state.lanTransactions ||
    typeof state.lanTransactions !== "object" ||
    Array.isArray(state.lanTransactions) ||
    heldCoins(state) < 0 ||
    heldCoins(state) > state.balance
  )
    throw new Error("Invalid network reservations");
  for (const t of Object.values(state.lanTransactions)) {
    if (
      !["in", "out"].includes(t.direction) ||
      ![
        "reserved",
        "cancel-requested",
        "completed",
        "pending",
        "committed",
        "cancelled",
      ].includes(t.status) ||
      typeof t.id !== "string" ||
      typeof t.peerId !== "string" ||
      (t.direction === "out" && t.fee !== 240)
    )
      throw new Error("Invalid network transaction");
  }
  const residents = [...state.pets, ...state.eggs];
  const ids = new Set();
  for (const resident of residents) {
    if (
      typeof resident.id !== "string" ||
      ids.has(resident.id) ||
      !validGenome(resident.genome) ||
      !talentById(resident.talent?.id) ||
      !Number.isInteger(resident.talent.level) ||
      resident.talent.level < 1 ||
      resident.talent.level > 3 ||
      (state.skillVersion === 1 && !validSkills(resident.skills)) ||
      !Array.isArray(resident.parents) ||
      !Number.isInteger(resident.generation) ||
      resident.generation < 1 ||
      !Number.isFinite(resident.readyAt)
    )
      throw new Error("Invalid pet");
    ids.add(resident.id);
  }
  if (state.pets.some((p) => typeof p.name !== "string" || !p.name.trim()))
    throw new Error("Invalid name");
  if (
    state.economyVersion !== RULES.version ||
    state.pets.some(
      (p) =>
        !["home", "garden"].includes(p.residence) ||
        !Array.isArray(p.activeDays) ||
        p.activeDays.some(
          (d) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d),
        ) ||
        new Set(p.activeDays).size !== p.activeDays.length ||
        !Array.isArray(p.breedHistory) ||
        p.breedHistory.some((t) => !Number.isFinite(t)) ||
        !Array.isArray(p.residenceHistory),
    )
  )
    throw new Error("Invalid resident history");
  if (
    state.activePetId !== null &&
    !housePets(state).some((p) => p.id === state.activePetId)
  )
    throw new Error("Invalid active pet");
  let balance = 0;
  const entries = new Set();
  for (const row of [...state.ledger].reverse()) {
    if (
      typeof row.id !== "string" ||
      entries.has(row.id) ||
      !Number.isSafeInteger(row.amount)
    )
      throw new Error("Invalid ledger");
    entries.add(row.id);
    balance += row.amount;
    if (
      !Number.isSafeInteger(balance) ||
      balance < 0 ||
      row.balance !== balance
    )
      throw new Error("Invalid ledger balance");
  }
  if (balance !== state.balance) throw new Error("Unreconciled ledger");
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "save-v1.json");
    this.state = null;
  }
  async load(now = Date.now()) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const original = JSON.parse(await readFile(this.file, "utf8"));
      const state = migrateSkills(migrateTalents(
        migrateEconomy(migrateGenetics(original), now),
      ));
      validateState(state);
      this.state = state;
      if (state !== original) await this.save(state);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "本地存档损坏或版本不受支持。原文件和 .bak 备份已保留，请勿删除，联系开发者恢复。",
        );
      await this.save(initialState(now));
    }
    return this.state;
  }
  async save(state) {
    validateState(state);
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), {
      mode: 0o600,
      flush: true,
    });
    try {
      await copyFile(this.file, `${this.file}.bak`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temp, this.file);
    this.state = state;
  }
}
