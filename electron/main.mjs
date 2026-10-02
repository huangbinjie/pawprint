import {AttentionBridge,validAttentionEvent} from './attention.mjs';
import {hooksSettingsScript} from './client-settings.mjs';
import {ClientNavigation} from './client-navigation.mjs';
import {readWorkTitles,readRecentWorkChats} from './work-titles.mjs';
import { workState, workTarget, attentionTarget } from '../core/work.mjs';
import QRCode from 'qrcode';
import {encodePetCard,decodePetCard} from '../core/pet-card.mjs';
import { ActivityBubble } from "./activity-bubble.mjs";
import { companionPersonality, companionLine, CompanionInitiative } from "../core/personality.mjs";
import { CursorAttention, CursorTease } from "../core/attention.mjs";
import { UpdateService } from "./updater.mjs";
import { LanService } from "./lan/service.mjs";
import { CodexActivity, validThreadId } from "./activity.mjs";
import { QuotaMonitor } from "./quota/monitor.mjs";
import { quotaPresentation } from "../core/quota.mjs";
import { translateText, translateMenu, formatText } from "../core/i18n.mjs";
import { IdleDirector, restingPose } from "../core/idle.mjs";
import { talentById } from "../core/talents.mjs";
import { GIFT_SKILLS, skillById, ownsSkill, petSkills, socialCast } from "../core/skills.mjs";
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  Tray,
  Menu,
  nativeImage,
  clipboard,
  ClipboardItem,
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
import { FLOAT_SIZE, floatPosition, companionPanelBounds, petControlsBounds, desktopUpgrade, petScale, scaledFloatSize } from "../core/desktop.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const test = !app.isPackaged && process.env.PAWPRINT_TEST_MODE === "1";
app.setName("Pawprint");
if (process.platform === "win32") app.setAppUserModelId("studio.binmax.pawprint");
app.setPath(
  "userData",
  test && process.env.PAWPRINT_TEST_DATA
    ? process.env.PAWPRINT_TEST_DATA
    : path.join(app.getPath("appData"), "Pawprint"),
);
let attentionBridge,attentionBubbleEvent;
let petControls,setupGuideWindow,setupGuideValue;
let petControlsRevealed=false,petControlsHideTimer;
let petControlsPressed=false,petControlsInteractive=false;
const petControlsHover={pet:false,dock:false};
let workTitlesTimer, workTitlesPending;
let workMini, workPanelRequested=false, workNoteWindow, workNoteValue=null, workNoteTimer;
let home, floating, store, refreshPromise, interval, tray, moveTimer, updates;
const activityBubble = new ActivityBubble();
let dragOrigin = null;
let lan,
  performance = null;
let activity, lastActivityEvent, quota;
let updateNoticeVersion;
const companionBubble = new ActivityBubble();
let companionBubbleTimer;
let companionBubbleActive = false;
let trayImage, trayWatch, trayRecoveries = 0, trayLastReason = "startup";
const TRAY_GUID = "22e5b352-a013-4f52-86fb-68ce83b3b386";
const language = () => store?.state?.settings?.language === "en" ? "en" : "zh";
const tr = value => translateText(value, language());
const buildMenu = items => Menu.buildFromTemplate(translateMenu(items, language()));
let previewScale = null, socialPerformance = null, socialTimer;
const desktopScale = () => previewScale ?? petScale(store?.state.settings);
const desktopSize = (width = FLOAT_SIZE.width) => scaledFloatSize(desktopScale(), width);
const companionInitiative = new CompanionInitiative();
let initiativePending = false;
const cursorAttention = new CursorAttention();
const cursorTease = new CursorTease();
const idleDirector = new IdleDirector({ random: test ? () => 0.8 : Math.random });
let idleVisual = restingPose(), idleTimer, idleTargetPosition;
let idlePausedUntil = 0, idleMenuOpen = false, reducedMotion = false, motionCheckedAt = 0, screenLocked = false, suspended = false;
const guestWindows = new Map();
let cardVisitors = [];
const allVisitors = () => [...(lan?.snapshot().visitors || []), ...cardVisitors.filter(v => v.expiresAt > Date.now())];
function dismissCardVisitor(id) { cardVisitors = cardVisitors.filter(v => v.id !== id); syncGuests(); broadcast(); }
let previousInvites = new Set();
const execute = promisify(execFile);
const clientNavigation=new ClientNavigation({openExternal:(...args)=>shell.openExternal(...args)});
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
    platform: process.platform,
    appVersion: app.getVersion(),
    availableCoins: availableCoins(store.state),
    heldCoins: heldCoins(store.state),
    performance,
    trayStatus: trayStatus(),
    update: updates?.snapshot() ?? { status: "idle", release: null, error: null },
    quota: quota?.snapshot() ?? { enabled: false, loading: false, data: null, error: null },
    cardVisitors: cardVisitors.filter(v => v.expiresAt > Date.now()),
    displayScale: desktopScale(),
    socialPerformance,
    idle: idleVisual,
    activity: { ...(activity?.snapshot() ?? { enabled:false,status:"off",activeCount:0,event:null }), target:workTarget(store.state,activity?.snapshot()) },
    work:workState(store.state),
    workNote:workNoteValue,
    setupGuide:setupGuideValue,
    controlsRevealed:petControlsRevealed,
    attention:attentionBridge?.snapshot() || {status:"off",supported:process.platform==="darwin",lastEventAt:null},
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
  syncPetControls();
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
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
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
    "nearby", "work", "play",
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
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 22, y: 23 },
    } : { icon: path.join(here, "../build/icon.png") }),
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
async function receiveAttention(events) {
  if(quitting || store.state.settings.attentionEnabled!==true)return;
  const valid=events.filter(e=>validAttentionEvent(e));if(!valid.length)return;
  const changed=await enqueue(async()=>{
    const before=workState(store.state).recent;
    const next=transition(store.state,{type:'_work-attention',events:valid},{now:Date.now()});
    const fresh=next.work.recent.filter(r=>r.attention&&!before.some(b=>b.threadId===r.threadId&&(b.attentions || (b.attention?[b.attention]:[])).some(a=>a.id===r.attention.id)));
    if(JSON.stringify(next.work)!==JSON.stringify(store.state.work))await store.save(next);
    return fresh;
  });
  const latest=changed.sort((a,b)=>b.attention.at-a.attention.at)[0];
  if(latest){
    const text=latest.attention.kind==='approval'?'Codex 等你审批':'Codex 等你回答';
    attentionBubbleEvent={at:Date.now(),text:tr(text),threadId:latest.threadId,id:latest.attention.id};
    if(!store.state.settings.workDnd){
      const mode=store.state.settings.workReminder || 'quiet';
      try{if(mode==='sound')shell.beep();
        if(mode==='system'&&Notification.isSupported()){const notice=new Notification({title:'Pawprint',body:tr(text),silent:true});notice.on('click',()=>void openActivitySession(latest.threadId).catch(()=>createWorkPanel()));notice.show();}
      }catch{}
    }
    void syncWorkTitles();
  }
  if(attentionBubbleEvent&&!workState(store.state).recent.some(r=>r.threadId===attentionBubbleEvent.threadId&&(r.attentions || (r.attention?[r.attention]:[])).some(a=>a.id===attentionBubbleEvent.id)))attentionBubbleEvent=null;
  broadcast();
}
async function syncWorkTitles() {
  if(quitting || !store?.state || workTitlesPending)return workTitlesPending;
  const directory=store.state.settings.codexHome || (test && process.env.PAWPRINT_TEST_CODEX_HOME) || defaultCodexHome();
  const ids=workState(store.state).recent.map(r=>r.threadId);
  if(!ids.length)return;
  workTitlesPending=(async()=>{
    const rows=await readWorkTitles(directory,ids);
    if(!rows.length || quitting)return;
    await enqueue(async()=>{
      const current=store.state.settings.codexHome || (test && process.env.PAWPRINT_TEST_CODEX_HOME) || defaultCodexHome();
      if(current!==directory || quitting)return;
      const next=transition(store.state,{type:'_work-metadata',rows},{now:Date.now()});
      if(JSON.stringify(next.work)!==JSON.stringify(store.state.work)){await store.save(next);broadcast();}
    });
  })().catch(()=>{}).finally(()=>{workTitlesPending=null;});
  return workTitlesPending;
}
function hidePetControls(){
  clearTimeout(petControlsHideTimer);petControlsHover.pet=false;petControlsHover.dock=false;
  petControlsPressed=false;setPetControlsInteractive(false);
  if(petControls&&!petControls.isDestroyed())petControls.hide();
  if(petControlsRevealed){petControlsRevealed=false;broadcast();}
}
function setPetControlsInteractive(interactive){
  if(!petControls||petControls.isDestroyed())return;
  const next=petControlsPressed||interactive;
  if(next===petControlsInteractive)return;
  petControlsInteractive=next;petControls.setIgnoreMouseEvents(!next,{forward:true});
}
function schedulePetControlsHide(){
  clearTimeout(petControlsHideTimer);
  if(petControlsPressed)return;
  petControlsHideTimer=setTimeout(()=>{
    if(quitting||petControlsPressed||petControlsHover.pet||petControlsHover.dock)return;
    petControlsRevealed=false;setPetControlsInteractive(false);broadcast();
  },300);
}
function hoverPetControls(surface,hovered){
  if(petControlsHover[surface]===hovered)return;
  petControlsHover[surface]=hovered;clearTimeout(petControlsHideTimer);
  if(petControlsHover.pet||petControlsHover.dock){
    if(!petControlsRevealed){petControlsRevealed=true;setPetControlsInteractive(true);broadcast();}
  }else{
    // Let the cursor cross the small gap between the cat and its separate dock.
    schedulePetControlsHide();
  }
}
function petAnchor(){
  if(!floating||floating.isDestroyed()||!floating.isVisible())return null;
  const p=floating.getBounds();
  if(!petControls||petControls.isDestroyed()||!petControls.isVisible())return p;
  const d=petControls.getBounds(),x=Math.min(p.x,d.x),y=Math.min(p.y,d.y);
  return {x,y,width:Math.max(p.x+p.width,d.x+d.width)-x,height:Math.max(p.y+p.height,d.y+d.height)-y};
}
function syncPetControls(){
  if(quitting||screenLocked||suspended||!floating||floating.isDestroyed()||!floating.isVisible()||!housePets(store.state).length){hidePetControls();return;}
  const p=floating.getBounds(),area=screen.getDisplayMatching(p).workArea;
  const waiting=store.state.settings.attentionEnabled&&attentionTarget(store.state),target=workTarget(store.state,activity?.snapshot());
  const count=1+(target?1:0)+(waiting?1:0),bounds=petControlsBounds(p,area,count);
  if(!petControls||petControls.isDestroyed()){
    const w=new BrowserWindow({...bounds,title:'Pawprint Pet Controls',frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,movable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,acceptFirstMouse:true,show:false,
      webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    petControls=w;petControlsInteractive=false;petControlsPressed=false;w.setIgnoreMouseEvents(true,{forward:true});w.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});w.on('page-title-updated',e=>e.preventDefault());w.once('ready-to-show',()=>{if(w===petControls&&!quitting&&floating?.isVisible())w.showInactive();});w.on('closed',()=>{if(w===petControls)petControls=null;});load(w,'petcontrols');
  }else{petControls.setBounds(bounds,false);if(!petControls.isVisible())petControls.showInactive();}
}
function showClientGuide(kind){
  setupGuideValue={kind,navigation:null};
  const bounds=panelBounds({width:390,height:590});
  if(!setupGuideWindow||setupGuideWindow.isDestroyed()){
    const w=new BrowserWindow({...bounds,title:'Pawprint Client Help',frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,
      webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    setupGuideWindow=w;w.on('page-title-updated',e=>e.preventDefault());w.once('ready-to-show',()=>{if(!quitting&&w===setupGuideWindow)w.show();});w.on('closed',()=>{if(w===setupGuideWindow)setupGuideWindow=null;});load(w,'clientsetup');
  }else{setupGuideWindow.setBounds(bounds,false);setupGuideWindow.show();setupGuideWindow.focus();}
  broadcast();return true;
}
function hideWorkPanel() {
  workPanelRequested=false;
  if (workMini && !workMini.isDestroyed()) workMini.hide();
  idlePausedUntil=Date.now()+1000;
  return true;
}
function hideWorkNote() {
  clearTimeout(workNoteTimer);workNoteValue=null;
  if(workNoteWindow && !workNoteWindow.isDestroyed())workNoteWindow.hide();
}
function panelBounds(preferred) {
  const pet=petAnchor();
  const area=pet ? screen.getDisplayMatching(pet).workArea : screen.getPrimaryDisplay().workArea;
  return companionPanelBounds(pet || {x:area.x+area.width-220,y:area.y+area.height-242,width:220,height:242},area,preferred);
}
function createWorkPanel() {
  if(screenLocked || suspended)return false;
  if(workMini && !workMini.isDestroyed() && workMini.isVisible())return hideWorkPanel();
  workPanelRequested=true;void syncWorkTitles();
  activityBubble.hide();hideWorkNote();companionBubble.hide();
  const bounds=panelBounds({width:350,height:Math.min(580,190+workState(store.state).recent.length*120)});
  if(!workMini || workMini.isDestroyed()) {
    workMini=new BrowserWindow({...bounds,title:'Pawprint Work Chats',frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,movable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,show:false,
      webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    workMini.on('page-title-updated',event=>event.preventDefault());
    workMini.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    const window=workMini;
    window.once('ready-to-show',()=>{if(workPanelRequested && !quitting && !screenLocked && !suspended && window===workMini){window.show();window.focus();}});
    window.on('blur',()=>{if(!quitting)hideWorkPanel();});
    window.on('closed',()=>{if(window===workMini)workMini=null;});
    load(window,'workmini');
  } else {workMini.setBounds(bounds,false);workMini.show();workMini.focus();broadcast();}
  return true;
}
function showWorkNote(target) {
  hideWorkNote();
  if(!target?.bookmark || screenLocked || suspended)return;
  const text=target.bookmark;
  workNoteValue={threadId:target.threadId,title:target.title || target.bookmark, text,at:Date.now()};
  const lines=Math.ceil([...text].reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?14:/[MW@#%]/.test(c)?13:8),0)/278);
  const bounds=panelBounds({width:310,height:Math.max(100,88+lines*20)});
  if(!workNoteWindow || workNoteWindow.isDestroyed()) {
    workNoteWindow=new BrowserWindow({...bounds,title:'Pawprint Work Bookmark',frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,movable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,show:false,
      webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    workNoteWindow.on('page-title-updated',event=>event.preventDefault());
    workNoteWindow.setIgnoreMouseEvents(true);
    workNoteWindow.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    const window=workNoteWindow;
    window.once('ready-to-show',()=>{if(workNoteValue && !quitting && !screenLocked && !suspended && window===workNoteWindow)window.showInactive();});
    window.on('closed',()=>{if(window===workNoteWindow)workNoteWindow=null;});
    load(window,'worknote');
  } else {workNoteWindow.setBounds(bounds,false);workNoteWindow.showInactive();}
  broadcast();
  workNoteTimer=setTimeout(()=>{hideWorkNote();broadcast();},15000);workNoteTimer.unref?.();
}
async function openActivitySession(threadId) {
  const target=threadId ? workState(store.state).recent.find(r=>r.threadId===threadId) : workTarget(store.state,activity?.snapshot());
  if(!validThreadId(target?.threadId))throw new Error("当前没有可返回的 Codex 会话，请开启会话联动并等待新记录。");
  const panelWasVisible=workMini?.isVisible();hideWorkPanel();
  try { await clientNavigation.open(target.threadId); }
  catch {if(panelWasVisible)createWorkPanel();throw new Error("无法打开对应会话，请确认已安装新版 ChatGPT / Codex 桌面客户端。");}
  await enqueue(()=>mutate({type:"work-read",threadId:target.threadId}));
  hideWorkPanel();
  showWorkNote(workState(store.state).recent.find(r=>r.threadId===target.threadId));
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
  const waiting=store.state.settings.attentionEnabled?attentionTarget(store.state):null;
  return [
    {
      label: `爪印 · ${pet?.name || tr(store.state.eggs.length ? "等待孵化的蛋" : store.state.freeEggClaimed ? "伙伴在后花园休息" : "一枚等待相遇的蛋")}`,
      enabled: false,
    },
    {
      label: `宠物币 ${store.state.balance} · 可领取 ${availableReward(store.state, Date.now())}`,
      enabled: false,
    },
    ...(updates?.snapshot().status === 'available' ? [{ label: `更新到 v${updates.snapshot().release.version}`, click: () => createHome('settings') }] : []),
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
    { label: "二维码宠物访问卡", click: () => createHome("nearby") },
    { label: "附近的小屋", click: () => createHome("nearby") },
    { label: "日常小本领", enabled: !!pet, submenu: [...GIFT_SKILLS, ...(pet ? [skillById(petSkills(pet).idle)] : [])].filter(Boolean).map(s => ({ label: s.name,
      enabled: !!pet, click: () => menuAction(() => performSkill(pet.id, s.id)) })) },
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
    ...(waiting?[{label:waiting.attention.kind==='approval'?'Codex 等你审批':'Codex 等你回答',click:()=>menuAction(()=>openActivitySession(waiting.threadId))}]:[]),
    { label:"工作会话与便签",click:createWorkPanel },
    { label:"玩耍与小房间",click:()=>createHome("play") },
    { label: "返回最近 Codex 会话", enabled: validThreadId(workTarget(store.state,activity?.snapshot())?.threadId), click: () => menuAction(openActivitySession) },
    { label: "打开 Codex / ChatGPT", enabled: process.platform === "darwin", click: () => menuAction(openClient) },
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
    if (process.platform === "darwin") tray.setTitle(store.state.settings.trayCompact ? "" : [q.title, invitations ? String(invitations) : ""].filter(Boolean).join(" · "), { fontType: "monospacedDigit" });
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
    path.join(here, process.platform === "darwin" ? "../build/trayTemplate.png" : "../build/icon.png"),
  );
  if (trayImage.isEmpty()) throw new Error("菜单栏图标缺失，请重新构建应用。");
  if (process.platform === "darwin") trayImage.setTemplateImage(true);
  else trayImage = trayImage.resize({ width: 32, height: 32 });
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = new Tray(trayImage, TRAY_GUID);
  if (process.platform === "win32") tray.on("double-click", () => createHome("home"));
  trayLastReason = reason;
  if (reason !== "startup") trayRecoveries++;
  tray.setToolTip("爪印 · Pawprint");
  updateTray();
}
function syncActivityBubble() {
  if (screenLocked || suspended || workNoteValue || workMini?.isVisible() || store.state.settings.workDnd) { activityBubble.hide(); return; }
  if(attentionBubbleEvent && Date.now()-attentionBubbleEvent.at<8000){
    const pet=petAnchor();
    const row=workState(store.state).recent.find(r=>r.threadId===attentionBubbleEvent.threadId);
    activityBubble.update({pet,event:attentionBubbleEvent,subtitle:row?.title || null});return;
  }
  const state = activity?.snapshot();
  const event = state?.event;
  if (!event || Date.now() - event.at >= 8000) { activityBubble.hide(); return; }
  const pet = petAnchor();
  const remaining = state?.activeCount > (event?.kind === "completed" ? 0 : 1)
    ? tr(`还有 ${state.activeCount} 个会话在进行`) : null;
  const subtitle=remaining || (state?.uncertainCount ? tr("还有会话的状态暂不确定") : null);
  activityBubble.update({ pet, event: event ? { ...event, text: tr(event.text) } : null, subtitle });
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
    syncPetControls();syncActivityBubble();
    if(workNoteValue && workNoteWindow && !workNoteWindow.isDestroyed()){const {width,height}=workNoteWindow.getBounds();workNoteWindow.setBounds(panelBounds({width,height}),false);}
    const [x, y] = floating.getPosition();
    if (idleTargetPosition?.x === x && idleTargetPosition?.y === y) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      void rememberPosition()?.catch(() => {});
    }, 350);
  });
  floating.on("show",syncPetControls);floating.on("hide",hidePetControls);
  floating.on("closed", () => {
    hidePetControls();
    floating = null;
    activityBubble.hide();hideWorkPanel();hideWorkNote();
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
  if (command.type === "companion-settings" && !command.enabled && companionBubbleActive) {
    clearTimeout(companionBubbleTimer); companionBubble.hide(); companionBubbleActive = false;
  }
  if (command.type === "activity") await syncActivity();
  if(command.type==='attention-settings' && !command.enabled)attentionBubbleEvent=null;
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
function noteInteraction(petId, kind) {
  void enqueue(() => mutate({ type: "pet-interact", petId, kind })).catch(() => {});
}
function showCompanionNote(pet, text) {
  if (!floating || floating.isDestroyed() || !floating.isVisible()) throw new Error("先显示悬浮宠物，再和伙伴打个招呼。");
  companionBubbleActive = true;
  companionBubble.update({ pet: floating.getBounds(), event: { at: Date.now(), text: tr(text) }, subtitle: pet.name });
  clearTimeout(companionBubbleTimer);
  companionBubbleTimer = setTimeout(() => { companionBubble.hide(); companionBubbleActive = false; }, 8000);
}
function maybeInitiate(pet, now, blocked) {
  const event = companionInitiative.step({ now, pet, history: store.state.companionNotes, language: language(),
    enabled: store.state.settings.companionProactive !== false && store.state.settings.idleEnabled === true,
    blocked: blocked || initiativePending || !floating.isVisible() || companionBubble.key !== null });
  if (!event) return;
  initiativePending = true;
  void enqueue(async () => {
    if (quitting || screenLocked || suspended || reducedMotion || dragOrigin || idleMenuOpen || activity?.snapshot().status === "running" || companionBubble.key !== null || !floating?.isVisible() || store.state.activePetId !== pet.id || store.state.settings.idleEnabled !== true || (performance && Date.now() - performance.at < (performance.duration || 6000))) return;
    const currentPet = housePets(store.state).find(p => p.id === pet.id);
    if (!currentPet || Date.now() - companionPersonality(currentPet).lastInteractionAt < 15 * 60000) return;
    await mutate({ type: "_companion-note", petId: pet.id });
    showCompanionNote(pet, event.text);
    idleDirector.requestBehavior(event.action);
  }).catch(() => {}).finally(() => { initiativePending = false; });
}
function performSkill(petId, skillId) {
  const pet = housePets(store.state).find(p => p.id === petId);
  if (!pet || !ownsSkill(pet, skillId) || !["gift", "idle"].includes(skillById(skillId)?.category)) throw new Error("这位伙伴没有可单独表演的这项技能。");
  if (skillById(skillId).category === "gift" && ["mouse", "peek", "toyroll"].includes(skillId)) {
    if (!floating || floating.isDestroyed() || !floating.isVisible()) throw new Error("先显示悬浮宠物，再试试这个桌面小本领。");
    if (pet.id !== store.state.activePetId) throw new Error("请先选择这位桌面伙伴。");
    if (reducedMotion || (skillId !== "mouse" && activity?.snapshot().status === "running")) throw new Error("伙伴正在休息或陪你工作，稍后再试。");
    endSocial(false); performance = null;
    noteInteraction(pet.id, "play");
    idleDirector.requestBehavior(skillId);
    broadcast();
    return snapshot();
  }
  endSocial(false);
  noteInteraction(pet.id, "play");
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
  endSocial(false); performance = null;
  noteInteraction(store.state.activePetId, "play");
  idleDirector.playBall();
  broadcast();
  return snapshot();
}
function tickIdle() {
  if (quitting) return;
  const now = Date.now();
  let fastHover = false;
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
    if(workMini?.isVisible() || workNoteValue){idleDirector.reset(now);publishIdle(restingPose());return;}
    const mouse = screen.getCursorScreenPoint();
    const near = mouse.x >= x - 28 && mouse.x <= x + size.width + 28 &&
      mouse.y >= y - 28 && mouse.y <= y + size.height + 28;
    fastHover = near && !reducedMotion && !dragOrigin && !idleMenuOpen;
    const userShow = performance?.source !== "activity" && performance?.petId === pet.id && now - performance.at < (performance.duration || 6000);
    if (cursorTease.step({now,pointer:mouse,position,size,blocked:!!dragOrigin||idleMenuOpen||reducedMotion||!!socialPerformance||userShow||idleDirector.isManualChase()})) {
      performance = null; idleDirector.teaseMouse(); noteInteraction(pet.id, "play"); broadcast();
    }
    const manualChase = idleDirector.isManualChase();
    const teased = idleDirector.mouseTeased;
    const performing = !(manualChase && performance?.source === "activity") && performance?.petId === pet.id && !performance.guestId && now - performance.at < (performance.duration || 6000);
    const result = idleDirector.step({ now, position, area, size, skill: petSkills(pet).idle, talent: pet.talent?.id, mouse, preferences: companionPersonality(pet).scores,
      enabled: store.state.settings.idleEnabled === true,
      route: store.state.settings.idleRoute || "line", toys: store.state.settings.idleToys !== false,
      deferRequests: (near || idleMenuOpen || now < idlePausedUntil) && !dragOrigin && !socialPerformance && !reducedMotion && !performing && (manualChase || activity?.snapshot().status !== "running"),
      blocked: (near && !teased) || !!socialPerformance || !!dragOrigin || idleMenuOpen || now < idlePausedUntil || reducedMotion || performing || (!manualChase && activity?.snapshot().status === "running"),
    });
    if (!dragOrigin && (result.position.x !== x || result.position.y !== y)) {
      idleTargetPosition = result.position;
      floating.setPosition(result.position.x, result.position.y, false);
    }
    const gaze = cursorAttention.step({ now, position: result.position, size, area, pointer: mouse,
      enabled: store.state.settings.idleEnabled === true && store.state.settings.idleMouse !== false,
      paused: manualChase || !!dragOrigin || idleMenuOpen || reducedMotion || performing || !!socialPerformance || result.visual.mode !== "rest" });
    publishIdle({ ...result.visual, gaze: result.visual.gaze || gaze });
    maybeInitiate(pet, now, manualChase || near || !!dragOrigin || idleMenuOpen || reducedMotion || performing || !!socialPerformance || result.visual.mode !== "rest" || activity?.snapshot().status === "running");
  } catch {
    idleDirector.reset(now);
    publishIdle(restingPose());
  } finally {
    idleTimer = setTimeout(tickIdle, screenLocked || suspended ? 2000 : ["walk", "mouse", "peek"].includes(idleVisual.mode) ? 33 : fastHover ? 50 : 200);
    idleTimer.unref?.();
  }
}
function activityChanged(value) {
  if (quitting) return;
  const completion=value.event?.kind==='completed' && `${value.event.at}:${value.event.id}`!==lastActivityEvent ? value.event : null;
  if(value.recent?.length || completion)void enqueue(async()=>{
    const next=transition(store.state,{type:'_work-observe',recent:value.recent,completed:completion},{now:Date.now()});
    if(JSON.stringify(next.work)!==JSON.stringify(store.state.work)){await store.save(next);broadcast();}
  }).catch(()=>{});
  if(completion && !store.state.settings.workDnd){
    try {
    const mode=store.state.settings.workReminder || 'quiet';
    if(mode==='sound')shell.beep();
    if(mode==='system' && Notification.isSupported()){
      const notice=new Notification({title:'Pawprint',body:tr('本轮回复结束啦'),silent:true});
      notice.on('click',()=>{void openActivitySession(completion.threadId).catch(()=>createHome('work'));});notice.show();
    }
    } catch { /* OS reminder availability must not interrupt local tracking. */ }
  }
  if (value.status === "running") endSocial(false);
  if((attentionTarget(store.state) || value.activeCount || value.uncertainCount || ["unknown","unavailable","off"].includes(value.status)) && performance?.source==="activity") performance=null;
  const eventKey = value.event ? `${value.event.at}:${value.event.id}` : null;
  if (value.event?.kind === "completed" && eventKey !== lastActivityEvent) {
    lastActivityEvent = eventKey;
    if (!value.activeCount && !value.uncertainCount && !attentionTarget(store.state)) {
      const pets = housePets(store.state);
      const pet = pets.find(p => p.id === store.state.activePetId) || pets[0];
      if (pet) performance = { petId: pet.id, guestId: null, talentId: pet.talent.id,
        level: pet.talent.level, at: Date.now(), source: "activity" };
    }
  }
  if (!value.enabled && performance?.source === "activity") performance = null;
  broadcast();
}
function perform(petId, guestId) {
  endSocial(false);
  const pet = guestId
    ? allVisitors().find((v) => v.id === guestId)?.pet
    : housePets(store.state).find((p) => p.id === petId);
  if (!pet || !talentById(pet.talent?.id))
    throw new Error("这位伙伴暂时不能表演。");
  if (!guestId) noteInteraction(pet.id, "play");
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
  if (quitting || screenLocked || suspended) return;
  cardVisitors = cardVisitors.filter(v => v.expiresAt > Date.now());
  const visitors = allVisitors();
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
        if (!quitting) { if(v.source==='card') dismissCardVisitor(v.id); else if(lan?.enabled) lan.dismissVisitor(v.id); }
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
    const dock=window===petControls,guide=window===setupGuideWindow;
    const owner=[home,floating].includes(window),mini=window===workMini,note=window===workNoteWindow;
    const miniChannel=['paw:state','paw:command','paw:helper-guide','paw:helper-settings','paw:helper-close','paw:activity-open','paw:activity-panel','paw:activity-panel-hide','paw:home'].includes(channel);
    if(!window || (!owner && !mini && !note && !dock && !guide && ![...guestWindows.values()].includes(window)) ||
      (mini && (!miniChannel || (channel==='paw:command' && !/^work-/.test(args[0]?.type || '')) || (channel==='paw:home' && args[0]!=='work'))) ||
      (channel.startsWith('paw:helper-')&&!owner&&!mini&&!dock&&!guide) ||
      (note && channel!=='paw:state') ||
      (dock && !['paw:state','paw:activity-open','paw:activity-panel','paw:helper-guide'].includes(channel)) ||
      (guide && !['paw:state','paw:helper-settings','paw:helper-close'].includes(channel)) ||
      ((channel.startsWith('paw:card-') || channel.startsWith('paw:activity-') || channel.startsWith('paw:attention-')) && !owner && !mini && !dock))return {ok:false,error:tr('来源无效。')};
    if(channel==='paw:command' && /^(play-|room-|work-)/.test(args[0]?.type || '') && !owner && !mini)return {ok:false,error:tr('来源无效。')};
    try {
      if (quitting) throw new Error("应用正在保存并退出。");
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: tr(error.message || "操作失败，请重试。") };
    }
  });
}
const allowed = new Set([
  "play-start", "play-attempt", "play-finish", "room-place", "room-remove", "room-theme",
  "work-pin", "work-bookmark", "work-read", "work-settings",
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
  "pet-interact",
  "companion-settings",
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
        openExternal: url => shell.openExternal(url),
        appPath: process.platform === "darwin" ? path.dirname(path.dirname(path.dirname(app.getPath("exe")))) : app.getPath("exe"),
        onChange: value => {
          if (home && !home.isDestroyed()) home.webContents.send("paw:changed", snapshot());
          updateTray();
          if (app.isPackaged && !test && value.status === 'available' && updateNoticeVersion !== value.release?.version && Notification.isSupported()) {
            updateNoticeVersion = value.release.version;
            const notice = new Notification({ title: `Pawprint v${value.release.version}`, body: tr('发现新版本，点击在应用内更新。') });
            notice.on('click', () => createHome('settings')); notice.show();
          }
        },
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
      register('paw:companion-preview', () => {
        const pet = housePets(store.state).find(p => p.id === store.state.activePetId) || housePets(store.state)[0];
        if (!pet) throw new Error("请先选择一位小屋伙伴。");
        showCompanionNote(pet, companionLine(pet, language()));
        if (!systemPreferences.getAnimationSettings().prefersReducedMotion) {
          endSocial(false);
          performance = { petId: pet.id, guestId: null, skillId: "observe", at: Date.now(), duration: 4000, source: "companion-preview" };
          broadcast();
        }
        return snapshot();
      });
      register('paw:card-create', async id => {
        const pet=store.state.pets.find(p=>p.id===id);if(!pet)throw new Error("请先选择一位伙伴。");
        const code=encodePetCard(pet);return {code,png:await QRCode.toDataURL(code,{errorCorrectionLevel:'M',margin:3,width:360}),card:decodePetCard(code)};
      });
      register('paw:card-copy', async id => {
        const pet=store.state.pets.find(p=>p.id===id);if(!pet)throw new Error("请先选择一位伙伴。");
        const png=await QRCode.toDataURL(encodePetCard(pet),{errorCorrectionLevel:'M',margin:3,width:360});await clipboard.write([new ClipboardItem({'image/png':new Blob([nativeImage.createFromDataURL(png).toPNG()],{type:'image/png'})})]);return true;
      });
      register('paw:card-clipboard', async () => {const items=await clipboard.read(),item=items.find(i=>i.types.includes('image/png'));if(!item)throw new Error("剪贴板里没有二维码图片。");const blob=await item.getType('image/png');if(blob.size>10*1024*1024)throw new Error("二维码图片太大。");const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));const size=image.getSize();return Math.max(size.width,size.height)>2000?image.resize(size.width>=size.height?{width:2000}:{height:2000}).toDataURL():image.toDataURL();});
      register('paw:card-photo',async r=>{if(!home||!r||![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<1||r.width>1000||r.height<1||r.height>800)throw new Error('请先让合照完整显示。');const b=home.getContentBounds();if(r.x+r.width>b.width||r.y+r.height>b.height)throw new Error('请先让合照完整显示。');const image=await home.webContents.capturePage(r);await clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);return true;});
      register('paw:card-read', code => decodePetCard(code));
      register('paw:card-visit', async code => {
        const card=decodePetCard(code);cardVisitors=cardVisitors.filter(v=>v.expiresAt>Date.now());if(cardVisitors.length>=2)throw new Error("已有两位二维码访客，先送一位回家吧。");
        const visit={id:'card-'+randomUUID(),pet:card.pet,temperament:card.temperament,peerName:tr('二维码来访'),source:'card',expiresAt:Date.now()+5*60000};
        cardVisitors.push(visit);await enqueue(async()=>{const next=structuredClone(store.state);next.cardFootprints=[...(next.cardFootprints||[]),{petId:card.pet.id,name:card.pet.name,at:Date.now()}].slice(-50);await store.save(next);});syncGuests();broadcast();return snapshot();
      });
      register('paw:card-dismiss', id => {dismissCardVisitor(id);return snapshot();});
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
            await clipboard.writeText(code);
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
        const v = allVisitors().find((v) => v.id === guestId);
        if (!v) throw new Error("访客已回家。");
        buildMenu([
          { label: formatText("来自{0}的{1}", [v.peerName, v.pet.name], language()), enabled: false },
          { label: "一起玩（打开附近的小屋）", click: () => createHome("nearby") },
          ...(socialPerformance?.visitId === guestId ? [{ label: "结束合演", click: () => endSocial() }] : []),
          {
            label: `表演：${talentById(v.pet.talent.id).name}`,
            click: () => perform(v.pet.id, v.id),
          },
          { label: "送它回家", click: () => v.source==='card'?dismissCardVisitor(v.id):lan.dismissVisitor(v.id) },
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
        if(attentionBridge && attentionBridge.directory!==selected && store.state.settings.attentionEnabled){await attentionBridge.uninstall();await enqueue(()=>mutate({type:'attention-settings',enabled:false}));}
        if(attentionBridge)attentionBridge.directory=selected;
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
        hideWorkPanel();createHome(section);
        return true;
      });
      register("paw:client", openClient);
      register('paw:helper-guide',kind=>{if(kind!=='hooks')throw new Error('Invalid guide.');return showClientGuide(kind);});
      register('paw:helper-close',()=>{setupGuideWindow?.hide();return true;});
      register('paw:helper-settings',async kind=>{
        if(kind==='hooks'){await shell.openExternal('codex://settings');let navigation='settings-only';if(process.platform==='darwin'&&!test){try{const result=await execute('/usr/bin/osascript',['-e',hooksSettingsScript()],{timeout:12000});if(result.stdout.trim()==='opened-hooks')navigation='opened-hooks';}catch{}}showClientGuide('hooks');setupGuideValue.navigation=navigation;broadcast();return {navigation};}
        throw new Error('Invalid settings page.');
      });
      register('paw:attention-connect',async()=>{
        const installed=await attentionBridge.install();await enqueue(()=>mutate({type:'attention-settings',enabled:true}));
        await attentionBridge.configure(true);await activity?.refreshAttention();return {...installed,state:snapshot()};
      });
      register('paw:attention-disconnect',async()=>{let error;try{await attentionBridge.uninstall();}catch(e){error=e;}await attentionBridge.configure(false);await enqueue(()=>mutate({type:'attention-settings',enabled:false}));if(error)throw new Error('Reminders are stopped. Existing hooks.json could not be changed; remove Pawprint’s rules in your client if needed.');return snapshot();});
      register("paw:activity-panel",createWorkPanel);
      register("paw:activity-panel-hide",hideWorkPanel);
      register("paw:activity-open", async (threadId) => {
        try { return await openActivitySession(threadId); }
        catch(error) { if(!test && !workMini?.isVisible())dialog.showErrorBox(tr("会话跳转失败"),tr(error.message));throw error; }
      });
      register("paw:menu", () => {
        idleMenuOpen = true;
        buildMenu(menuTemplate()).popup({ window: floating, callback: () => {
          idleMenuOpen = false;
          idlePausedUntil = Date.now() + 2000;
        } });
        return true;
      });
      ipcMain.on('paw:pointer',(event,interactive)=>{
        const target=event.sender===floating?.webContents?floating:event.sender===petControls?.webContents?petControls:null;
        if(target&&!target.isDestroyed()&&typeof interactive==='boolean'&&!dragOrigin){if(target===petControls)setPetControlsInteractive(interactive);else target.setIgnoreMouseEvents(!interactive,{forward:true});}
      });
      ipcMain.on('paw:controls-press',(event,pressed)=>{
        if(quitting||event.sender!==petControls?.webContents||typeof pressed!=='boolean')return;
        petControlsPressed=pressed;clearTimeout(petControlsHideTimer);
        if(pressed){setPetControlsInteractive(true);if(!petControlsRevealed){petControlsRevealed=true;broadcast();}}
        else if(!petControlsHover.pet&&!petControlsHover.dock)schedulePetControlsHide();
      });
      ipcMain.on('paw:controls-hover',(event,hovered)=>{
        if(quitting||screenLocked||suspended||typeof hovered!=='boolean'||!floating||floating.isDestroyed()||!floating.isVisible())return;
        const surface=event.sender===floating?.webContents?'pet':event.sender===petControls?.webContents?'dock':null;
        if(surface)hoverPetControls(surface,hovered);
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
      if(store.fresh)createHome('home');
      app.on('activate',()=>{
        const point=screen.getCursorScreenPoint();
        const onPet=[floating,petControls].some(w=>{
          if(!w||w.isDestroyed()||!w.isVisible())return false;
          const b=w.getBounds();return point.x>=b.x&&point.x<b.x+b.width&&point.y>=b.y&&point.y<b.y+b.height;
        });
        if(!onPet&&!petControlsPressed)createHome();
      });
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
      const clientDirectory=store.state.settings.codexHome || (test&&process.env.PAWPRINT_TEST_CODEX_HOME) || defaultCodexHome();
      attentionBridge=new AttentionBridge({dataDirectory:app.getPath('userData'),directory:clientDirectory,execPath:process.execPath,relayPath:path.join(here,'attention-hook.cjs'),onEvents:receiveAttention,onChange:()=>{if(!quitting)broadcast();}});
      await attentionBridge.configure(store.state.settings.attentionEnabled===true);
      if(store.state.settings.attentionEnabled)await attentionBridge.prepareDefaults();
      if(store.state.settings.activityEnabled&&!workState(store.state).recent.length){
        const recent=await readRecentWorkChats(clientDirectory);
        if(recent.length)await enqueue(()=>mutate({type:'_work-observe',recent}));
      }
      activity = new CodexActivity({ onChange: activityChanged,onAttention:receiveAttention });
      await syncActivity();
      if(store.state.settings.attentionEnabled)await activity.refreshAttention();
      await queue;await syncWorkTitles();
      workTitlesTimer=setInterval(()=>{
        void syncWorkTitles();
        if(store.state.settings.attentionEnabled&&attentionBridge.snapshot().status==='question-only')void attentionBridge.prepareDefaults();
      },10000);workTitlesTimer.unref?.();
      quota = new QuotaMonitor({ onChange: () => { if (!quitting) broadcast(); } });
      await syncQuota();
      updateTray();
      syncFloating();
      tickIdle();
      const pauseVisuals = () => {
        activityBubble.hide();hideWorkPanel();hideWorkNote();
        floating?.hide();hidePetControls();setupGuideWindow?.hide();
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
    hideWorkNote();workMini?.destroy();workNoteWindow?.destroy();petControls?.destroy();setupGuideWindow?.destroy();
    activityBubble.close();
    companionBubble.close();
    clearTimeout(companionBubbleTimer);
    clearTimeout(petControlsHideTimer);
    clearInterval(interval);clearInterval(workTitlesTimer);
    clearInterval(trayWatch);
    clearTimeout(idleTimer);
    clearTimeout(socialTimer);
    if (!quitting && store) {
      event.preventDefault();
      void rememberPosition();
      quitting = true;
      void Promise.all([workTitlesPending, queue, attentionBridge?.close(), lan?.close(), activity?.close(), quota?.close()]).finally(() => app.quit());
    }
  });
}
