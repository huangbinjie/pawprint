import english from "./i18n-en.mjs";
export const LANGUAGES = ["zh", "en"];
export const normalizeMessage = text => text.replace(/\s+/g, " ").trim().replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1");
const extras = {
  "应用更新": "App updates",
  "检查更新": "Check for updates",
  "从 GitHub Release 检查新版本": "Check GitHub Releases for a new version",
  "当前已是最新版": "You are up to date",
  "尚无可用的公开版本": "No public release is available yet",
  "正在检查更新…": "Checking for updates…",
  "正在下载并校验…": "Downloading and verifying…",
  "正在安装并重启…": "Installing and restarting…",
  "仅下载 Pawprint 官方仓库的 Apple 芯片 Mac 包；校验 SHA-256、应用标识和版本后安装。安装时会重启应用。": "Only downloads the Apple silicon Mac package from Pawprint's official GitHub repository. Verifies SHA-256, app identity and version before installation. The app restarts to finish the update.",
  "无尾伙伴会原地左右张望，不做追尾旋转。": "Tailless companions gently look around instead of spinning after a tail.",
  "无耳": "Earless", "无尾": "Tailless",
  "侧身动作猫咪": "Side-view animated cat", "正面跑跳动作": "Front-facing movement",
  "待机和跑跳共用同一个形象，抬爪、头尾跟随并平滑起停。预览不花币。": "One character for idle and movement, with stepping paws, head and tail motion, and gentle starts and stops. Previewing is free.",
  "预览跑跳": "Preview run and jump", "先把一位伙伴放到桌面，再预览动作。": "Show a companion on the desktop before previewing movement.",
  "系统已开启减少动态效果，动作预览暂时休息。": "Reduce Motion is enabled. Movement previews are paused.",
  "菜单栏图标不见了？": "Menu bar icon missing?",
  "可重新创建入口。若仍不显示，检查 macOS 系统设置 → 菜单栏 → 允许 Pawprint 显示，或切换仅图标模式减少占位。": "Recreate the menu bar item. If it is still missing, check System Settings → Menu Bar → Allow Pawprint, or use icon-only mode to save space.",
  "入口已创建，实际显示位置由系统菜单栏决定。": "The item exists; macOS controls where it is displayed.",
  "入口当前不可用，请尝试恢复。": "The item is unavailable. Try restoring it.",
  "恢复菜单栏图标": "Restore menu bar icon", "仅显示图标": "Icon only",
  "不在图标旁放数字，额度仍可在菜单中查看。适合菜单栏空间不足时使用。": "Hides the numbers beside the icon. Quota remains in the menu. Useful when menu bar space is limited.",
  "界面语言": "Interface language", "语言": "Language", "立即切换并保存，宠物名字与存档内容保持不变。": "Changes immediately and is saved. Pet names and saved game data stay unchanged.",
  "请选择有效的语言。": "Choose a supported language.",
  "第 {0} 代": "Gen. {0}", "第 {0} 代 · 猫咪": "Gen. {0} · Cat",
  "已陪伴 {0} 个活跃日": "{0} active days together", "还有 {0} 个会话在进行": "{0} conversations still running",
  "{0} 位伙伴在休息": "{0} companions resting", "{0} 枚蛋": "{0} eggs", "{0} 组基因": "{0} gene groups", "{0} 个位置": "{0} spaces",
  "可获取基因 · {0} 类": "Obtainable genes · {0} categories", "共 {0} 笔": "{0} entries",
  "{0}（旧快照）": "{0} (old snapshot)",
  "Lv.{0} · {1}": "Lv.{0} · {1}",
  "后代{0}技能概率 · 每类抽一项": "Offspring {0} skill odds · One per category",
  "{0}，{1}": "{0}, {1}", "{0} · 第 {1} 代": "{0} · Gen. {1}",
  "让{0}去后花园生活？": "Move {0} to the garden?", "{0}的基因档案": "Gene profile: {0}",
  "{0}想连接你的小屋": "{0} would like to connect to your home",
  "{0}的{1}想来串门": "{1} from {0} would like to visit", "{0}的{1}正在你桌面做客": "{1} from {0} is visiting your desktop",
  "{0}带领：{1} · {2}": "{0} leads: {1} · {2}",
};
const catalog = Object.fromEntries(Object.entries({ ...english, ...extras }).map(([k,v]) => [normalizeMessage(k),v]));
const metadataPatterns = new Set(["试试{0}", "表演：{0}", "联机技能：{0}", "{0} · 技能演示", "Lv.{0} · {1}", "陪你{0}", "{0}剩余：{1}", "{0}（旧快照）", "后代{0}技能概率 · 每类抽一项", "{0}：{1}的外观预览"]);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
const patterns = Object.entries(catalog).filter(([k]) => /\{\d+\}/.test(k) && /[a-zA-Z\u3400-\u9fff]/.test(k.replace(/\{\d+\}/g,""))).map(([key, value]) => {
  const indexes = [], parts = key.split(/(\{\d+\})/g);
  const regex = new RegExp("^" + parts.map(p => /^\{\d+\}$/.test(p) ? (indexes.push(Number(p.slice(1,-1))), "([\\s\\S]*?)") : escape(p)).join("") + "$");
  return { key, value, regex, indexes };
}).sort((a,b) => b.key.replace(/\{\d+\}/g, "").length - a.key.replace(/\{\d+\}/g, "").length);
export function translateText(value, language = "zh", depth = 0) {
  if (language !== "en" || typeof value !== "string" || !/[\u3400-\u9fff]/.test(value)) return value;
  const key = normalizeMessage(value);
  let result = catalog[key];
  if (result === undefined && value.includes("\n") && depth < 5) return value.split("\n").map(v => translateText(v, language, depth+1)).join("\n");
  if (result === undefined && depth < 5) {
    for (const p of patterns) {
      const match = value.trim().match(p.regex);
      if (!match) continue;
      const params = {};
      p.indexes.forEach((n, i) => { params[n] = metadataPatterns.has(p.key) ? translateText(match[i+1], language, depth+1) : match[i+1]; });
      result = p.value.replace(/\{(\d+)\}/g, (_, n) => params[n] ?? "");
      break;
    }
  }
  return result === undefined ? value : `${/^\s/.test(value) ? " " : ""}${result}${/\s$/.test(value) ? " " : ""}`;
}
export function formatText(key, args, language = "zh") {
  const template = language === "en" ? catalog[normalizeMessage(key)] ?? key : key;
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? ""));
}
export function translateMenu(items, language) {
  return items.map(item => ({ ...item, ...(typeof item.label === "string" ? { label: translateText(item.label, language) } : {}),
    ...(Array.isArray(item.submenu) ? { submenu: translateMenu(item.submenu, language) } : {}) }));
}
