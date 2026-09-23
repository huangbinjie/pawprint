import {
  GENE_KEYS,
  TRAITS,
  inheritGenome,
  CATALOG_VERSION,
  GENE_COUNT,
} from "./genetics.mjs";
import { talentById, drawTalent } from "./talents.mjs";
import { drawSkills, petSkills, validSkills } from "./skills.mjs";
import { entry } from "./ledger.mjs";
import {
  RULES,
  availableCoins,
  usedSlots,
  breedingEligibility,
} from "./economy.mjs";
export const LAN_FEE = 240,
  LAN_OWNER_REWARD = 60,
  LAN_TTL = 5 * 60_000;
export const LAN_PROTOCOL = `v2:skills1:${CATALOG_VERSION}:${GENE_COUNT}:${LAN_FEE}:${LAN_OWNER_REWARD}:${RULES.breedingCooldownMs}:${RULES.breedsPerWindow}`;
export const txKey = (peer, id) => `${peer}:${id}`;
export function cleanPet(p) {
  if (
    !p ||
    typeof p.id !== "string" ||
    p.id.length > 120 ||
    typeof p.name !== "string" ||
    /[\u0000-\u001f]/.test(p.name) ||
    [...p.name].length > 12 ||
    !p.name.trim() ||
    !Number.isInteger(p.generation) ||
    p.generation < 1 ||
    p.generation > 10000
  )
    throw new Error("对方宠物信息无效。");
  if (
    !p.genome ||
    !GENE_KEYS.every(
      (k) =>
        Array.isArray(p.genome[k]) &&
        p.genome[k].length === 2 &&
        p.genome[k].every(
          (v) => Number.isInteger(v) && v >= 0 && v < TRAITS[k].length,
        ),
    )
  )
    throw new Error("双方基因版本不兼容，请更新应用。");
  if (p.genome.$schema !== undefined && p.genome.$schema !== "expression-v3")
    throw new Error("基因表现规则不兼容。");
  if (
    !talentById(p.talent?.id) ||
    !Number.isInteger(p.talent.level) ||
    p.talent.level < 1 ||
    p.talent.level > 3
  )
    throw new Error("对方才艺信息无效。");
  const genome = Object.fromEntries(
    GENE_KEYS.map((k) => [k, [...p.genome[k]]]),
  );
  if (p.genome.$schema) genome.$schema = p.genome.$schema;
  const skills = petSkills(p);
  if (!validSkills(skills)) throw new Error("对方技能资料无效，请更新爪印。");
  return {
    id: p.id,
    name: p.name,
    generation: p.generation,
    genome,
    talent: { id: p.talent.id, level: p.talent.level },
    skills: { idle: skills.idle, social: skills.social },
  };
}
export function publicPet(p, state, now) {
  return {
    ...cleanPet(p),
    canBreed: breedingEligibility(p, now, state).allowed,
    breedReason: breedingEligibility(p, now, state).reason,
  };
}
function readyPet(state, petId, now) {
  const p = state.pets.find((x) => x.id === petId);
  const e = breedingEligibility(p, now, state);
  if (!e.allowed) throw new Error(e.reason);
  return p;
}
function markBred(p, now) {
  p.lastBredAt = now;
  p.breedCount++;
  p.breedHistory.push(now);
}
function validId(c) {
  if (!/^[a-f0-9-]{20,80}$/i.test(c.id) || !/^[a-f0-9]{64}$/.test(c.peerId))
    throw new Error("配种请求标识无效。");
}
export function lanTransition(s, c, { now, rng, id }) {
  validId(c);
  s.lanTransactions ??= {};
  const key =
    c.type === "_lan-reserve" ||
    c.type === "_lan-finalize" ||
    c.type === "_lan-confirm-cancel" ||
    c.type === "_lan-cancel-request"
      ? c.id
      : txKey(c.peerId, c.id);
  const old = s.lanTransactions[key];
  if (c.type === "_lan-reserve") {
    if (old) return s;
    if (Object.keys(s.lanTransactions).length >= 10000)
      throw new Error("局域网交易记录已达当前版本上限。");
    const pet = readyPet(s, c.petId, now),
      mate = cleanPet(c.mate);
    if (usedSlots(s) >= s.capacity) throw new Error("先给新蛋留一个小屋位置。");
    if (availableCoins(s) < LAN_FEE) throw new Error("需要 240 枚可用宠物币。");
    s.lanTransactions[key] = {
      id: c.id,
      direction: "out",
      status: "reserved",
      peerId: c.peerId,
      peerName: String(c.peerName ?? "同事").slice(0, 30),
      petId: pet.id,
      aPet: cleanPet(pet),
      bPet: mate,
      fee: LAN_FEE,
      createdAt: now,
      expiresAt: now + LAN_TTL,
    };
    return s;
  }
  if (c.type === "_lan-receive") {
    if (old) return s;
    if (Object.keys(s.lanTransactions).length >= 10000)
      throw new Error("局域网记录已满。");
    const aPet = cleanPet(c.aPet);
    readyPet(s, c.petId, now);
    s.lanTransactions[key] = {
      id: c.id,
      direction: "in",
      status: "pending",
      peerId: c.peerId,
      peerName: String(c.peerName ?? "同事").slice(0, 30),
      petId: c.petId,
      aPet,
      createdAt: now,
      expiresAt: now + LAN_TTL,
    };
    return s;
  }
  if (c.type === "_lan-cancel") {
    if (!old && Object.keys(s.lanTransactions).length >= 10000)
      throw new Error("局域网记录已满。");
    if (old?.status === "committed") return s;
    s.lanTransactions[key] = {
      ...(old ?? {
        id: c.id,
        direction: "in",
        peerId: c.peerId,
        createdAt: now,
      }),
      status: "cancelled",
    };
    return s;
  }
  if (!old || old.peerId !== c.peerId)
    throw new Error("没有找到这笔配种请求。");
  if (c.type === "_lan-accept") {
    if (old.status === "committed") return s;
    if (old.status !== "pending" || now > old.expiresAt)
      throw new Error("请求已取消或过期。");
    const pet = readyPet(s, old.petId, now),
      a = cleanPet(old.aPet),
      b = cleanPet(pet);
    const egg = {
      id: `lan-${old.id}`,
      genome: inheritGenome(a.genome, b.genome, rng),
      talent: drawTalent(rng, a.talent, b.talent),
      skills: drawSkills(rng, a.skills, b.skills),
      parents: [a, b],
      generation: Math.max(a.generation, b.generation) + 1,
      origin: "同事繁育蛋",
      birthRules: "inheritance-v3",
    };
    old.status = "committed";
    old.receipt = {
      id: old.id,
      egg,
      fee: LAN_FEE,
      ownerReward: LAN_OWNER_REWARD,
      committedAt: now,
    };
    markBred(pet, now);
    entry(
      s,
      LAN_OWNER_REWARD,
      "lan-breeding-income",
      `${old.peerName}的配种答谢`,
      now,
      id,
    );
    return s;
  }
  if (c.type === "_lan-cancel-request") {
    if (old.status === "reserved") old.status = "cancel-requested";
    return s;
  }
  if (c.type === "_lan-confirm-cancel") {
    if (["reserved", "cancel-requested"].includes(old.status))
      old.status = "cancelled";
    return s;
  }
  if (c.type === "_lan-finalize") {
    if (old.status === "completed") return s;
    if (!["reserved", "cancel-requested"].includes(old.status))
      throw new Error("这笔请求已结束。");
    const r = c.receipt;
    if (
      !r ||
      r.id !== old.id ||
      r.fee !== LAN_FEE ||
      r.ownerReward !== LAN_OWNER_REWARD ||
      r.egg?.id !== `lan-${old.id}` ||
      r.egg?.parents?.length !== 2
    )
      throw new Error("对方配种回执无效。");
    const a = cleanPet(r.egg.parents[0]),
      b = cleanPet(r.egg.parents[1]);
    if (
      JSON.stringify(a) !== JSON.stringify(cleanPet(old.aPet)) ||
      JSON.stringify(b.genome) !== JSON.stringify(old.bPet.genome) ||
      b.id !== old.bPet.id
    )
      throw new Error("回执中的父母与申请不一致。");
    const child = cleanPet({ ...r.egg, name: "未孵化" });
    if (
      child.genome.$schema !== "expression-v3" ||
      child.talent.level !== 1 ||
      child.generation !== Math.max(a.generation, b.generation) + 1
    )
      throw new Error("后代信息不一致。");
    for (const k of GENE_KEYS) {
      const [x, y] = child.genome[k];
      if (!(
        (a.genome[k].includes(x) && b.genome[k].includes(y)) ||
        (a.genome[k].includes(y) && b.genome[k].includes(x))
      ))
        throw new Error("后代没有正确继承双方基因。");
    }
    const pet = s.pets.find((p) => p.id === old.petId);
    if (!pet || pet.residence !== "home")
      throw new Error("被保留的亲本无法找到。");
    old.status = "completed";
    old.receipt = r;
    entry(s, -LAN_FEE, "lan-breeding", `与${b.name}局域网繁育`, now, id);
    Object.assign(s.ledger[0], {
      systemCost: LAN_FEE - LAN_OWNER_REWARD,
      peerTransfer: LAN_OWNER_REWARD,
      transactionId: old.id,
    });
    s.eggs.push({
      id: child.id,
      genome: child.genome,
      talent: child.talent,
      skills: child.skills,
      parents: [a, b],
      generation: child.generation,
      origin: "同事繁育蛋",
      birthRules: "inheritance-v3",
      createdAt: now,
      readyAt: now + RULES.incubationMs,
    });
    markBred(pet, now);
    return s;
  }
  throw new Error("未知局域网操作。");
}
