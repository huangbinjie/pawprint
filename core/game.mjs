import { entry } from "./ledger.mjs";
import { IDLE_ROUTES } from "./idle.mjs";
import { drawSkills, petSkills } from "./skills.mjs";
import { QUOTA_WINDOWS } from "./quota.mjs";
import { LANGUAGES } from "./i18n.mjs";
import { drawTalent, trainingCost } from "./talents.mjs";
import { lanTransition } from "./multiplayer.mjs";
import {
  randomGenome,
  inheritGenome,
  PARTNERS,
  CATALOG_VERSION,
} from "./genetics.mjs";
import {
  RULES,
  dayKey,
  availableReward,
  observeUsage,
  usedSlots,
  housePets,
  expansionCost,
  recordCompanionDay,
  breedingEligibility,
  reservedPet,
} from "./economy.mjs";
export function initialState(now) {
  return {
    version: 1,
    talentVersion: 1,
    skillVersion: 1,
    lanTransactions: {},
    geneticsVersion: 3,
    economyVersion: RULES.version,
    createdAt: now,
    balance: 0,
    capacity: 3,
    freeEggClaimed: false,
    pets: [],
    eggs: [],
    ledger: [],
    activePetId: null,
    settings: { connected: false, floating: true, desktopShellVersion: 1 },
    usage: { days: {}, report: null, lastError: null },
  };
}
function room(state) {
  if (usedSlots(state) >= state.capacity)
    throw new Error("小屋住满了，可以安排伙伴去后花园休息，或扩建饲养位置。");
}
export function transition(current, command, { now, rng, id }) {
  const state = structuredClone(current);
  if (command.type.startsWith("_lan-"))
    return lanTransition(state, command, { now, rng, id });
  switch (command.type) {
    case "free-egg": {
      if (state.freeEggClaimed) throw new Error("你的初遇蛋已经领取过了。");
      room(state);
      state.freeEggClaimed = true;
      state.eggs.push({
        id: id(),
        genome: randomGenome(rng),
        talent: drawTalent(rng),
        skills: drawSkills(rng),
        birthRules: CATALOG_VERSION,
        createdAt: now,
        readyAt: now,
        parents: [],
        generation: 1,
        origin: "初遇蛋",
      });
      break;
    }
    case "buy-egg": {
      room(state);
      entry(state, -RULES.eggPrice, "egg", "领养一枚探索蛋", now, id);
      state.eggs.push({
        id: id(),
        genome: randomGenome(rng),
        talent: drawTalent(rng),
        skills: drawSkills(rng),
        birthRules: CATALOG_VERSION,
        createdAt: now,
        readyAt: now + RULES.incubationMs,
        parents: [],
        generation: 1,
        origin: "探索蛋",
      });
      break;
    }
    case "hatch": {
      const index = state.eggs.findIndex((x) => x.id === command.eggId);
      if (index < 0) throw new Error("这枚蛋已经孵化了。");
      const egg = state.eggs[index];
      if (now < egg.readyAt) throw new Error("小家伙还需要一点点时间。");
      const pet = {
        ...egg,
        hatchedAt: now,
        name: (state.settings.language === "en" ? ["Pudding", "Chestnut", "Cloud", "Dumpling", "Puff", "Rice"] : ["布丁", "栗子", "云朵", "团团", "泡芙", "米粒"])[rng(6)],
        breedCount: 0,
        lastBredAt: null,
        residence: "home",
        activeDays: [dayKey(now)],
        breedHistory: [],
        residenceHistory: [],
      };
      state.eggs.splice(index, 1);
      state.pets.push(pet);
      state.activePetId = pet.id;
      break;
    }
    case "rename": {
      const pet = state.pets.find((x) => x.id === command.petId);
      const name = typeof command.name === "string" ? command.name.trim() : "";
      if (
        !pet ||
        !name ||
        [...name].length > 12 ||
        /[\u0000-\u001f]/.test(name)
      )
        throw new Error("名字需要 1–12 个可见字符。");
      pet.name = name;
      break;
    }
    case "select": {
      if (!housePets(state).some((x) => x.id === command.petId))
        throw new Error("没有找到这只宠物。");
      state.activePetId = command.petId;
      break;
    }
    case "breed": {
      room(state);
      const pet = state.pets.find((x) => x.id === command.petId);
      const partner = PARTNERS.find((x) => x.id === command.partnerId);
      if (!pet || !partner) throw new Error("请选择两位有效的繁育伙伴。");
      const eligibility = breedingEligibility(pet, now, state);
      if (!eligibility.allowed) throw new Error(eligibility.reason);
      entry(state, -partner.fee, "breeding", `与${partner.name}繁育`, now, id);
      state.eggs.push({
        id: id(),
        genome: inheritGenome(pet.genome, partner.genome, rng),
        skills: drawSkills(rng, petSkills(pet), petSkills(partner)),
        talent: drawTalent(
          rng,
          pet.talent,
          partner.talent ?? { id: "dance", level: 1 },
        ),
        birthRules: "inheritance-v3",
        createdAt: now,
        readyAt: now + RULES.incubationMs,
        parents: [
          {
            id: pet.id,
            name: pet.name,
            genome: pet.genome,
            talent: { ...pet.talent },
            skills: { ...petSkills(pet) },
          },
          {
            id: partner.id,
            name: partner.name,
            genome: partner.genome,
            talent: { ...partner.talent },
            skills: { ...petSkills(partner) },
          },
        ],
        generation: pet.generation + 1,
        origin: "繁育蛋",
      });
      pet.lastBredAt = now;
      pet.breedCount += 1;
      pet.breedHistory.push(now);
      break;
    }
    case "train": {
      const pet = state.pets.find((p) => p.id === command.petId);
      if (!pet || pet.residence === "garden")
        throw new Error("请先接回小屋再练习。");
      const cost = trainingCost(pet);
      if (cost === null) throw new Error("这项才艺已经练到拿手了。");
      entry(state, -cost, "training", `${pet.name}的才艺课程`, now, id);
      pet.talent.level++;
      break;
    }
    case "expand": {
      if (state.capacity >= RULES.maxSlots)
        throw new Error("当前版本最多支持 12 个位置。");
      entry(
        state,
        -expansionCost(state),
        "expansion",
        "扩建一个饲养位置",
        now,
        id,
      );
      state.capacity += 1;
      break;
    }
    case "observe": {
      observeUsage(state, command.report, now);
      const day = command.report.days.find((d) => d.date === dayKey(now));
      if (command.report.complete && command.report.fresh && day?.tokens > 0)
        recordCompanionDay(state, now);
      break;
    }
    case "visit":
      recordCompanionDay(state, now);
      break;
    case "garden": {
      const pet = state.pets.find((p) => p.id === command.petId);
      if (!pet || pet.residence === "garden")
        throw new Error("这位伙伴已经在后花园休息了。");
      if (reservedPet(state, pet.id))
        throw new Error("请先完成或取消正在等待的局域网配种。");
      pet.residence = "garden";
      pet.gardenSince = now;
      pet.residenceHistory.push({ type: "garden", at: now });
      if (state.activePetId === pet.id)
        state.activePetId = housePets(state)[0]?.id ?? null;
      break;
    }
    case "return-home": {
      const pet = state.pets.find((p) => p.id === command.petId);
      if (!pet || pet.residence !== "garden")
        throw new Error("这位伙伴已经在小屋里。");
      room(state);
      pet.residence = "home";
      pet.gardenSince = null;
      pet.residenceHistory.push({ type: "home", at: now });
      state.activePetId = pet.id;
      recordCompanionDay(state, now);
      break;
    }
    case "claim": {
      if (!state.settings.connected) throw new Error("请先连接本地用量。");
      const amount = availableReward(state, now);
      if (!amount)
        throw new Error("今天暂时没有新的奖励，正常使用 AI 后再来看看。");
      state.usage.days[dayKey(now)].claimed += amount;
      entry(state, amount, "usage", "Codex 本地用量奖励", now, id);
      break;
    }
    case "connect":
      state.settings.connected = true;
      break;
    case "disconnect":
      state.settings.connected = false;
      break;
    case "float":
      state.settings.floating = Boolean(command.value);
      break;
    case "activity":
      if (typeof command.enabled !== "boolean" || typeof command.topics !== "boolean")
        throw new Error("请选择有效的会话联动设置。");
      state.settings.activityEnabled = command.enabled;
      state.settings.activityTopics = command.topics;
      break;
    case "idle-settings":
      if (typeof command.enabled !== "boolean" || typeof command.toys !== "boolean" || !IDLE_ROUTES.includes(command.route))
        throw new Error("请选择有效的待机玩法。");
      state.settings.idleEnabled = command.enabled;
      state.settings.idleRoute = command.route;
      state.settings.idleToys = command.toys;
      break;
    case "pet-scale":
      if (!Number.isInteger(command.percent) || command.percent < 50 || command.percent > 100)
        throw new Error("宠物尺寸可在 50%–100% 之间调整。");
      state.settings.petScale = command.percent / 100;
      break;
    case "quota-settings":
      if (typeof command.enabled !== "boolean" || !QUOTA_WINDOWS.includes(command.window)) throw new Error("请选择有效的额度显示方式。");
      state.settings.quotaEnabled = command.enabled;
      state.settings.quotaWindow = command.window;
      break;
    case "language":
      if (!LANGUAGES.includes(command.value)) throw new Error("请选择有效的语言。");
      state.settings.language = command.value;
      break;
    case "tray-compact":
      if (typeof command.value !== "boolean") throw new Error("操作无效。");
      state.settings.trayCompact = command.value;
      break;
    default:
      throw new Error("不支持的操作。");
  }
  return state;
}
