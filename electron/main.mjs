import { ActivityBubble } from "./activity-bubble.mjs";
import { UpdateService } from "./updater.mjs";
import { LanService } from "./lan/service.mjs";
import { CodexActivity } from "./activity.mjs";
import { QuotaMonitor } from "./quota/monitor.mjs";
import { quotaPresentation } from "../core/quota.mjs";
import { translateText, translateMenu, formatText } from "../core/i18n.mjs";
import { IdleDirector, restingPose } from "../core/idle.mjs";
import { talentById } from "../core/talents.mjs";
import { skillById, ownsSkill, petSkills, socialCast } from "../core/skills.mjs";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  Tray,
  Menu,
  nativeImage,
  clipboard,
  Notification,
  systemPreferences,
  powerMonitor,
  nativeTheme,
} from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, randomUUID } from "node:crypto";
import { writeFile, readFile, stat, realpath } from "node:fs/promises";
import { Store } from "../core/store.mjs";
import { transition } from "../core/game.mjs";
import {
  availableReward,
  dayKey,
  RULES,
  normalizeReport,
  housePets,
  availableCoins,
  heldCoins,
} from "../core/economy.mjs";
import { readUsage, defaultCodexHome } from "./local-usage.mjs";
import { FLOAT_SIZE, floatPosition, desktopUpgrade, petScale, scaledFloatSize } from "../core/desktop.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const test = !app.isPackaged && process.env.PAWPRINT_TEST_MODE === "1";
app.setName("Pawprint");
app.setPath(
  "userData",
  test && process.env.PAWPRINT_TEST_DATA
    ? process.env.PAWPRINT_TEST_DATA
    : path.join(app.getPath("appData"), "Pawprint"),
);
let home, floating, store, refreshPromise, interval, tray, moveTimer, updates;
const activityBubble = new ActivityBubble();
let dragOrigin = null;
let lan,
  performance = null;
let activity, lastActivityEvent, quota;
let trayImage, trayWatch, trayRecoveries = 0, trayLastReason = "startup";
const TRAY_GUID = "22e5b352-a013-4f52-86fb-68ce83b3b386";
const language = () => store?.state?.settings?.language === "en" ? "en" : "zh";
const tr = value => translateText(value, language());
const buildMenu = items => Menu.buildFromTemplate(translateMenu(items, language()));
let previewScale = null, socialPerformance = null, socialTimer;
const desktopScale = () => previewScale ?? petScale(store?.state.settings);
const desktopSize = (width = FLOAT_SIZE.width) => scaledFloatSize(desktopScale(), width);
const idleDirector = new IdleDirector({ random: test ? () => 0.8 : Math.random });
let idleVisual = restingPose(), idleTimer, idleTargetPosition;
let idlePausedUntil = 0, idleMenuOpen = false, reducedMotion = false, motionCheckedAt = 0, screenLocked = false, suspended = false;
const guestWindows = new Map();
let previousInvites = new Set();
const execute = promisify(execFile);
let queue = Promise.resolve();
let busy = false;
let quitting = false;
const enqueue = (task) => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
function snapshot() {
  return {
    ...structuredClone(store.state),
    availableCoins: availableCoins(store.state),
    heldCoins: heldCoins(store.state),
    performance,
    trayStatus: trayStatus(),
    update: updates?.snapshot() ?? { status: "idle", release: null, error: null },
    quota: quota?.snapshot() ?? { enabled: false, loading: false, data: null, error: null },
    displayScale: desktopScale(),
    socialPerformance,
    idle: idleVisual,
    activity: activity?.snapshot() ?? { enabled: false, status: "off", activeCount: 0, event: null },
    lan: lan?.auth
      ? lan.snapshot()
      : {
          enabled: false,
          peers: [],
          visitors: [],
          pairRequests: [],
          visitRequests: [],
          breeding: [],
        },
    now: Date.now(),
    availableReward: availableReward(store.state, Date.now()),
    today: dayKey(Date.now()),
    busy,
    rules: RULES,
    savePath: store.file,
    usageDirectory:
      store.state.settings.codexHome ||
      (test && process.env.PAWPRINT_TEST_CODEX_HOME) ||
      defaultCodexHome(),
  };
}
function broadcast() {
  syncActivityBubble();
  syncGuests();
  notifyInvites();
  updateTray();
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("paw:changed", snapshot());
}
function secure(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}
function load(window, hash = "") {
  secure(window);
  if (dev) window.loadURL(`http://127.0.0.1:5173/${hash ? `#${hash}` : ""}`);
  else window.loadFile(path.join(here, "../dist/index.html"), { hash });
}
function createHome(section) {
  if (store?.state && !quitting)
    void enqueue(() => mutate({ type: "visit" })).catch(() => {});
  const target = [
    "home",
    "usage",
    "collection",
    "breed",
    "settings",
    "genes",
    "garden",
    "talents",
    "nearby",
  ].includes(section)
    ? section
    : null;
  if (home && !home.isDestroyed()) {
    home.show();
    home.focus();
    if (target) home.webContents.send("paw:navigate", target);
    return;
  }
  home = new BrowserWindow({
    width: 1260,
    height: 850,
    minWidth: 1030,
    minHeight: 730,
    backgroundColor: "#F8F7F2",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 23 },
    title: tr("爪印 · Pawprint"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  home.on("closed", () => {
    home = null;
  });
  if (target)
    home.webContents.once("did-finish-load", () =>
      home?.webContents.send("paw:navigate", target),
    );
  load(home, target || "home");
}
async function openClient() {
  if (process.platform !== "darwin")
    throw new Error("当前版本仅支持在 macOS 打开 AI 客户端。");
  try {
    await execute("/usr/bin/open", ["-b", "com.openai.codex"], {
      timeout: 10_000,
    });
  } catch {
    throw new Error("未找到 Codex / ChatGPT 桌面客户端，请先安装后重试。");
  }
  return true;
}
function menuAction(action) {
  void Promise.resolve()
    .then(action)
    .catch((error) => dialog.showErrorBox(tr("爪印"), tr(error.message)));
}
function menuTemplate() {
  const pet = store.state.pets.find((p) => p.id === store.state.activePetId);
  const q = quotaPresentation(quota?.snapshot(), store.state.settings.quotaWindow, Date.now(), language());
  return [
    {
      label: `爪印 · ${pet?.name || tr(store.state.eggs.length ? "等待孵化的蛋" : store.state.freeEggClaimed ? "伙伴在后花园休息" : "一枚等待相遇的蛋")}`,
      enabled: false,
    },
    {
      label: `宠物币 ${store.state.balance} · 可领取 ${availableReward(store.state, Date.now())}`,
      enabled: false,
    },
    { type: "separator" },
    ...(store.state.settings.quotaEnabled ? [
      { label: q.values.weekly.detail, enabled: false },
      { label: q.values.session.detail, enabled: false },
      { label: q.source, enabled: false },
      { label: "重新读取额度快照", click: () => menuAction(() => quota?.refresh()) },
    ] : []),
    { label: "菜单栏额度", submenu: [
      { label: "显示剩余额度（本地快照）", type: "checkbox", checked: store.state.settings.quotaEnabled === true,
        click: () => menuAction(() => enqueue(() => mutate({ type: "quota-settings", enabled: !store.state.settings.quotaEnabled, window: store.state.settings.quotaWindow || "weekly" }))) },
      ...[["weekly", "周剩余 · W"], ["session", "5 小时剩余 · 5h"], ["both", "同时显示"]].map(([value, label]) => ({
        label, type: "radio", checked: (store.state.settings.quotaWindow || "weekly") === value,
        click: () => menuAction(() => enqueue(() => mutate({ type: "quota-settings", enabled: true, window: value }))),
      })),
    ] },
    { label: "语言", submenu: [
      { label: "简体中文", type: "radio", checked: language() === "zh", click: () => menuAction(() => enqueue(() => mutate({ type: "language", value: "zh" }))) },
      { label: "English", type: "radio", checked: language() === "en", click: () => menuAction(() => enqueue(() => mutate({ type: "language", value: "en" }))) },
    ] },
    { type: "separator" },
    { label: "打开爪印小屋", click: () => createHome("home") },
    { label: "用量与钱包", click: () => createHome("usage") },
    { label: "基因图鉴与获取概率", click: () => createHome("genes") },
    { label: "去后花园看看", click: () => createHome("garden") },
    { label: "附近的小屋", click: () => createHome("nearby") },
    { label: "拿出玩具球", enabled: !!pet, click: () => menuAction(playBall) },
    { label: "待机散步", type: "checkbox", checked: store.state.settings.idleEnabled === true,
      click: () => menuAction(() => enqueue(() => mutate({ type: "idle-settings", enabled: !store.state.settings.idleEnabled,
        route: store.state.settings.idleRoute || "line", toys: store.state.settings.idleToys !== false }))) },
    {
      label: pet
        ? `表演：${talentById(pet.talent?.id)?.name ?? "才艺"}`
        : "先迎接一位伙伴",
      enabled: !!pet,
      click: () => perform(pet.id),
    },
    { label: "打开 Codex / ChatGPT", click: () => menuAction(openClient) },
    { type: "separator" },
    {
      label: "显示悬浮宠物",
      type: "checkbox",
      checked: store.state.settings.floating,
      click: () =>
        menuAction(() =>
          enqueue(() =>
            mutate({ type: "float", value: !store.state.settings.floating }),
          ),
        ),
    },
    {
      label: "把宠物移回当前屏幕",
      click: () =>
        menuAction(async () => {
          if (!store.state.settings.floating)
            await enqueue(() => mutate({ type: "float", value: true }));
          const area = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          ).workArea;
          const pos = floatPosition(null, area, desktopSize());
          idleDirector.reset(Date.now());
          idleTargetPosition = null;
          floating?.setPosition(pos.x, pos.y);
        }),
    },
    { type: "separator" },
    {
      label: "退出爪印",
      accelerator: "CommandOrControl+Q",
      click: () => app.quit(),
    },
  ];
}
function pendingInvites() {
  if (!lan?.auth || !lan.enabled) return [];
  const s = lan.snapshot();
  return [
    ...s.pairRequests.map((p) => ({ key: `pair:${p.id}`, name: p.name })),
    ...s.visitRequests.map((v) => ({ key: `visit:${v.id}`, name: v.peerName })),
    ...s.breeding
      .filter(
        (t) =>
          t.direction === "in" &&
          t.status === "pending" &&
          t.expiresAt > Date.now(),
      )
      .map((t) => ({ key: `breed:${t.peerId}:${t.id}`, name: t.peerName })),
  ];
}
function notifyInvites() {
  const pending = pendingInvites(),
    fresh = pending.filter((p) => !previousInvites.has(p.key));
  previousInvites = new Set(pending.map((p) => p.key));
  if (
    fresh.length &&
    !test &&
    (!home || !home.isFocused()) &&
    Notification.isSupported()
  ) {
    const notice = new Notification({
      title: tr("爪印 · 有新的同事邀请"),
      body: tr(`${fresh[0].name}发来邀请，打开附近的小屋确认。`),
      silent: true,
    });
    notice.on("click", () => createHome("nearby"));
    notice.show();
  }
}
function updateTray() {
  if (tray && !tray.isDestroyed()) {
    const q = quotaPresentation(quota?.snapshot(), store.state.settings.quotaWindow, Date.now(), language());
    const invitations = pendingInvites().length;
    tray.setTitle(store.state.settings.trayCompact ? "" : [q.title, invitations ? String(invitations) : ""].filter(Boolean).join(" · "), { fontType: "monospacedDigit" });
    tray.setToolTip(tr(q.tooltip + (invitations ? `\n${invitations} 个待处理邀请` : "")));
    tray.setContextMenu(buildMenu(menuTemplate()));
  }
}
function trayStatus() {
  let bounds = null;
  const created = !!tray && !tray.isDestroyed();
  try { if (created) bounds = tray.getBounds(); } catch {}
  return { created, bounds, recoveries: trayRecoveries, reason: trayLastReason };
}
function createTray(reason = "startup") {
  if (quitting) return;
  trayImage ??= nativeImage.createFromPath(
    path.join(here, "../build/trayTemplate.png"),
  );
  if (trayImage.isEmpty()) throw new Error("菜单栏图标缺失，请重新构建应用。");
  trayImage.setTemplateImage(true);
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = new Tray(trayImage, TRAY_GUID);
  trayLastReason = reason;
  if (reason !== "startup") trayRecoveries++;
  tray.setToolTip("爪印 · Pawprint");
  updateTray();
}
function syncActivityBubble() {
  if (screenLocked || suspended) { activityBubble.hide(); return; }
  const state = activity?.snapshot();
  const event = state?.event;
  if (!event || Date.now() - event.at >= 8000) { activityBubble.hide(); return; }
  const pet = floating && !floating.isDestroyed() && floating.isVisible() ? floating.getBounds() : null;
  const remaining = state?.activeCount > (event?.kind === "completed" ? 0 : 1)
    ? tr(`还有 ${state.activeCount} 个会话在进行`) : null;
  activityBubble.update({ pet, event: event ? { ...event, text: tr(event.text) } : null, subtitle: remaining });
}
function rememberPosition() {
  clearTimeout(moveTimer);
  if (!floating || floating.isDestroyed() || quitting) return;
  const [x, y] = floating.getPosition();
  return enqueue(async () => {
    const next = structuredClone(store.state);
    next.settings.floatingPosition = { x, y };
    await store.save(next);
  });
}
function syncFloating() {
  const occupied =
    housePets(store.state).length > 0 ||
    store.state.eggs.length > 0 ||
    !store.state.freeEggClaimed;
  if (!store.state.settings.floating || !occupied) {
    void rememberPosition();
    if (floating && !floating.isDestroyed()) floating.close();
    floating = null;
    return;
  }
  if (floating && !floating.isDestroyed()) return;
  const saved = store.state.settings.floatingPosition;
  const bounds =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? screen.getDisplayMatching({ ...saved, ...desktopSize() }).workArea
      : screen.getPrimaryDisplay().workArea;
  const pos = floatPosition(saved, bounds, desktopSize());
  floating = new BrowserWindow({
    ...desktopSize(),
    ...pos,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  floating.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floating.once("ready-to-show", () => floating?.showInactive());
  floating.on("moved", () => {
    syncActivityBubble();
    const [x, y] = floating.getPosition();
    if (idleTargetPosition?.x === x && idleTargetPosition?.y === y) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      void rememberPosition()?.catch(() => {});
    }, 350);
  });
  floating.on("closed", () => {
    floating = null;
    activityBubble.hide();
    dragOrigin = null;
    idleTargetPosition = null;
    idleDirector.reset(Date.now());
  });
  load(floating, "floating");
}
async function mutate(command) {
  if (
    command.type === "visit" &&
    housePets(store.state).every((p) =>
      p.activeDays.includes(dayKey(Date.now())),
    )
  )
    return snapshot();
  const next = transition(store.state, command, {
    now: Date.now(),
    rng: randomInt,
    id: randomUUID,
  });
  await store.save(next);
  if (command.type === "language") home?.setTitle(tr("爪印 · Pawprint"));
  if (command.type === "pet-scale") {
    if (previewScale === next.settings.petScale) previewScale = null;
    resizePets();
    void rememberPosition()?.catch(() => {});
  }
  if (["idle-settings", "select", "garden", "float"].includes(command.type)) {
    idleDirector.reset(Date.now());
    publishIdle(restingPose());
  }
  if (command.type === "activity") await syncActivity();
  if (command.type === "quota-settings") await syncQuota();
  broadcast();
  syncFloating();
  return snapshot();
}
function syncActivity() {
  return activity?.configure({
    directory: store.state.settings.codexHome ||
      (test && process.env.PAWPRINT_TEST_CODEX_HOME) || defaultCodexHome(),
    enabled: store.state.settings.activityEnabled === true,
    topics: store.state.settings.activityTopics === true,
  });
}
function syncQuota() {
  return quota?.configure({
    directory: store.state.settings.codexHome || (test && process.env.PAWPRINT_TEST_CODEX_HOME) || defaultCodexHome(),
    enabled: store.state.settings.quotaEnabled === true,
  });
}
function resizePetWindow(window, width = FLOAT_SIZE.width) {
  if (!window || window.isDestroyed()) return;
  const old = window.getBounds(), size = desktopSize(width);
  const area = screen.getDisplayMatching(old).workArea;
  const pos = floatPosition({ x: old.x + (old.width - size.width) / 2, y: old.y + old.height - size.height }, area, size);
  if (window === floating) idleTargetPosition = pos;
  window.setBounds({ ...pos, ...size }, false);
}
function resizePets() {
  idleDirector.reset(Date.now());
  resizePetWindow(floating);
  for (const [id, window] of guestWindows) resizePetWindow(window, socialPerformance?.visitId === id ? 420 : FLOAT_SIZE.width);
}
function endSocial(notify = true) {
  const previous = socialPerformance;
  socialPerformance = null;
  clearTimeout(socialTimer);
  if (!previous) return;
  resizePetWindow(guestWindows.get(previous.visitId));
  if (!screenLocked && !suspended && previous.hidOwn && store.state.settings.floating && housePets(store.state).length) floating?.showInactive();
  if (notify && !quitting) broadcast();
}
function playSocial(request) {
  if (socialPerformance) throw new Error("伙伴们正在合演，稍等一会儿再来。");
  if (systemPreferences.getAnimationSettings().prefersReducedMotion) throw new Error("系统已开启减少动态效果，合演暂时休息。");
  if (activity?.snapshot().status === "running") throw new Error("先等这一轮工作结束，再和朋友一起玩吧。");
  const cast = socialCast(housePets(store.state), lan.snapshot().visitors, request, Date.now());
  if (!guestWindows.has(cast.visitId)) throw new Error("访客还在路上，请稍后再试。");
  socialPerformance = { ...cast, hidOwn: !!floating && floating.isVisible() };
  performance = null;
  if (socialPerformance.hidOwn) floating.hide();
  idleDirector.reset(Date.now());
  resizePetWindow(guestWindows.get(cast.visitId), 420);
  socialTimer = setTimeout(() => endSocial(), 8000);
  broadcast();
  return snapshot();
}
function performSkill(petId, skillId) {
  const pet = housePets(store.state).find(p => p.id === petId);
  if (!pet || !ownsSkill(pet, skillId) || !["gift", "idle"].includes(skillById(skillId)?.category)) throw new Error("这位伙伴没有可单独表演的这项技能。");
  endSocial(false);
  performance = { petId, guestId: null, skillId, at: Date.now(), duration: 8000 };
  broadcast();
  return snapshot();
}
function publishIdle(value) {
  const next = { ...value, reducedMotion };
  if (JSON.stringify(next) === JSON.stringify(idleVisual)) return;
  idleVisual = next;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("paw:idle", idleVisual);
}
function playBall() {
  if (!floating || floating.isDestroyed() || !housePets(store.state).length)
    throw new Error("先把一位伙伴放到桌面，再拿出玩具球。");
  if (systemPreferences.getAnimationSettings().prefersReducedMotion)
    throw new Error("系统已开启减少动态效果，玩球动画暂时休息。");
  if (activity?.snapshot().status === "running")
    throw new Error("伙伴正在陪你工作，等这一轮结束后再玩吧。");
  idleDirector.playBall();
  return snapshot();
}
function tickIdle() {
  if (quitting) return;
  const now = Date.now();
  try {
    syncActivityBubble();
    if (screenLocked || suspended) { idleDirector.reset(now); return; }
    if (now - motionCheckedAt > 1000) {
      reducedMotion = systemPreferences.getAnimationSettings().prefersReducedMotion;
      motionCheckedAt = now;
    }
    const pet = housePets(store.state).find(p => p.id === store.state.activePetId) || housePets(store.state)[0];
    if (!floating || floating.isDestroyed() || !pet) {
      idleDirector.reset(now);
      publishIdle(restingPose());
      return;
    }
    const [x, y] = floating.getPosition();
    const position = { x, y };
    const size = desktopSize();
    const area = screen.getDisplayMatching({ ...position, ...size }).workArea;
    const mouse = screen.getCursorScreenPoint();
    const near = mouse.x >= x - 28 && mouse.x <= x + size.width + 28 &&
      mouse.y >= y - 28 && mouse.y <= y + size.height + 28;
    const performing = performance?.petId === pet.id && !performance.guestId && now - performance.at < (performance.duration || 6000);
    const result = idleDirector.step({ now, position, area, size, skill: petSkills(pet).idle,
      enabled: store.state.settings.idleEnabled === true,
      route: store.state.settings.idleRoute || "line", toys: store.state.settings.idleToys !== false,
      blocked: near || !!socialPerformance || !!dragOrigin || idleMenuOpen || now < idlePausedUntil || reducedMotion || performing || activity?.snapshot().status === "running",
    });
    if (!dragOrigin && (result.position.x !== x || result.position.y !== y)) {
      idleTargetPosition = result.position;
      floating.setPosition(result.position.x, result.position.y, false);
    }
    publishIdle(result.visual);
  } catch {
    idleDirector.reset(now);
    publishIdle(restingPose());
  } finally {
    idleTimer = setTimeout(tickIdle, screenLocked || suspended ? 2000 : idleVisual.mode === "walk" ? 33 : 200);
    idleTimer.unref?.();
  }
}
function activityChanged(value) {
  if (quitting) return;
  if (value.status === "running") endSocial(false);
  const eventKey = value.event ? `${value.event.at}:${value.event.id}` : null;
  if (value.event?.kind === "completed" && eventKey !== lastActivityEvent) {
    lastActivityEvent = eventKey;
    const pets = housePets(store.state);
    const pet = pets.find(p => p.id === store.state.activePetId) || pets[0];
    if (pet) performance = {
      petId: pet.id, guestId: null, talentId: pet.talent.id,
      level: pet.talent.level, at: Date.now(), source: "activity",
    };
  }
  if (!value.enabled && performance?.source === "activity") performance = null;
  broadcast();
}
function perform(petId, guestId) {
  endSocial(false);
  const pet = guestId
    ? lan?.snapshot().visitors.find((v) => v.id === guestId)?.pet
    : housePets(store.state).find((p) => p.id === petId);
  if (!pet || !talentById(pet.talent?.id))
    throw new Error("这位伙伴暂时不能表演。");
  performance = {
    petId: pet.id,
    guestId: guestId ?? null,
    talentId: pet.talent.id,
    level: pet.talent.level,
    at: Date.now(),
  };
  broadcast();
  return snapshot();
}
function syncGuests() {
  if (!lan?.auth || quitting || screenLocked || suspended) return;
  const visitors = lan.snapshot().visitors;
  if (socialPerformance && (!visitors.some(v => v.id === socialPerformance.visitId) || !housePets(store.state).some(p => p.id === socialPerformance.host.id))) endSocial(false);
  for (const [id, window] of guestWindows)
    if (!visitors.some((v) => v.id === id)) {
      guestWindows.delete(id);
      window.close();
    }
  for (const [index, v] of visitors.entries())
    if (!guestWindows.has(v.id)) {
      const area = screen.getPrimaryDisplay().workArea;
      const window = new BrowserWindow({
        ...desktopSize(),
        x: Math.max(
          area.x,
          area.x + area.width - desktopSize().width * (index + 2) - 30,
        ),
        y: area.y + area.height - desktopSize().height - 25,
        transparent: true,
        backgroundColor: "#00000000",
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        acceptFirstMouse: true,
        webPreferences: {
          preload: path.join(here, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      guestWindows.set(v.id, window);
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.on("closed", () => {
        guestWindows.delete(v.id);
        if (!quitting && lan?.enabled) lan.dismissVisitor(v.id);
      });
      load(window, `guest:${v.id}`);
    }
}
function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (!store.state.settings.connected) return snapshot();
    busy = true;
    broadcast();
    const sourceDirectory =
      store.state.settings.codexHome ||
      (test && process.env.PAWPRINT_TEST_CODEX_HOME) ||
      defaultCodexHome();
    try {
      const report =
        test && process.env.PAWPRINT_TEST_REPORT
          ? normalizeReport(
              JSON.parse(
                await readFile(process.env.PAWPRINT_TEST_REPORT, "utf8"),
              ),
              Date.now(),
            )
          : await readUsage({
              codexHome: sourceDirectory,
              cacheDirectory: path.join(app.getPath("userData"), "usage-cache"),
            });
      await enqueue(async () => {
        const currentDirectory =
          store.state.settings.codexHome ||
          (test && process.env.PAWPRINT_TEST_CODEX_HOME) ||
          defaultCodexHome();
        if (
          !quitting &&
          store.state.settings.connected &&
          currentDirectory === sourceDirectory
        )
          await mutate({ type: "observe", report });
      });
    } catch (error) {
      await enqueue(async () => {
        const currentDirectory =
          store.state.settings.codexHome ||
          (test && process.env.PAWPRINT_TEST_CODEX_HOME) ||
          defaultCodexHome();
        if (
          quitting ||
          !store.state.settings.connected ||
          currentDirectory !== sourceDirectory
        )
          return;
        const next = structuredClone(store.state);
        next.usage.lastError = error.message;
        await store.save(next);
      });
    } finally {
      busy = false;
      broadcast();
    }
    return snapshot();
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || ![home, floating, ...guestWindows.values()].includes(window))
      return { ok: false, error: "来源无效。" };
    try {
      if (quitting) throw new Error("应用正在保存并退出。");
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: tr(error.message || "操作失败，请重试。") };
    }
  });
}
const allowed = new Set([
  "free-egg",
  "buy-egg",
  "hatch",
  "rename",
  "select",
  "breed",
  "expand",
  "claim",
  "connect",
  "disconnect",
  "float",
  "visit",
  "garden",
  "return-home",
  "train",
  "activity",
  "idle-settings",
  "pet-scale",
  "quota-settings",
  "language",
  "tray-compact",
]);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", createHome);
  app.whenReady().then(async () => {
    try {
      store = new Store(app.getPath("userData"));
      await store.load();
      updates = new UpdateService({
        installed: app.getVersion(),
        appPath: path.dirname(path.dirname(path.dirname(app.getPath("exe")))),
        onChange: () => { if (home && !home.isDestroyed()) home.webContents.send("paw:changed", snapshot()); },
        quit: () => app.quit(),
      });
      if (store.state.usage.readerVersion !== "native-v1") {
        const next = structuredClone(store.state);
        next.usage.readerVersion = "native-v1";
        next.usage.report = null;
        next.usage.lastError = null;
        await store.save(next);
      }
      const upgraded = desktopUpgrade(store.state);
      if (upgraded !== store.state) await store.save(upgraded);
      register("paw:state", () => snapshot());
      register("paw:update-check", () => updates.check());
      register("paw:update-install", () => {
        if (!app.isPackaged) throw new Error("请在安装的应用中执行升级。");
        return updates.installLatest();
      });
      register("paw:tray-recover", () => { createTray("manual"); broadcast(); return snapshot(); });
      register("paw:command", async (command) => {
        if (
          !command ||
          typeof command !== "object" ||
          !allowed.has(command.type)
        )
          throw new Error("操作无效。");
        const result = await enqueue(() => mutate(command));
        if (command.type === "connect") void refresh();
        return result;
      });
      register("paw:refresh", refresh);
      register("paw:quota-refresh", async () => { await quota?.refresh(); return snapshot(); });
      register("paw:perform", (petId, guestId) => perform(petId, guestId));
      register("paw:ball", playBall);
      register("paw:motion-preview", () => {
        if (!floating || !housePets(store.state).length) throw new Error("先把一位伙伴放到桌面，再预览动作。");
        if (systemPreferences.getAnimationSettings().prefersReducedMotion) throw new Error("系统已开启减少动态效果，动作预览暂时休息。");
        if (activity?.snapshot().status === "running") throw new Error("伙伴正在陪你工作，等这一轮结束后再玩吧。");
        endSocial(false); performance = null; idleDirector.previewMotion();
        return snapshot();
      });
      register("paw:skill", performSkill);
      register("paw:scale-preview", (percent) => {
        if (!Number.isInteger(percent) || percent < 50 || percent > 100) throw new Error("尺寸范围为 50%–100%。");
        previewScale = percent / 100;
        resizePets();
        broadcast();
        return true;
      });
      register("paw:lan", async (action) => {
        if (!action || typeof action.type !== "string")
          throw new Error("局域网操作无效。");
        switch (action.type) {
          case "social":
            return playSocial(action);
          case "end-social":
            endSocial();
            break;
          case "enable":
            await lan.enable();
            break;
          case "disable":
            await lan.disable();
            break;
          case "name":
            await lan.setName(action.name);
            break;
          case "copy": {
            const code = lan.inviteCode(action.address);
            if (!code) throw new Error("先开启局域网，并连接可互通的 Wi-Fi。");
            clipboard.writeText(code);
            break;
          }
          case "pair":
            await lan.pair(action.code);
            break;
          case "answer-pair":
            await lan.answerPair(action.id, action.accept === true);
            break;
          case "visit":
            await lan.requestVisit(action.peerId, action.petId);
            break;
          case "answer-visit":
            lan.answerVisit(action.id, action.accept === true);
            break;
          case "dismiss":
            lan.dismissVisitor(action.id);
            break;
          case "return":
            await lan.returnVisit(action.id);
            break;
          case "breed":
            await lan.requestBreed(action.peerId, action.petId, action.mateId);
            break;
          case "answer-breed":
            await lan.answerBreed(
              action.peerId,
              action.id,
              action.accept === true,
            );
            break;
          case "cancel-breed":
            await lan.cancelBreed(action.id);
            break;
          case "refresh":
            await lan.poll();
            break;
          default:
            throw new Error("不支持的局域网操作。");
        }
        broadcast();
        return snapshot();
      });
      register("paw:guest-menu", (guestId) => {
        const v = lan.snapshot().visitors.find((v) => v.id === guestId);
        if (!v) throw new Error("访客已回家。");
        buildMenu([
          { label: formatText("来自{0}的{1}", [v.peerName, v.pet.name], language()), enabled: false },
          { label: "一起玩（打开附近的小屋）", click: () => createHome("nearby") },
          ...(socialPerformance?.visitId === guestId ? [{ label: "结束合演", click: () => endSocial() }] : []),
          {
            label: `表演：${talentById(v.pet.talent.id).name}`,
            click: () => perform(v.pet.id, v.id),
          },
          { label: "送它回家", click: () => lan.dismissVisitor(v.id) },
          { label: "打开附近的小屋", click: () => createHome("nearby") },
        ]).popup({ window: guestWindows.get(guestId) });
        return true;
      });

      register("paw:usage-directory", async () => {
        const result = await dialog.showOpenDialog(home, {
          title: tr("选择 Codex 记录目录（通常是 .codex）"),
          defaultPath: store.state.settings.codexHome || defaultCodexHome(),
          properties: ["openDirectory", "showHiddenFiles"],
        });
        if (result.canceled || !result.filePaths[0]) return snapshot();
        let selected = await realpath(result.filePaths[0]);
        if (["sessions", "archived_sessions"].includes(path.basename(selected)))
          selected = path.dirname(selected);
        let valid = false;
        for (const child of ["sessions", "archived_sessions"]) {
          try {
            if ((await stat(path.join(selected, child))).isDirectory())
              valid = true;
          } catch {}
        }
        if (!valid)
          throw new Error(
            "这个文件夹不包含 Codex 的 sessions 或 archived_sessions 记录。请选择 .codex 目录。",
          );
        await enqueue(async () => {
          const next = structuredClone(store.state);
          next.settings.codexHome = selected;
          next.usage.report = null;
          next.usage.lastError = null;
          await store.save(next);
          await syncActivity();
          await syncQuota();
          broadcast();
        });
        if (store.state.settings.connected) {
          if (refreshPromise) void refreshPromise.finally(() => refresh());
          else void refresh();
        }
        return snapshot();
      });
      register("paw:home", (section) => {
        createHome(section);
        return true;
      });
      register("paw:client", openClient);
      register("paw:menu", () => {
        idleMenuOpen = true;
        buildMenu(menuTemplate()).popup({ window: floating, callback: () => {
          idleMenuOpen = false;
          idlePausedUntil = Date.now() + 2000;
        } });
        return true;
      });
      ipcMain.on("paw:pointer", (event, interactive) => {
        if (
          floating &&
          !floating.isDestroyed() &&
          event.sender === floating.webContents &&
          typeof interactive === "boolean" &&
          !dragOrigin
        )
          floating.setIgnoreMouseEvents(!interactive, { forward: true });
      });
      ipcMain.on("paw:drag", (event, data) => {
        if (
          quitting ||
          !floating ||
          floating.isDestroyed() ||
          event.sender !== floating.webContents ||
          !data
        )
          return;
        if (data.phase === "end") {
          dragOrigin = null;
          idleDirector.reset(Date.now());
          idleTargetPosition = null;
          idlePausedUntil = Date.now() + 8000;
          void rememberPosition()?.catch(() => {});
          return;
        }
        if (
          !Number.isFinite(data.x) ||
          !Number.isFinite(data.y) ||
          Math.abs(data.x) > 100000 ||
          Math.abs(data.y) > 100000
        )
          return;
        if (data.phase === "start") {
          idleDirector.reset(Date.now());
          idleTargetPosition = null;
          publishIdle(restingPose());
          const [x, y] = floating.getPosition();
          dragOrigin = { x, y, mx: data.x, my: data.y };
          floating.setIgnoreMouseEvents(false);
        } else if (data.phase === "move" && dragOrigin) {
          const desired = {
            x: Math.round(dragOrigin.x + data.x - dragOrigin.mx),
            y: Math.round(dragOrigin.y + data.y - dragOrigin.my),
          };
          const area = screen.getDisplayMatching({
            ...desired,
            ...desktopSize(),
          }).workArea;
          const pos = floatPosition(desired, area, desktopSize());
          floating.setPosition(pos.x, pos.y);
        }
      });
      register("paw:export", async () => {
        const { canceled, filePath } = await dialog.showSaveDialog(home, {
          title: tr("导出本地存档"),
          defaultPath: `pawprint-${dayKey(Date.now())}.json`,
          filters: [{ name: "Pawprint save", extensions: ["json"] }],
        });
        if (canceled || !filePath) return false;
        await enqueue(() =>
          writeFile(filePath, JSON.stringify(store.state, null, 2), {
            mode: 0o600,
          }),
        );
        return true;
      });
      // The app's entry point must not depend on network or usage readers finishing.
      createTray();
      app.on("activate", createHome);
      trayWatch = setInterval(() => {
        if (!quitting && (!tray || tray.isDestroyed())) { createTray("missing"); broadcast(); }
      }, 10000);
      trayWatch.unref();
      nativeTheme.on("updated", () => {
        if (!quitting && tray && !tray.isDestroyed()) { tray.setImage(trayImage); updateTray(); }
      });
      await enqueue(() => mutate({ type: "visit" }));
      lan = new LanService({
        directory: app.getPath("userData"),
        getGame: () => store.state,
        command: (c) => {
          if (quitting) throw new Error("小屋正在退出，请重连后继续。");
          return enqueue(() => mutate(c));
        },
        onChange: () => broadcast(),
        ...(test && process.env.PAWPRINT_TEST_LAN === "1"
          ? { testHost: "127.0.0.1", discovery: false }
          : {}),
      });
      await lan.init();
      activity = new CodexActivity({ onChange: activityChanged });
      await syncActivity();
      quota = new QuotaMonitor({ onChange: () => { if (!quitting) broadcast(); } });
      await syncQuota();
      updateTray();
      syncFloating();
      tickIdle();
      const pauseVisuals = () => {
        activityBubble.hide();
        floating?.hide();
        for (const guest of guestWindows.values()) guest.hide();
        idleDirector.reset(Date.now());
      };
      const restoreVisuals = () => {
        if (screenLocked || suspended || quitting) return;
        idleDirector.reset(Date.now());
        if (store.state.settings.floating && !socialPerformance?.hidOwn) floating?.showInactive();
        syncGuests();
        for (const guest of guestWindows.values()) guest.showInactive();
      };
      powerMonitor.on("lock-screen", () => { screenLocked = true; pauseVisuals(); });
      powerMonitor.on("unlock-screen", () => { screenLocked = false; restoreVisuals(); });
      powerMonitor.on("suspend", () => { suspended = true; pauseVisuals(); });
      powerMonitor.on("resume", () => {
        if (quitting) return;
        suspended = false;
        createTray("resume");
        restoreVisuals();
        void quota?.refresh();
      });
      screen.on("display-removed", () => {
        if (!floating || floating.isDestroyed()) return;
        const [x, y] = floating.getPosition();
        const area = screen.getDisplayMatching({
          x,
          y,
          ...desktopSize(),
        }).workArea;
        const pos = floatPosition({ x, y }, area, desktopSize());
        idleDirector.reset(Date.now());
        idleTargetPosition = null;
        floating.setPosition(pos.x, pos.y);
      });
      if (store.state.settings.connected) void refresh();
      if (app.isPackaged && !test) {
        const first = setTimeout(() => { void updates.check(); }, 15_000);
        first.unref();
        const repeat = setInterval(() => { void updates.check(); }, 6 * 60 * 60_000);
        repeat.unref();
      }
      interval = setInterval(() => {
        if (store.state.settings.connected) void refresh();
      }, 15 * 60_000);
    } catch (error) {
      dialog.showErrorBox(tr("爪印暂时无法启动"), tr(error.message));
      app.quit();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !tray) app.quit();
  });
  app.on("before-quit", (event) => {
    activityBubble.close();
    clearInterval(interval);
    clearInterval(trayWatch);
    clearTimeout(idleTimer);
    clearTimeout(socialTimer);
    if (!quitting && store) {
      event.preventDefault();
      void rememberPosition();
      quitting = true;
      void Promise.all([queue, lan?.close(), activity?.close(), quota?.close()]).finally(() => app.quit());
    }
  });
}
