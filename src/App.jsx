import React, { useEffect, useState, useRef } from "react";
import { setLanguage, localeTag, t, f } from "./i18n/locale.js";
import RawText from "./i18n/RawText.jsx";
import { describe } from "./i18n/metadata.js";
import {
  PawPrint,
  House,
  Dna,
  Heart,
  ChartNoAxesCombined,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Coins,
  Sparkles,
  Check,
  RefreshCw,
  X,
  ShieldCheck,
  ChevronRight,
  CircleHelp,
  Download,
  Monitor,
  Plug,
  Leaf,
  Egg as EggIcon,
  Clock3,
  Pencil,
  LockKeyhole,
  CheckCircle2,
  Sprout,
  Wind,
  MoreHorizontal,
  MessageCircle,
  GripHorizontal,
  Music,
  Wifi,
} from "lucide-react";
import Cat from "./components/Cat.jsx";
import Egg from "./components/Egg.jsx";
import TalentRoom from "./components/TalentRoom.jsx";
import PetSizeControl from "./components/PetSizeControl.jsx";
import QuotaSettings from "./components/QuotaSettings.jsx";
import SocialScene from "./components/SocialScene.jsx";
import SkillOdds from "./components/SkillOdds.jsx";
import { skillById } from "../core/skills.mjs";
import Nearby from "./components/Nearby.jsx";
import { talentById, talentOdds } from "../core/talents.mjs";
import Garden from "./components/Garden.jsx";
import GeneCatalog, { RarityBadge } from "./components/GeneCatalog.jsx";
import {
  phenotype,
  TRAITS,
  LABELS,
  PARTNERS,
  inheritanceOptions,
  GENE_KEYS,
  geneOdds,
  formatChance,
  rarestTrait,
} from "../core/genetics.mjs";
import {
  dayKey,
  availableReward,
  housePets,
  gardenPets,
  usedSlots,
  expansionCost,
  companionDays,
  breedingEligibility,
} from "../core/economy.mjs";

const api = window.pawprint;
const money = (value) => (value == null ? "—" : `$${value.toFixed(2)}`);
const compact = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
const tabs = [
  ["home", House, "我的小屋"],
  ["collection", PawPrint, "宠物图鉴"],
  ["garden", Leaf, "后花园"],
  ["talents", Music, "才艺小剧场"],
  ["nearby", Wifi, "附近的小屋"],
  ["genes", Dna, "基因图鉴"],
  ["breed", Heart, "繁育计划"],
  ["usage", ChartNoAxesCombined, "用量与钱包"],
];
const titles = {
  home: ["我的小屋", "一点点努力，一点点长大。"],
  collection: ["宠物图鉴", "每一份不同，都有迹可循。"],
  talents: ["才艺小剧场", "每一只，都有自己的拿手好戏。"],
  nearby: ["附近的小屋", "邀请同事的伙伴，一起玩一会儿。"],
  garden: ["后花园", "休息的时候，也有一个温暖的家。"],
  genes: ["基因图鉴", "看见所有可能，也看懂每一次相遇的概率。"],
  breed: ["繁育计划", "两份独特，遇见新的可能。"],
  usage: ["用量与钱包", "让日常工作，留下可爱的回响。"],
  settings: ["偏好设置", "一个安静、只属于你的角落。"],
};
function Coin({ amount, className = "" }) {
  return (
    <span className={`coin ${className}`}>
      <Coins size={16} />
      {amount}
    </span>
  );
}
function Chip({ children, className = "" }) {
  return <span className={`chip ${className}`}>{children}</span>;
}

export default function App() {
  const [state, setRawState] = useState(null);
  const setState = value => { setLanguage(value?.settings?.language); setRawState(value); };
  const [tab, setTab] = useState(() =>
    titles[window.location.hash.slice(1)]
      ? window.location.hash.slice(1)
      : "home",
  );
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState("");
  const [tick, setTick] = useState(Date.now());
  const [petting, setPetting] = useState(false);
  const [partnerId, setPartnerId] = useState(PARTNERS[0].id);
  const drag = useRef(null);
  const wasDragged = useRef(false);
  const guestId = window.location.hash.startsWith("#guest:")
    ? window.location.hash.slice(7)
    : null;
  const isFloating = window.location.hash === "#floating";
  const todayKey = dayKey(tick);
  const reward = state ? availableReward(state, tick) : 0;
  useEffect(
    () =>
      api?.onNavigate((section) => {
        if (titles[section]) setTab(section);
      }),
    [],
  );
  useEffect(() => {
    if (!api || !isFloating) return;
    let previous = null;
    const update = (active) => {
      if (active !== previous) {
        api.setInteractive(active);
        previous = active;
      }
    };
    const move = (event) =>
      update(Boolean(event.target.closest("[data-interactive]")));
    const leave = () => update(false);
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseleave", leave);
    update(false);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseleave", leave);
    };
  }, [isFloating]);
  useEffect(() => {
    if (!api) return;
    api
      .getState()
      .then((result) =>
        result.ok
          ? setState(result.data)
          : setToast({ text: result.error, error: true }),
      );
    return api.onState(setState);
  }, []);
  useEffect(() => api?.onIdle(idle => setRawState(previous => previous ? { ...previous, idle } : previous)), []);
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!petting) return;
    const id = setTimeout(() => setPetting(false), 2200);
    return () => clearTimeout(id);
  }, [petting]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const handler = (e) => {
      if (e.key === "Escape") setModal(null);
      if (e.key !== "Tab") return;
      const nodes = [
        ...document.querySelectorAll(
          '.modal button:not(:disabled), .modal input, .modal [tabindex="0"]',
        ),
      ];
      if (!nodes.length) return;
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0].focus();
      }
    };
    const timer = setTimeout(
      () => document.querySelector(".modal input, .modal button")?.focus(),
      30,
    );
    document.addEventListener("keydown", handler);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal]);
  async function command(payload, message) {
    if (working) return;
    setWorking(true);
    try {
      const result = await api.command(payload);
      if (!result.ok) throw new Error(result.error);
      setState(result.data);
      if (message) setToast({ text: message });
      return result.data;
    } catch (error) {
      setToast({ text: error.message, error: true });
    } finally {
      setWorking(false);
    }
  }
  async function refresh() {
    try {
      const result = await api.refreshUsage();
      if (result.ok) setState(result.data);
      else throw new Error(result.error);
    } catch (error) {
      setToast({ text: error.message, error: true });
    }
  }
  async function hatch(egg) {
    const next = await command({ type: "hatch", eggId: egg.id });
    if (next) {
      const pet = next.pets.find((p) => p.id === egg.id);
      setName(pet.name);
      setModal({ type: "welcome", pet });
    }
  }
  if (!api)
    return (
      <div className="boot">
        <PawPrint size={40} />
        <h1>爪印 · Pawprint</h1>
        <p>请通过桌面应用打开，以访问安全的本地用量与存档。</p>
        <code>npm run dev</code>
      </div>
    );
  if (!state)
    return (
      <div className="boot">
        <PawPrint size={40} />
        <p>{toast?.text || "正在打开你的小屋…"}</p>
      </div>
    );
  const residents = housePets(state);
  const resting = gardenPets(state);
  const pet = residents.find((p) => p.id === state.activePetId) || residents[0];
  const pendingEgg = state.eggs[0];
  const partner = PARTNERS.find((p) => p.id === partnerId);
  const today = state.usage.report?.days.find((d) => d.date === todayKey);
  const claimed = state.usage.days[todayKey]?.claimed || 0;
  const occupied = usedSlots(state);
  const full = occupied >= state.capacity;
  const expansion = expansionCost(state);
  const eligibility = breedingEligibility(pet, tick, state);
  const sleepingHouse = !pet && !pendingEgg && state.freeEggClaimed;
  const issued = state.ledger.reduce((n, r) => n + Math.max(0, r.amount), 0);
  const spent = state.ledger.reduce((n, r) => n + Math.max(0, -r.amount), 0);
  const transferred = state.ledger.reduce(
    (sum, row) => sum + (row.amount < 0 ? (row.peerTransfer ?? 0) : 0),
    0,
  );
  const burned = spent - transferred;
  function greetPet() {
    setPetting(true);
    void api.command({ type: "visit" }).then((r) => {
      if (r.ok) setState(r.data);
    });
  }
  const spending = state.availableCoins ?? state.balance;
  const playing =
    pet &&
    state.performance?.petId === pet.id &&
    !state.performance.guestId &&
    tick - state.performance.at < (state.performance.duration || 6000);
  const activityWorking = state.activity?.status === "running";
  const idle = activityWorking || playing || petting ? { mode: "rest", facing: 1, edge: "bottom" } : state.idle || { mode: "rest", facing: 1, edge: "bottom" };
  const desktopStyle = { width: 220, height: 242, transform: `scale(${state.displayScale || 1})`, transformOrigin: "top left", "--desktop-pet-scale": state.displayScale || 1 };
  async function playSkill(id, skillId) {
    const result = await api.performSkill(id, skillId);
    if (result.ok) setState(result.data); else setToast({ text: result.error, error: true });
  }
  async function takeBall() {
    const result = await api.playBall();
    if (result.ok) setState(result.data);
    else setToast({ text: result.error, error: true });
  }
  async function performPet(id, gid) {
    const r = await api.perform(id, gid);
    if (r.ok) setState(r.data);
    else setToast({ text: r.error, error: true });
  }
  async function lanAction(action) {
    if (working) return false;
    setWorking(true);
    try {
      const r = await api.lan(action);
      if (!r.ok) throw new Error(r.error);
      setState(r.data);
      if (action.type === "copy")
        setToast({ text: "连接码已复制，发给你信任的同事即可" });
      return true;
    } catch (e) {
      setToast({ text: e.message, error: true });
      return false;
    } finally {
      setWorking(false);
    }
  }
  const warn =
    state.usage.lastError ||
    (state.usage.report && !state.usage.report.complete
      ? "用量历史还在扫描，暂不兑换。请稍后刷新。"
      : state.usage.report?.unpriced > 0
        ? "部分记录缺少完整计价信息，受影响日期暂不发放新增奖励。"
        : state.usage.report && !state.usage.report.fresh
          ? "报告已过期，请刷新本地用量。"
          : null);
  function traits(pet, all = false) {
    const p = phenotype(pet.genome);
    return (
      <div className="traits">
        {Object.keys(TRAITS)
          .slice(0, all ? GENE_KEYS.length : 4)
          .map((k) => (
            <Chip key={k}>
              {k === "coat" && (
                <i style={{ background: TRAITS.coat[p.coat].color }} />
              )}{" "}
              {TRAITS[k][p[k]].name}
            </Chip>
          ))}
      </div>
    );
  }
  function geneButton(p) {
    return (
      <button
        className="text-button"
        onClick={() => setModal({ type: "genes", pet: p })}
      >
        <Dna size={15} /> 查看基因 <ChevronRight size={14} />
      </button>
    );
  }
  function connectButton() {
    return (
      <button
        className="button primary"
        disabled={working}
        onClick={() => setModal({ type: "connect" })}
      >
        <Plug size={16} />
        连接本地用量
      </button>
    );
  }
  function claimButton() {
    return (
      <button
        className="button primary"
        disabled={working || !reward || !state.settings.connected}
        onClick={() => command({ type: "claim" }, `领取了 ${reward} 枚宠物币`)}
      >
        <Coins size={16} />
        {reward
          ? `领取 ${reward} 宠物币`
          : claimed
            ? "今日奖励已领取"
            : "暂时没有可领取奖励"}
      </button>
    );
  }
  if (guestId) {
    const visitor = state.lan?.visitors.find((v) => v.id === guestId);
    if (!visitor) return <div className="floating-pet minimal" />;
    if (state.socialPerformance?.visitId === guestId)
      return <div style={{ ...desktopStyle, width: 420 }}><SocialScene scene={state.socialPerformance} onEnd={() => lanAction({ type: "end-social" })} /></div>;
    const show =
      state.performance?.guestId === guestId &&
      tick - state.performance.at < 6000;
    return (
      <div className="floating-pet minimal" style={desktopStyle}>
        <button
          className="float-cat-button"
          aria-label="来访宠物"
          title={`来自${visitor.peerName} · 双击查看 · 右键送回家`}
          onDoubleClick={() => api.showHome("nearby")}
          onContextMenu={(e) => {
            e.preventDefault();
            api.guestMenu(guestId);
          }}
          onClick={() => performPet(visitor.pet.id, guestId)}
        >
          <Cat
            key={state.performance?.at}
            genome={visitor.pet.genome}
            talentId={show ? visitor.pet.talent.id : null}
            talentLevel={visitor.pet.talent.level}
          />
        </button>
      </div>
    );
  }
  if (isFloating)
    return (
      <div className={`floating-pet minimal idle-${idle.mode}`} data-idle-mode={idle.mode} style={desktopStyle}>
        <button
          className={`float-cat-button ${pet ? "" : "float-egg-button"}`}
          data-interactive
          aria-label={pet ? "桌面宠物" : "桌面宠物蛋"}
          title="拖动移动 · 双击打开小屋 · 右键菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            api.showMenu();
          }}
          onDoubleClick={() => {
            if (!wasDragged.current) api.showHome("home");
          }}
          onClick={() => {
            if (!wasDragged.current) greetPet();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            wasDragged.current = false;
            drag.current = {
              x: event.screenX,
              y: event.screenY,
              active: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            if (
              !start.active &&
              Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4
            ) {
              start.active = true;
              wasDragged.current = true;
              api.dragPet({ phase: "start", x: start.x, y: start.y });
            }
            if (start.active)
              api.dragPet({
                phase: "move",
                x: event.screenX,
                y: event.screenY,
              });
          }}
          onPointerUp={() => {
            if (drag.current?.active) api.dragPet({ phase: "end" });
            drag.current = null;
          }}
          onPointerCancel={() => {
            api.dragPet({ phase: "end" });
            drag.current = null;
          }}
        >
          {pet ? (
            <div className={`idle-actor edge-${idle.edge || "bottom"}`} style={{ "--pet-facing": idle.facing || 1 }}>
            <Cat
              genome={pet.genome}
              className={activityWorking && !playing && !petting ? "working" : `idle-pose-${idle.mode}`}
              mood={petting ? "happy" : "idle"}
              talentId={playing && !state.performance.skillId ? pet.talent.id : null}
              skillId={playing ? state.performance.skillId : idle.mode !== "ball" && skillById(idle.mode)?.category === "idle" ? idle.mode : null}
              talentLevel={pet.talent.level}
            />
            </div>
          ) : (
            <Egg ready={!pendingEgg || tick >= pendingEgg.readyAt} />
          )}
        </button>
        {pet && idle.mode === "ball" && <div className="toy-ball" key={idle.startedAt} aria-label="宠物玩具球" role="img">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="17" fill="#dda366" stroke="#a77543" strokeWidth="2" />
            <path d="M5 12Q21 19 35 12M5 28Q21 20 35 28M20 3Q8 20 20 37M20 3Q32 20 20 37" fill="none" stroke="#fff4d6" strokeWidth="3" />
            <ellipse cx="14" cy="10" rx="5" ry="3" fill="#fff" opacity=".4" />
          </svg>
        </div>}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand">
          <div className="brand-icon">
            <PawPrint size={27} fill="currentColor" />
          </div>
          <div>
            <strong>爪印</strong>
            <span>PAWPRINT</span>
          </div>
        </div>
        <div className="nav-caption">你的陪伴空间</div>
        <nav>
          {tabs.map(([id, Icon, label]) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              {label}
              {id === "collection" && state.pets.length > 0 && (
                <span className="nav-count">{state.pets.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <Sprout size={23} />
            <strong>慢慢来，也很好</strong>
            <p>
              你专心做事，
              <br />
              小家伙陪你长大。
            </p>
            <span className="tiny-leaf">✦</span>
          </div>
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <Settings size={18} />
            偏好设置
          </button>
          <div className="version">
            <i />
            本地养成版 <span>v0.11.5</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            我的空间 <ChevronRight size={13} /> {titles[tab][0]}
          </span>
          <div className="topbar-right">
            <span className="local-badge">
              <ShieldCheck size={14} />
              {state.lan?.enabled ? "局域网已开启" : "本机存档"}
            </span>
            <button
              className="wallet-pill"
              onClick={() => setTab("usage")}
              aria-label="查看钱包"
            >
              <Coins size={17} />
              <strong>{state.balance}</strong>
              <span>宠物币</span>
            </button>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div>
              <h1>{titles[tab][0]}</h1>
              <p>{titles[tab][1]}</p>
            </div>
            {tab === "home" ? (
              <button
                className="button secondary small"
                disabled={working}
                onClick={() =>
                  command({ type: "float", value: !state.settings.floating })
                }
              >
                <Monitor size={16} />
                {state.settings.floating ? "收起桌面宠物" : "放到桌面"}
              </button>
            ) : (
              <span className="edition">LOCAL COMPANION</span>
            )}
          </div>
          {tab === "home" && (
            <>
              <div className="home-grid">
                <section className="habitat">
                  <div className="habitat-top">
                    <Chip>
                      <span className="live-dot" />
                      {pet ? "阳光小屋" : "初遇时刻"}
                    </Chip>
                    <span className="weather">
                      <Wind size={15} />
                      适合发呆的一天
                    </span>
                  </div>
                  <div className="scene">
                    <div className="sun-circle" />
                    <div className="scene-hill one" />
                    <div className="scene-hill two" />
                    <div className="window-frame">
                      <div />
                      <div />
                      <div />
                      <div />
                    </div>
                    <div className="plant">
                      <span />
                      <span />
                      <span />
                      <i />
                    </div>
                    <div className="rug" />
                    <div className="scene-spark s1">✦</div>
                    <div className="scene-spark s2">✧</div>
                    {pet ? (
                      <button
                        className="stage-pet"
                        aria-label={`摸摸${pet.name}`}
                        onClick={greetPet}
                      >
                        <Cat
                          key={state.performance?.at}
                          genome={pet.genome}
                          talentId={playing && !state.performance.skillId ? pet.talent.id : null}
                          skillId={playing ? state.performance.skillId : null}
                          talentLevel={pet.talent.level}
                          mood={petting ? "happy" : "idle"}
                          label={describe(pet.genome)}
                        />
                      </button>
                    ) : (
                      <div className="stage-egg">
                        {sleepingHouse ? (
                          <div className="resting-house">
                            <Leaf size={53} strokeWidth={1.1} />
                          </div>
                        ) : (
                          <Egg
                            ready={!pendingEgg || tick >= pendingEgg.readyAt}
                          />
                        )}
                      </div>
                    )}
                    {petting && (
                      <div className="pet-bubble">喵，喜欢和你待在一起 ♡</div>
                    )}
                    <div className="scene-caption">
                      {pet ? (
                        <>
                          <span className="pet-name">
                            <RawText>{pet.name}</RawText>
                            <button
                              aria-label="修改名字"
                              onClick={() => {
                                setName(pet.name);
                                setModal({ type: "rename", pet });
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                          </span>
                          <p>
                            {petting
                              ? "这就是今天的小确幸。"
                              : "正在认真地……陪你发呆。"}
                          </p>
                        </>
                      ) : (
                        <>
                          <h2>
                            {sleepingHouse
                              ? "留一片阳光，等伙伴回来"
                              : "有个小家伙，在等你"}
                          </h2>
                          <p>
                            {sleepingHouse
                              ? "后花园里的伙伴，随时可以接回小屋。"
                              : "第一份陪伴，从一枚小小的蛋开始。"}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="habitat-bottom">
                    <span>
                      <Heart size={14} />{" "}
                      {pet ? "点一下，摸摸它" : "每一只，都有自己的基因组合"}
                    </span>
                    {pet ? (
                      <span>第 {pet.generation} 代 · 猫咪</span>
                    ) : !state.freeEggClaimed ? (
                      <button
                        className="button primary small"
                        disabled={working}
                        onClick={() =>
                          command(
                            { type: "free-egg" },
                            "初遇蛋已来到小屋，现在可以孵化了",
                          )
                        }
                      >
                        免费领取初遇蛋 <ArrowRight size={15} />
                      </button>
                    ) : pendingEgg ? (
                      <button
                        className="button primary small"
                        disabled={working || tick < pendingEgg.readyAt}
                        onClick={() => hatch(pendingEgg)}
                      >
                        {tick < pendingEgg.readyAt
                          ? "温暖孵化中"
                          : "迎接小家伙"}
                        <Sparkles size={15} />
                      </button>
                    ) : sleepingHouse ? (
                      <button
                        className="button secondary small"
                        onClick={() => setTab("garden")}
                      >
                        去后花园看看 <ArrowRight size={14} />
                      </button>
                    ) : null}
                  </div>
                </section>
                <div className="home-rail">
                  <section className="card identity-card">
                    <div className="card-title">
                      <h3>{pet ? "它的小档案" : "写在基因里的不同"}</h3>
                      <Dna size={18} />
                    </div>
                    {pet ? (
                      <>
                        <div className="identity-name">
                          <RawText>{pet.name}</RawText>
                          <Chip>第 {pet.generation} 代</Chip>
                        </div>
                        <p className="muted small-copy">
                          {describe(pet.genome)}
                        </p>
                        {traits(pet, true)}
                        <button
                          className="text-button"
                          onClick={() => performPet(pet.id)}
                        >
                          <Music size={14} />
                          {talentById(pet.talent.id)?.name} · 表演一下
                        </button>
                        <p className="growth-note">
                          {companionDays(pet, tick) >=
                          state.rules.matureActiveDays
                            ? "已成年"
                            : `成长中 · 陪伴 ${companionDays(pet, tick)}/${state.rules.matureActiveDays} 个活跃日`}
                        </p>
                        <div className="identity-footer">
                          {geneButton(pet)}
                          <span>{GENE_KEYS.length} 组基因</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="gene-dots">
                          {TRAITS.coat.map((c) => (
                            <i key={c.name} style={{ background: c.color }} />
                          ))}
                        </div>
                        <h4>毛色、眼睛、斑点…</h4>
                        <p className="muted">
                          16 组可遗传特征，
                          <br />
                          组合出属于你的猫咪。
                        </p>
                        <div className="note-line">
                          <Dna size={15} />
                          外貌可以被看见，也可以被传承
                        </div>
                      </>
                    )}
                  </section>
                  <section className="card nest-card">
                    <div className="card-title">
                      <h3>孵化角落</h3>
                      <span className="muted">{state.eggs.length} 枚蛋</span>
                    </div>
                    {pendingEgg ? (
                      <>
                        <div className="nest-body">
                          <Egg ready={tick >= pendingEgg.readyAt} />
                          <div>
                            <strong>{pendingEgg.origin}</strong>
                            <p>
                              {tick >= pendingEgg.readyAt
                                ? "小家伙准备好见你了"
                                : `还需 ${Math.ceil((pendingEgg.readyAt - tick) / 1000)} 秒`}
                            </p>
                            <button
                              className="text-button"
                              disabled={working || tick < pendingEgg.readyAt}
                              onClick={() => hatch(pendingEgg)}
                            >
                              立即孵化 <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="empty-nest">
                          <EggIcon size={30} strokeWidth={1.3} />
                          <div>
                            <strong>留一个位置给惊喜</strong>
                            <p>下一位小伙伴，会是什么模样？</p>
                          </div>
                        </div>
                        <button
                          className="button secondary full"
                          disabled={
                            working || full || spending < state.rules.eggPrice
                          }
                          onClick={() =>
                            command({ type: "buy-egg" }, "探索蛋正在温暖孵化")
                          }
                        >
                          领养探索蛋 <Coin amount={state.rules.eggPrice} />
                        </button>
                      </>
                    )}
                  </section>
                </div>
              </div>
              <section className="card usage-strip">
                <div className="usage-strip-icon">
                  <ChartNoAxesCombined size={23} />
                </div>
                <div className="usage-strip-text">
                  <h3>把今天的努力，变成一点奖励</h3>
                  <p>
                    {state.settings.connected
                      ? `今日 ${compact(today?.tokens)} token · 按模型价格估算 ${money(today?.usd)}`
                      : "连接本机 Codex 记录，让日常使用变成宠物币。"}
                  </p>
                </div>
                <div className="strip-reward">
                  <span>今日已领取</span>
                  <strong>
                    {claimed}
                    <small> / 120</small>
                  </strong>
                </div>
                {state.settings.connected ? claimButton() : connectButton()}
              </section>
              {warn && (
                <div className="notice">
                  <CircleHelp size={16} />
                  {warn}
                  <button onClick={() => setTab("usage")}>查看用量</button>
                </div>
              )}
              <div className="bottom-grid">
                <button
                  className="breeding-callout"
                  onClick={() => setTab("breed")}
                >
                  <div className="pair-icons">
                    <Heart size={23} />
                    <Dna size={22} />
                  </div>
                  <div>
                    <span className="eyebrow">GENES MEET POSSIBILITY</span>
                    <h3>遇见另一份独特</h3>
                    <p>挑选繁育伙伴，看看下一代的可能。</p>
                  </div>
                  <ArrowUpRight size={23} />
                </button>
                <section className="capacity-card">
                  <div>
                    <span className="eyebrow">小屋入住</span>
                    <strong>
                      {occupied}
                      <small> / {state.capacity}</small>
                    </strong>
                  </div>
                  <div className="slot-dots">
                    {Array.from({ length: state.capacity }, (_, i) => (
                      <span className={i < occupied ? "filled" : ""} key={i}>
                        <PawPrint size={15} />
                      </span>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    disabled={
                      working ||
                      spending < expansion ||
                      state.capacity >= state.rules.maxSlots
                    }
                    onClick={() =>
                      command({ type: "expand" }, "小屋多了一个温暖的位置")
                    }
                  >
                    扩建位置 <Coin amount={expansion} />
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === "genes" && <GeneCatalog onBreed={() => setTab("breed")} />}
          {tab === "talents" && (
            <TalentRoom
              state={state}
              now={tick}
              working={working}
              onPerform={(id) => performPet(id)}
              onSkill={playSkill}
              onNearby={() => setTab("nearby")}
              onTrain={(id) =>
                command(
                  { type: "train", petId: id },
                  "课程完成，试试新的表演吧",
                )
              }
              onSelect={(id) => command({ type: "select", petId: id })}
              onHome={() => setTab("home")}
            />
          )}
          {tab === "nearby" && (
            <Nearby
              state={state}
              now={tick}
              working={working}
              run={lanAction}
              onConsent={() => setModal({ type: "lan-consent" })}
            />
          )}
          {tab === "garden" && (
            <Garden
              state={state}
              working={working}
              now={tick}
              onGenes={(p) => setModal({ type: "genes", pet: p })}
              onCollection={() => setTab("collection")}
              onReturn={(p) =>
                command(
                  { type: "return-home", petId: p.id },
                  `${p.name}回到小屋了`,
                )
              }
            />
          )}
          {tab === "collection" && (
            <>
              <div className="section-toolbar">
                <div>
                  <Chip>{residents.length} 只在小屋</Chip>
                  <Chip>{resting.length} 只在后花园</Chip>
                  <Chip>{state.eggs.length} 枚蛋</Chip>
                  <Chip>{state.capacity} 个位置</Chip>
                  <button
                    className="text-button"
                    onClick={() => setTab("garden")}
                  >
                    <Leaf size={14} />
                    去后花园看看
                  </button>
                </div>
                <button
                  className="button primary"
                  disabled={working || full || spending < state.rules.eggPrice}
                  onClick={() =>
                    command({ type: "buy-egg" }, "探索蛋已加入图鉴")
                  }
                >
                  <Plus size={16} />
                  领养探索蛋 <Coin amount={state.rules.eggPrice} />
                </button>
              </div>
              {!residents.length && !state.eggs.length ? (
                <div className="empty-state">
                  <Egg ready />
                  <h2>
                    {resting.length
                      ? "伙伴们正在后花园休息"
                      : "图鉴的第一页，留给第一次相遇"}
                  </h2>
                  <p>
                    {resting.length
                      ? "去看看它们，有空位就能免费接回来。"
                      : "免费领取一枚蛋，让第一只猫咪来到你的小屋。"}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setTab("home")}
                  >
                    回到小屋 <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="collection-grid">
                  {residents.map((p) => (
                    <article
                      className={`card pet-card ${pet?.id === p.id ? "selected" : ""}`}
                      key={p.id}
                    >
                      <div className="pet-card-art">
                        <Chip>GEN {String(p.generation).padStart(2, "0")}</Chip>
                        {pet?.id === p.id && (
                          <span className="resident">
                            <Check size={12} />
                            正在陪伴
                          </span>
                        )}
                        <Cat
                          genome={p.genome}
                          label={`${p.name}，${describe(p.genome)}`}
                        />
                      </div>
                      <div className="pet-card-info">
                        <h3><RawText>{p.name}</RawText></h3>
                        <p>{describe(p.genome)}</p>
                        {traits(p)}
                        <p className="growth-note">
                          {companionDays(p, tick) >=
                          state.rules.matureActiveDays
                            ? "已成年"
                            : `成长中 · 陪伴 ${companionDays(p, tick)}/${state.rules.matureActiveDays} 个活跃日`}
                        </p>
                        <button
                          className="text-button garden-place"
                          disabled={working}
                          onClick={() => setModal({ type: "garden", pet: p })}
                        >
                          <Leaf size={13} />
                          去后花园生活
                        </button>
                        <div className="pet-card-actions">
                          {geneButton(p)}
                          <button
                            className="text-button"
                            disabled={working || pet?.id === p.id}
                            onClick={() =>
                              command(
                                { type: "select", petId: p.id },
                                `${p.name}正在小屋等你`,
                              )
                            }
                          >
                            到小屋陪我 <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {state.eggs.map((e) => (
                    <article className="card pet-card egg-card" key={e.id}>
                      <Egg ready={tick >= e.readyAt} />
                      <h3>{e.origin}</h3>
                      <p>
                        {e.parents.length
                          ? `${e.parents[0].name} × ${e.parents[1].name}`
                          : "藏着一份还没见过的可爱"}
                      </p>
                      <button
                        className="button primary"
                        disabled={working || tick < e.readyAt}
                        onClick={() => hatch(e)}
                      >
                        {tick >= e.readyAt
                          ? "迎接小家伙"
                          : `孵化中 · ${Math.ceil((e.readyAt - tick) / 1000)} 秒`}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "breed" && (
            <>
              <div className="info-banner">
                <Leaf size={18} />
                <div>
                  <strong>系统伙伴 · 本地繁育</strong>
                  <span>
                    陪伴满 3 个活跃日后成年；繁育间隔 48 小时，连续 7 天内最多 2
                    次。每天打开或摸摸伙伴、有本机用量，都可记 1 个陪伴日。
                  </span>
                </div>
              </div>
              {!pet ? (
                <div className="empty-state">
                  <Heart size={44} />
                  <h2>
                    {resting.length
                      ? "先接一位伙伴回小屋"
                      : "先迎接你的第一只宠物"}
                  </h2>
                  <p>小屋中的伙伴陪伴满 3 个活跃日后，即可安排繁育。</p>
                  <button
                    className="button primary"
                    onClick={() => setTab("home")}
                  >
                    去孵化 <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="breed-stage card">
                    <div className="parent">
                      <span className="eyebrow">你的猫咪</span>
                      <Cat genome={pet.genome} />
                      <select
                        aria-label="选择自己的宠物"
                        value={pet.id}
                        onChange={(e) =>
                          command({ type: "select", petId: e.target.value })
                        }
                      >
                        {residents.map((p) => (
                          <option value={p.id} key={p.id} translate="no">
                            {f("{0} · 第 {1} 代", p.name, p.generation)}
                          </option>
                        ))}
                      </select>
                      <p>{describe(pet.genome)}</p>
                    </div>
                    <div className="breed-center">
                      <div className="heart-orbit">
                        <Heart size={32} />
                      </div>
                      <span>1 + 1 = 新的可能</span>
                      <div className="dashed-line" />
                      <EggIcon size={25} />
                      <p>第 {pet.generation + 1} 代</p>
                    </div>
                    <div className="parent">
                      <span className="eyebrow">系统繁育伙伴</span>
                      <Cat genome={partner.genome} />
                      <h3>{partner.name}</h3>
                      <p>{describe(partner.genome)}</p>
                      <span className="chip">
                        才艺：{talentById(partner.talent.id)?.name}
                      </span>
                    </div>
                  </div>
                  <div className="section-label">
                    <h3>选择一位伙伴</h3>
                    <span>基因固定 · 没有隐藏加成</span>
                  </div>
                  <div className="partner-grid">
                    {PARTNERS.map((p) => (
                      <button
                        className={`partner-card ${p.id === partnerId ? "selected" : ""}`}
                        key={p.id}
                        onClick={() => setPartnerId(p.id)}
                      >
                        <Cat genome={p.genome} />
                        <div>
                          <h3>{p.name}</h3>
                          <p>{p.title}</p>
                          <Coin amount={p.fee} />
                        </div>
                        <span className="radio">
                          {p.id === partnerId && <Check size={12} />}
                        </span>
                      </button>
                    ))}
                  </div>
                  <section className="card genetics-preview">
                    <div className="card-title">
                      <h3>
                        <Dna size={17} />
                        后代外貌预测
                      </h3>
                      <span>各特征独立抽取</span>
                    </div>
                    <div className="prediction-grid">
                      {GENE_KEYS.map((k) => (
                        <div key={k}>
                          <span>{LABELS[k]}</span>
                          {inheritanceOptions(
                            pet.genome,
                            partner.genome,
                            k,
                          ).map((o) => (
                            <p key={o.value}>
                              {o.name}
                              <strong>{o.percent}%</strong>
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="talent-probabilities">
                      <h4>后代才艺概率</h4>
                      <div>
                        {talentOdds(pet.talent, partner.talent).map((t) => (
                          <span className="chip" key={t.id}>
                            {t.name} {formatChance(t.percent)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <SkillOdds a={pet} b={partner} />
                    <div className="breed-action">
                      <div>
                        <strong>
                          {full
                            ? "小屋已满，可安排后花园休养或扩建"
                            : !eligibility.allowed
                              ? eligibility.reason
                              : "准备好迎接下一代了吗？"}
                        </strong>
                        <p>孵化约 20 秒 · 系统费用退出流通</p>
                        {eligibility.readyAt && (
                          <p>
                            最早可繁育：
                            {new Date(eligibility.readyAt).toLocaleString(
                              localeTag(),
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        )}
                      </div>
                      <button
                        className="button primary"
                        disabled={
                          working ||
                          full ||
                          !eligibility.allowed ||
                          spending < partner.fee
                        }
                        onClick={async () => {
                          const next = await command(
                            { type: "breed", petId: pet.id, partnerId },
                            "一枚新的繁育蛋诞生了",
                          );
                          if (next) setTab("home");
                        }}
                      >
                        <Heart size={16} />
                        开始繁育 <Coin amount={partner.fee} />
                      </button>
                    </div>
                    {spending < partner.fee && (
                      <p className="shortfall">
                        还差 {partner.fee - spending} 宠物币，去领取用量奖励吧。
                      </p>
                    )}
                  </section>
                </>
              )}
            </>
          )}
          {tab === "usage" && (
            <>
              <div className="wallet-grid">
                <section className="wallet-card">
                  <span>我的宠物币</span>
                  <h2>
                    <Coins size={30} />
                    {state.balance}
                  </h2>
                  <p>只属于这台电脑的本地养成货币</p>
                  <div>
                    <LockKeyhole size={14} />
                    不接入交易市场，不兑换现金
                  </div>
                </section>
                <section className="card reward-card">
                  <div className="card-title">
                    <h3>今日用量奖励</h3>
                    <Chip>
                      {state.settings.connected ? "已连接" : "未连接"}
                    </Chip>
                  </div>
                  <div className="reward-number">
                    {claimed}
                    <span> / 120 币</span>
                  </div>
                  <div className="progress">
                    <i style={{ width: `${(claimed / 120) * 100}%` }} />
                  </div>
                  <div className="reward-action">
                    <p>
                      {reward
                        ? `还有 ${reward} 币可以领取`
                        : "正常使用 AI，让奖励慢慢积累"}
                    </p>
                    {state.settings.connected ? claimButton() : connectButton()}
                  </div>
                </section>
              </div>
              {state.heldCoins > 0 && (
                <div className="notice">
                  局域网配种预留 {state.heldCoins} 币，当前可用 {spending}{" "}
                  币。确认取消或配种完成后会结算。
                </div>
              )}
              <section className="card circulation-card">
                <div>
                  <span>累计获得</span>
                  <strong>{issued}</strong>
                </div>
                <div>
                  <span>已用于系统服务</span>
                  <strong>{burned}</strong>
                </div>
                <div>
                  <span>当前持有</span>
                  <strong>{state.balance}</strong>
                </div>
                <p>
                  探索蛋 {state.rules.eggPrice} 币 · 繁育{" "}
                  {Math.min(...PARTNERS.map((p) => p.fee))} 币起 · 扩建{" "}
                  {expansion} 币 · 后花园免费、不返币。累计支出 {spent} 币，其中{" "}
                  {transferred} 币付给同事；系统服务支出才退出流通。
                </p>
              </section>
              <section className="card report-card">
                <div className="card-title">
                  <div>
                    <h3>Codex 使用记录</h3>
                    <p>内置读取与计价 · API 等价费用，非实际订阅账单</p>
                  </div>
                  <button
                    className="button secondary small"
                    disabled={!state.settings.connected || state.busy}
                    onClick={refresh}
                  >
                    <RefreshCw className={state.busy ? "spin" : ""} size={15} />
                    {state.busy ? "读取中…" : "刷新用量"}
                  </button>
                </div>
                {warn && (
                  <div className="notice">
                    <CircleHelp size={16} />
                    {warn}
                  </div>
                )}
                <div className="usage-metrics">
                  <div>
                    <span>今日 token</span>
                    <strong>{compact(today?.tokens)}</strong>
                  </div>
                  <div>
                    <span>今日等价费用</span>
                    <strong>{money(today?.usd)}</strong>
                  </div>
                  <div>
                    <span>数据来源</span>
                    <strong className="source-label">
                      内置读取器 <span className="source-dot" />
                    </strong>
                  </div>
                </div>
                <UsageChart report={state.usage.report} today={todayKey} />
                <div className="model-list">
                  {today?.models.map((model) => (
                    <span key={model.name}>
                      {model.name}
                      <strong>{money(model.usd)}</strong>
                    </span>
                  ))}
                </div>
                {state.usage.report?.pricingVersion && (
                  <p className="pricing-note">
                    价格表 {state.usage.report.pricingVersion} ·
                    未标注服务档位按标准价估算。
                    {state.usage.report.diagnostics?.files === 0
                      ? " 暂无本机使用记录。"
                      : ""}
                  </p>
                )}
                <div className="report-footer">
                  <span>
                    {state.busy
                      ? "正在扫描本地历史，请稍候…"
                      : state.usage.report
                        ? `上次读取 ${new Date(state.usage.report.fetchedAt).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })} · 每 15 分钟自动刷新`
                        : "连接后显示最近 7 天的本机 Codex 记录"}
                  </span>
                  <ShieldCheck size={14} />
                </div>
              </section>
              <div className="wallet-bottom">
                <section className="card ledger-card">
                  <div className="card-title">
                    <h3>宠物币明细</h3>
                    <span>共 {state.ledger.length} 笔</span>
                  </div>
                  {!state.ledger.length ? (
                    <div className="ledger-empty">
                      <Coins size={26} />
                      <p>第一笔奖励，正在路上。</p>
                    </div>
                  ) : (
                    <div className="ledger-list">
                      {state.ledger.slice(0, 20).map((e) => (
                        <div className="ledger-row" key={e.id}>
                          <span
                            className={`ledger-icon ${e.amount > 0 ? "income" : ""}`}
                          >
                            {e.amount > 0 ? (
                              <ArrowUpRight size={17} />
                            ) : (
                              <EggIcon size={17} />
                            )}
                          </span>
                          <div>
                            <strong>{e.label}</strong>
                            <p>
                              {new Date(e.at).toLocaleString(localeTag(), {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <b className={e.amount > 0 ? "positive" : ""}>
                            {e.amount > 0 ? "+" : ""}
                            {e.amount}
                          </b>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="card rules-card">
                  <h3>奖励怎么计算？</h3>
                  <div className="rule-step">
                    <span>01</span>
                    <p>按输入、缓存与输出各自价格，得到 API 等价费用。</p>
                  </div>
                  <div className="rule-step">
                    <span>02</span>
                    <p>
                      每天前 $5 等价用量，每 $1 获得 20 币；之后每 $1 获得 2
                      币。
                    </p>
                  </div>
                  <div className="rule-step">
                    <span>03</span>
                    <p>
                      每天最多 120 币，累计取整。只领取今天，不补发以前日期。
                    </p>
                  </div>
                  <div className="rules-note">
                    单机经济 v2。估算金额不是实际付款，也不代表在线资产。
                  </div>
                </section>
              </div>
            </>
          )}
          {tab === "settings" && (
            <div className="settings-stack">
              <section className="card settings-card">
                <div className="setting-row">
                  <div><label htmlFor="interface-language"><strong>界面语言</strong></label><p>立即切换并保存，宠物名字与存档内容保持不变。</p></div>
                  <select id="interface-language" aria-label="界面语言" className="idle-route-select" value={state.settings.language || "zh"} disabled={working}
                    onChange={e => command({ type: "language", value: e.target.value })}>
                    <option value="zh" translate="no">简体中文</option><option value="en" translate="no">English</option>
                  </select>
                </div>
              </section>
              <section className="card settings-card">
                <h3>应用更新</h3>
                <div className="setting-row">
                  <div>
                    <strong>{state.update?.status === "available" ? (state.settings.language === "en" ? `Version ${state.update.release.version} is available` : `发现新版本 v${state.update.release.version}`) :
                      state.update?.status === "current" ? "当前已是最新版" :
                      state.update?.status === "unreleased" ? "尚无可用的公开版本" :
                      state.update?.status === "checking" ? "正在检查更新…" :
                      state.update?.status === "downloading" ? "正在下载并校验…" :
                      state.update?.status === "installing" ? "正在安装并重启…" :
                      state.update?.status === "error" ? (state.settings.language === "en" ? `Update failed: ${t(state.update.error)}` : `更新失败：${state.update.error}`) : "从 GitHub Release 检查新版本"}</strong>
                    <p>仅下载 Pawprint 官方仓库的 Apple 芯片 Mac 包；校验 SHA-256、应用标识和版本后安装。安装时会重启应用。</p>
                  </div>
                  <button className="secondary-button" disabled={["checking","downloading","installing"].includes(state.update?.status)} onClick={async () => {
                    const r = await api.checkUpdates();
                    if (!r.ok) setToast({text:r.error,error:true});
                  }}>检查更新</button>
                </div>
                {state.update?.status === "available" && <button className="primary-button" onClick={async () => {
                  const r = await api.installUpdate();
                  if (!r.ok) setToast({text:r.error,error:true});
                }}>{state.settings.language === "en" ? `Download and install v${state.update.release.version}` : `下载并安装 v${state.update.release.version}`}</button>}
              </section>
              <QuotaSettings state={state} now={tick} working={working} onCommand={command} onRecover={async () => {
                const r = await api.recoverTray();
                if (r.ok) setState(r.data); else setToast({ text: r.error, error: true });
              }} onRefresh={async () => {
                const r = await api.refreshQuota();
                if (r.ok) setState(r.data); else setToast({ text: r.error, error: true });
              }} />
              <section className="card settings-card">
                <h3>用量连接</h3>
                <div className="setting-row">
                  <div>
                    <strong>Codex 本地记录 · 内置读取</strong>
                    <p>
                      从本机记录提取
                      token、模型和时间，使用内置价格表估算；不保存对话正文，不接触登录凭据。
                    </p>
                  </div>
                  {state.settings.connected ? (
                    <button
                      className="button secondary"
                      disabled={working}
                      onClick={() =>
                        command(
                          { type: "disconnect" },
                          "已停止自动读取，已有宠物和币已保留",
                        )
                      }
                    >
                      断开连接
                    </button>
                  ) : (
                    connectButton()
                  )}
                </div>
                <div className="setting-row">
                  <div>
                    <strong>记录目录</strong>
                    <p>
                      自动查找本机 .codex；使用自定义目录时，可以在这里选择。
                    </p>
                    <code className="usage-directory" translate="no">
                      {state.usageDirectory}
                    </code>
                  </div>
                  <button
                    className="button secondary"
                    disabled={working}
                    onClick={async () => {
                      setWorking(true);
                      try {
                        const result = await api.chooseUsageDirectory();
                        if (result.ok) setState(result.data);
                        else setToast({ text: result.error, error: true });
                      } finally {
                        setWorking(false);
                      }
                    }}
                  >
                    选择记录目录
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>手动刷新用量</strong>
                    <p>连接后每 15 分钟自动读取；遇到错误可以手动重试。</p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!state.settings.connected || state.busy}
                    onClick={refresh}
                  >
                    <RefreshCw size={15} />
                    {state.busy ? "读取中…" : "现在刷新"}
                  </button>
                </div>
              </section>
              <section className="card settings-card">
                <h3>桌面陪伴</h3>
                <PetSizeControl value={Math.round((state.settings.petScale || 1) * 100)} onState={setState} onError={text => setToast({ text, error: true })} />
                <div className="setting-row">
                  <div>
                    <strong>待机散步与玩耍</strong>
                    <p>闲下来后走一会儿、展示自己的待机技能，偶尔玩球。鼠标靠近、拖动、会话进行或表演才艺时暂停，不花币。</p>
                  </div>
                  <button role="switch" aria-label="待机散步与玩耍"
                    aria-checked={state.settings.idleEnabled === true}
                    className={`toggle ${state.settings.idleEnabled ? "on" : ""}`}
                    disabled={working}
                    onClick={() => command({ type: "idle-settings", enabled: !state.settings.idleEnabled, route: state.settings.idleRoute || "line", toys: state.settings.idleToys !== false })}><span /></button>
                </div>
                <div className="setting-row">
                  <div>
                    <label htmlFor="idle-route"><strong>散步范围</strong></label>
                    <p>沿当前高度左右走，或沿当前屏幕边缘巡游；拖到另一块屏幕后，从新位置开始。</p>
                  </div>
                  <select id="idle-route" className="idle-route-select" value={state.settings.idleRoute || "line"}
                    disabled={working || !state.settings.idleEnabled}
                    onChange={event => command({ type: "idle-settings", enabled: true, route: event.target.value, toys: state.settings.idleToys !== false })}>
                    <option value="line">沿当前位置左右走</option>
                    <option value="edges">沿屏幕边缘巡游</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div><strong>偶尔玩球</strong><p>玩球是每位伙伴获赠的基础技能，获取率 100%。也可从技能页或宠物右键菜单主动表演。</p></div>
                  <button role="switch" aria-label="偶尔玩球" aria-checked={state.settings.idleToys !== false}
                    className={`toggle ${state.settings.idleToys !== false ? "on" : ""}`} disabled={working || !state.settings.idleEnabled}
                    onClick={() => command({ type: "idle-settings", enabled: true, route: state.settings.idleRoute || "line", toys: state.settings.idleToys === false })}><span /></button>
                  <button className="button secondary" onClick={takeBall} disabled={!pet || !state.settings.floating}>拿出玩具球</button>
                </div>
                {state.idle?.reducedMotion && <p className="setting-footnote">系统已开启“减少动态效果”，散步与玩球暂时休息。</p>}
                <div className="setting-row">
                  <div>
                    <strong>Codex 会话联动</strong>
                    <p>开工时陪伴，收到本轮结束记录后表演出生才艺。气泡 8 秒后消失，不发币、不额外调用模型。</p>
                    <p>开启后从新一轮会话开始监听本机记录，不补播历史。等待回复和失败状态暂未接入；长时间没有记录时停止工作动作，不猜测完成。</p>
                  </div>
                  <button role="switch" aria-label="Codex 会话联动"
                    aria-checked={state.settings.activityEnabled === true}
                    className={`toggle ${state.settings.activityEnabled ? "on" : ""}`}
                    disabled={working}
                    onClick={() => command({ type: "activity", enabled: !state.settings.activityEnabled, topics: state.settings.activityTopics === true })}>
                    <span />
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>显示大致主题</strong>
                    <p>在本机读取新消息并按关键词分类，只显示“写代码”“做设计”等固定标签。可能判断不准，不展示或保存原文，不上传或发送给同事。</p>
                  </div>
                  <button role="switch" aria-label="显示大致主题"
                    aria-checked={state.settings.activityTopics === true}
                    className={`toggle ${state.settings.activityTopics ? "on" : ""}`}
                    disabled={working || !state.settings.activityEnabled}
                    onClick={() => command({ type: "activity", enabled: true, topics: !state.settings.activityTopics })}>
                    <span />
                  </button>
                </div>
                <p className="setting-footnote" data-testid="activity-status">
                  {{ off: "会话联动已关闭", connecting: "正在连接本地记录…", idle: "已连接，等待新一轮会话", running: `陪伴中 · ${state.activity?.activeCount || 0} 个会话`, unknown: "近期没有新记录，当前状态未知", unavailable: "无法读取会话记录，请检查上方目录；会自动重试" }[state.activity?.status || "off"]}
                  。当前支持本机 Codex，不支持 ChatGPT 桌面端或网页版。切换开关后从新会话开始。
                </p>
                <div className="setting-row">
                  <div>
                    <strong>悬浮宠物</strong>
                    <p>
                      把正在陪伴你的猫咪放到其他窗口上方，直接拖动宠物移动；双击打开小屋，右键打开菜单。
                    </p>
                  </div>
                  <button
                    role="switch"
                    aria-label="悬浮宠物"
                    aria-checked={state.settings.floating}
                    className={`toggle ${state.settings.floating ? "on" : ""}`}
                    disabled={working}
                    onClick={() =>
                      command({
                        type: "float",
                        value: !state.settings.floating,
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
                <p className="setting-footnote">
                  跟随系统的“减少动态效果”设置。
                </p>
              </section>
              <section className="card settings-card">
                <h3>本地存档</h3>
                <div className="setting-row">
                  <div>
                    <strong>宠物、血统和账本</strong>
                    <p>
                      每次操作自动保存，并保留上一份备份。导出文件请妥善保存。
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      const r = await api.exportSave();
                      if (!r.ok) setToast({ text: r.error, error: true });
                      else if (r.data) setToast({ text: "存档已导出" });
                    }}
                  >
                    <Download size={16} />
                    导出存档
                  </button>
                </div>
                <code className="save-path" translate="no">{state.savePath}</code>
              </section>
              <section className="local-contract">
                <ShieldCheck size={23} />
                <div>
                  <h3>你的本地小世界</h3>
                  <p>
                    本版本没有账号、服务器、在线交易或现金充值。本地宠物和宠物币不会自动变成未来的联网交易资产。
                  </p>
                </div>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <PawPrint size={13} /> PAWPRINT{" "}
            <span>每一份努力，都有温柔的回响。</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}{" "}
          {toast.text}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal.type === "genes" ? "gene-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close"
              aria-label="关闭弹窗"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal.type === "lan-consent" ? (
              <>
                <div className="modal-icon">
                  <Wifi size={27} />
                </div>
                <h2 id="modal-title">开启局域网小屋？</h2>
                <p>
                  同一网络中的同事可以发现你的小屋。交换连接码、双方确认后，才能串门和申请配种。
                </p>
                <div className="notice">
                  只分享宠物名字、基因、才艺和繁育状态。不分享聊天、用量或文件路径。macOS
                  可能请求本地网络权限；可随时关闭。
                </div>
                <button
                  className="button primary full"
                  disabled={working}
                  onClick={async () => {
                    if (await lanAction({ type: "enable" })) setModal(null);
                  }}
                >
                  同意并开启局域网
                </button>
              </>
            ) : modal.type === "garden" ? (
              <>
                <Cat className="welcome-cat" genome={modal.pet.genome} />
                <h2 id="modal-title" translate="no">{f("让{0}去后花园生活？", modal.pet.name)}</h2>
                <p>
                  它会保留名字、基因、血统和回忆，腾出一个小屋位置。休养期间暂停成长与繁育。
                </p>
                <div className="notice">
                  安置免费，不返币。有空位时随时接回，成长记录和繁育冷却都会保留。
                </div>
                <button
                  className="button primary full"
                  disabled={working}
                  onClick={async () => {
                    const next = await command(
                      { type: "garden", petId: modal.pet.id },
                      `${modal.pet.name}已在后花园安顿好了`,
                    );
                    if (next) {
                      setModal(null);
                      setTab("garden");
                    }
                  }}
                >
                  <Leaf size={16} />
                  安排去后花园
                </button>
                <button
                  className="text-button full"
                  onClick={() => setModal(null)}
                >
                  继续留在小屋
                </button>
              </>
            ) : modal.type === "connect" ? (
              <>
                <div className="modal-icon">
                  <Plug size={27} />
                </div>
                <h2 id="modal-title">让努力和陪伴连起来</h2>
                <p>
                  授权爪印直接读取本机 Codex 使用记录，提取最近 7
                  天的用量统计。读取和计价均已内置。
                </p>
                <ul className="consent-list">
                  <li>
                    <Check size={17} />
                    读取 token 数、模型、日期和费用估算
                  </li>
                  <li>
                    <Check size={17} />
                    仅提取统计字段，不保存正文或读取登录凭据
                  </li>
                  <li>
                    <Check size={17} />
                    数据保存在本机，不上传服务器
                  </li>
                </ul>
                <div className="notice">
                  首次连接可领取今天的奖励；以前日期只展示，不补发。可随时在设置中断开。
                </div>
                <button
                  className="button primary full"
                  disabled={working}
                  onClick={async () => {
                    const next = await command({ type: "connect" });
                    if (next) setModal(null);
                  }}
                >
                  同意并连接本地用量 <ArrowRight size={16} />
                </button>
              </>
            ) : modal.type === "genes" ? (
              <>
                <div className="gene-heading">
                  <Cat genome={modal.pet.genome} />
                  <div>
                    <span className="eyebrow">GENETIC PASSPORT</span>
                    <h2 id="modal-title" translate="no">{f("{0}的基因档案", modal.pet.name)}</h2>
                    <p>
                      第 {modal.pet.generation} 代 · {modal.pet.origin}
                    </p>
                  </div>
                </div>
                <div className="gene-table">
                  <div className="gene-table-head">
                    <span>特征</span>
                    <span>外貌表现</span>
                    <span>携带的两个等位基因</span>
                  </div>
                  {Object.keys(TRAITS).map((k) => (
                    <div key={k}>
                      <span>{LABELS[k]}</span>
                      <strong>
                        {TRAITS[k][phenotype(modal.pet.genome)[k]].name}
                        <RarityBadge
                          rarity={
                            geneOdds(k, phenotype(modal.pet.genome)[k]).rarity
                          }
                        />
                      </strong>
                      <span>
                        {modal.pet.genome[k].map((v, i) => (
                          <Chip key={i}>{TRAITS[k][v].name}</Chip>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setModal(null);
                    setTab("genes");
                  }}
                >
                  查看所有可获取基因与初代概率 <ArrowUpRight size={14} />
                </button>
                <div className="parentage">
                  <Heart size={17} />
                  {modal.pet.parents.length
                    ? `父母：${modal.pet.parents.map((p) => p.name).join(" × ")}`
                    : "初代宠物 · 随机生成的基因组合"}
                </div>
                <p className="gene-explainer">
                  {modal.pet.genome.$schema === "expression-v3"
                    ? "新蛋采用表现位与携带位，配种时随机决定哪一份显现。"
                    : "这位旧伙伴保留原来的固定显性规则与外貌。"}
                  未显现基因仍可遗传；蛋生成时确定，出生后不重抽。
                </p>
              </>
            ) : (
              <>
                <Cat
                  className="welcome-cat"
                  genome={modal.pet.genome}
                  mood="happy"
                />
                <span className="eyebrow">
                  {modal.type === "welcome"
                    ? "A LITTLE HELLO"
                    : "A NAME TO REMEMBER"}
                </span>
                <h2 id="modal-title">
                  {modal.type === "welcome"
                    ? "很高兴，终于见到你"
                    : "给它一个新的名字"}
                </h2>
                <p>
                  {modal.type === "welcome"
                    ? describe(modal.pet.genome)
                    : "它的基因和陪伴记录都会保留。"}
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const next = await command(
                      { type: "rename", petId: modal.pet.id, name },
                      "小家伙记住了这个名字",
                    );
                    if (next) setModal(null);
                  }}
                >
                  <label className="name-label" htmlFor="pet-name">
                    它的名字
                  </label>
                  <input
                    id="pet-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={24}
                    placeholder="给小家伙取个名字"
                  />
                  <button
                    className="button primary full"
                    disabled={working || !name.trim()}
                    type="submit"
                  >
                    {modal.type === "welcome" ? "一起回小屋" : "保存名字"}{" "}
                    <Heart size={16} />
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function UsageChart({ report, today }) {
  const end = new Date(`${today}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(end);
    d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      row: report?.days.find((r) => r.date === key),
    };
  });
  const max = Math.max(1, ...days.map((d) => d.row?.usd || 0));
  return (
    <div
      className={`usage-chart ${!report ? "empty" : ""}`}
      role="img"
      aria-label={
        report
          ? "最近七天每日 API 等价费用柱状图"
          : "连接用量后显示最近七天费用图表"
      }
    >
      {days.map(({ key, label, row }) => (
        <div className="chart-column" key={key}>
          <span>{row ? money(row.usd) : "—"}</span>
          <div className="bar-track">
            <i
              className={key === today ? "today" : ""}
              style={{
                height:
                  row?.usd != null
                    ? `${Math.max(2, (row.usd / max) * 100)}%`
                    : "2px",
              }}
            />
          </div>
          <small>{key === today ? "今天" : label}</small>
        </div>
      ))}
    </div>
  );
}
