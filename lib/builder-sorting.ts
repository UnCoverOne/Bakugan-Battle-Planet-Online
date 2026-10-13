import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "./catalogue-sorting";
import { compareCompendiumCards, compareCompendiumCores, type CompendiumSort, type CoreCompendiumSort } from "./compendium";
import type { Core, GameCard } from "./game";

export type BuilderCategory = "cards" | "characters" | "cores";
export type BuilderSort = CompendiumSort | CoreCompendiumSort | "count-desc";
export type BuilderGalleryItem =
  | { kind: "card" | "character"; id: string; name: string; card: GameCard; count: number }
  | { kind: "core"; id: string; name: string; core: Core; count: number };

export function builderSortOptions(category: BuilderCategory): Array<[BuilderSort, string]> {
  const options: Array<[BuilderSort, string]> = category === "cores"
    ? Object.entries(CORE_SORT_LABELS) as Array<[CoreCompendiumSort, string]>
    : (Object.entries(SORT_LABELS) as Array<[CompendiumSort, string]>)
      .filter(([value]) => (category === "characters" ? CHARACTER_SORTS : NON_CHARACTER_SORTS).has(value));
  return [...options, ["count-desc", "Copies high–low"]];
}

export function normalizeBuilderSort(category: BuilderCategory, value: string): BuilderSort {
  const migrated = value === "id-asc" ? "collector" : value;
  return builderSortOptions(category).some(([option]) => option === migrated) ? migrated as BuilderSort : "collector";
}

export function sortBuilderItems(left: BuilderGalleryItem, right: BuilderGalleryItem, sort: BuilderSort, set = "All") {
  if (sort === "count-desc") return right.count - left.count || left.name.localeCompare(right.name);
  if (left.kind === "core" && right.kind === "core") {
    return compareCompendiumCores(left.core, right.core, sort as CoreCompendiumSort, set);
  }
  if (left.kind !== "core" && right.kind !== "core") {
    return compareCompendiumCards(left.card, right.card, sort as CompendiumSort);
  }
  return left.name.localeCompare(right.name);
}
