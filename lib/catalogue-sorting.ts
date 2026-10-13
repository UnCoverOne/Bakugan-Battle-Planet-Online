import type { CompendiumState, CoreCompendiumState } from "./compendium";

export const SORT_LABELS: Record<CompendiumState["sort"], string> = {
  collector: "Collector number",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  "cost-asc": "Energy low–high",
  "cost-desc": "Energy high–low",
  "bpower-desc": "B-Power high–low",
  "damage-desc": "Damage high–low",
};
export const CHARACTER_SORTS = new Set<CompendiumState["sort"]>([
  "collector",
  "name-asc",
  "name-desc",
  "bpower-desc",
  "damage-desc",
]);
export const NON_CHARACTER_SORTS = new Set<CompendiumState["sort"]>([
  "collector",
  "name-asc",
  "name-desc",
  "cost-asc",
  "cost-desc",
]);
export const CORE_SORT_LABELS: Record<CoreCompendiumState["sort"], string> = {
  collector: "Collector number",
  type: "Core type",
  bonus: "B-Power high–low",
  damage: "Damage high–low",
};
