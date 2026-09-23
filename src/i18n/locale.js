import { translateText, formatText } from "../../core/i18n.mjs";
let language = "zh";
export const currentLanguage = () => language;
export const localeTag = () => language === "en" ? "en-US" : "zh-CN";
export function setLanguage(value) {
  language = value === "en" ? "en" : "zh";
  document.documentElement.lang = localeTag();
  document.documentElement.dataset.language = language;
}
export const t = value => translateText(value, language);
export const f = (key, ...args) => formatText(key, args, language);

// Translate display text only. Values, names marked translate="no", IDs, event
// handlers and game objects never pass through localization.
function children(value) {
  if (!Array.isArray(value)) return typeof value === "string" ? t(value) : value;
  const result = [], text = [];
  const flush = () => {
    if (!text.length) return;
    const combined = text.join("");
    const translated = t(combined);
    if (translated !== combined) result.push(translated);
    else result.push(...text.map(v => typeof v === "string" ? t(v) : v));
    text.length = 0;
  };
  for (const child of value) {
    if (typeof child === "string" || typeof child === "number") text.push(child);
    else { flush(); result.push(child); }
  }
  flush(); return result;
}
export function localizeProps(type, props) {
  if (!props || language !== "en" || props.translate === "no") return props;
  if (typeof type !== "string" && type !== Symbol.for("react.fragment")) return props;
  const next = { ...props, children: children(props.children) };
  for (const key of ["aria-label", "title", "placeholder", "alt"]) if (typeof props[key] === "string") next[key] = t(props[key]);
  return next;
}
