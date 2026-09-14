import type { Core, GameCard } from "./game";

export const COLLECTION_FIELDS = ["standard", "foil", "wishlist"] as const;
export type CollectionField = (typeof COLLECTION_FIELDS)[number];

export type CollectionEntry = Record<CollectionField, number>;
export type Collection = Record<string, CollectionEntry>;

export const EMPTY_COLLECTION_ENTRY: CollectionEntry = Object.freeze({ standard: 0, foil: 0, wishlist: 0 });

const MAX_COUNT = 999;
const MAX_ENTRIES = 10_000;

export function normalizeCollection(value: unknown): Collection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Collection = {};
  for (const [rawId, rawEntry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
    const id = rawId.trim().slice(0, 160);
    if (!id || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    const count = (field: CollectionField) => Number.isSafeInteger(entry[field])
      ? Math.min(MAX_COUNT, Math.max(0, Number(entry[field])))
      : 0;
    const next = { standard: count("standard"), foil: count("foil"), wishlist: count("wishlist") };
    if (next.standard || next.foil || next.wishlist) normalized[id] = next;
  }
  return normalized;
}

export function collectionEntry(collection: Collection | undefined, id: string): CollectionEntry {
  return collection?.[id] ?? EMPTY_COLLECTION_ENTRY;
}

export function collectionEntryForIds(collection: Collection | undefined, ids: readonly string[]): CollectionEntry {
  return ids.reduce((total, id) => {
    const entry = collectionEntry(collection, id);
    return {
      standard: total.standard + entry.standard,
      foil: total.foil + entry.foil,
      wishlist: total.wishlist + entry.wishlist,
    };
  }, { standard: 0, foil: 0, wishlist: 0 });
}

export function updateCollection(
  collection: Collection,
  id: string,
  field: CollectionField,
  delta: number,
): Collection {
  if (!id || !Number.isFinite(delta) || delta === 0) return collection;
  const current = collectionEntry(collection, id);
  const next = { ...current, [field]: Math.min(MAX_COUNT, Math.max(0, current[field] + Math.trunc(delta))) };
  const result = { ...collection };
  if (next.standard || next.foil || next.wishlist) result[id] = next;
  else delete result[id];
  return result;
}

export function cardCollectionIds(card: GameCard, allCards: readonly GameCard[] = [card]): string[] {
  const identity = card.constructionIdentity ?? card.catalogId;
  return allCards
    .filter((candidate) => candidate.fusionFace !== "b" && (candidate.constructionIdentity ?? candidate.catalogId) === identity)
    .map((candidate) => candidate.catalogId);
}

export function collectionCards(cards: readonly GameCard[]): GameCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (card.fusionFace === "b") return false;
    const identity = card.constructionIdentity ?? card.catalogId;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function coreCollectionIds(core: Core): string[] {
  return [core.catalogId ?? core.id, ...(core.printings ?? []).map((printing) => printing.id)];
}

export function collectionMatches(entry: CollectionEntry, values: readonly string[]): boolean {
  if (!values.length) return true;
  return values.some((value) => value === "1" ? entry.standard === 1 : value === "2" ? entry.standard === 2 : entry.standard >= 3);
}

export function collectionFieldMatches(entry: CollectionEntry, field: CollectionField, values: readonly string[]): boolean {
  if (!values.length) return true;
  const count = entry[field];
  return values.some((value) => value === "1" ? count === 1 : value === "2" ? count === 2 : count >= 3);
}

export const COLLECTION_QUANTITY_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3+", label: "3+" },
] as const;

export const COLLECTION_SORT_OPTIONS = [
  { value: "collector", label: "Collector number" },
  { value: "standard-asc", label: "Standard low–high" },
  { value: "standard-desc", label: "Standard high–low" },
  { value: "foil-asc", label: "Foil low–high" },
  { value: "foil-desc", label: "Foil high–low" },
  { value: "wishlist-asc", label: "Wishlist low–high" },
  { value: "wishlist-desc", label: "Wishlist high–low" },
] as const;

export type CollectionSort = (typeof COLLECTION_SORT_OPTIONS)[number]["value"];
