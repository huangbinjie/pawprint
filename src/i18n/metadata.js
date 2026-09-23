import { phenotype, TRAITS, describe as original } from "../../core/genetics.mjs";
import { currentLanguage, t } from "./locale.js";
export function describe(genome) {
  if (currentLanguage() !== "en") return original(genome);
  const p = phenotype(genome);
  return `${t(TRAITS.coat[p.coat].name)} ${t(TRAITS.pattern[p.pattern].name)} · ${t(TRAITS.eyes[p.eyes].name)} eyes`;
}
