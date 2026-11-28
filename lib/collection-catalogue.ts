import type { Core, GameCard } from "./game";
import { cardSetCode } from "./content/catalogue";
import { filterAndSortCompendiumCards, type CompendiumState } from "./compendium";
import { collectionEntryForIds, collectionFieldMatches, COLLECTION_FIELDS, type Collection, type CollectionEntry, type CollectionField, type CollectionSort } from "./collection";

export type CollectionPrinting = { id: string; label: string };
export const COLLECTION_STATUS_OPTIONS = [
  { value: "owned", label: "Owned" },
  { value: "unowned", label: "Unowned" },
  { value: "wishlisted", label: "Wishlisted" },
] as const;
export type CollectionStatus = typeof COLLECTION_STATUS_OPTIONS[number]["value"];
export const ownedCopies = (entry: CollectionEntry) => entry.standard + entry.foil;
export function matchesCollection(entry: CollectionEntry, statuses: readonly string[], quantities: Record<CollectionField, string[]>) {
  const statusMatches = !statuses.length || statuses.some(status => status === "owned" ? ownedCopies(entry) > 0
    : status === "unowned" ? ownedCopies(entry) === 0 : status === "wishlisted" && entry.wishlist > 0);
  return statusMatches && COLLECTION_FIELDS.every(field => collectionFieldMatches(entry, field, quantities[field]));
}
export function sortCollection<T>(items: readonly T[], sort: CollectionSort, entryFor: (item: T) => CollectionEntry): T[] {
  if (sort === "collector") return [...items];
  const [field, direction] = sort.split("-") as [CollectionField | "owned", "asc" | "desc"];
  const count = (item: T) => field === "owned" ? ownedCopies(entryFor(item)) : entryFor(item)[field];
  return items.toSorted((a, b) => direction === "asc" ? count(a) - count(b) : count(b) - count(a));
}
export function cardCollectionCatalogue(cards: readonly GameCard[], state: CompendiumState) {
  const frontByPair = new Map(cards.filter(card => card.fusionFace === "a" && card.fusionPairId).map(card => [card.fusionPairId, card]));
  const front = (card: GameCard) => card.fusionFace === "b" ? frontByPair.get(card.fusionPairId) : card;
  const identity = (card: GameCard) => card.constructionIdentity ?? card.catalogId;
  const groups = new Map<string, CollectionPrinting[]>();
  for (const card of cards) {
    if (card.fusionFace === "b" || (state.set.length && !state.set.includes(cardSetCode(card)))) continue;
    const key = identity(card);
    const printing = { id: card.catalogId, label: card.catalogId.toUpperCase() + " · " + card.displayName };
    const group = groups.get(key);
    if (group) group.push(printing); else groups.set(key, [printing]);
  }
  const seen = new Set<string>();
  const printings = new Map<string, CollectionPrinting[]>();
  const visible = filterAndSortCompendiumCards(cards, state).filter(card => {
    const physical = front(card);
    if (!physical) return false;
    const key = identity(physical);
    const scoped = groups.get(key);
    if (!scoped?.length || seen.has(key)) return false;
    seen.add(key);
    printings.set(card.catalogId, scoped);
    return true;
  });
  return { cards: visible, printings };
}
export function coreCollectionPrintings(core: Core, sets: readonly string[]): CollectionPrinting[] {
  return [
    { id: core.catalogId ?? core.id, set: core.set ?? "Battle Brawlers", number: core.number },
    ...(core.printings ?? []),
  ].filter(printing => !sets.length || sets.includes(printing.set))
    .map(printing => ({ id: printing.id, label: printing.set + " #" + printing.number }));
}
export function printingTotals(collection: Collection, printings: readonly CollectionPrinting[]): CollectionEntry {
  return collectionEntryForIds(collection, printings.map(printing => printing.id));
}
