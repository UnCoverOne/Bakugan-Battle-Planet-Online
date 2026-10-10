import type { GameCard } from "./game";
export function collectionIdentityIndex(cards: readonly GameCard[]) {
  const ids = new Map<string, string[]>();
  const representatives: GameCard[] = [];
  for (const card of cards) {
    if (card.fusionFace === "b") continue;
    const identity = card.constructionIdentity ?? card.catalogId;
    const group = ids.get(identity);
    if (group) group.push(card.catalogId);
    else { ids.set(identity, [card.catalogId]); representatives.push(card); }
  }
  return { representatives, idsFor: (card: GameCard) => ids.get(card.constructionIdentity ?? card.catalogId) ?? [card.catalogId] };
}
export function frequencyMap(ids: readonly string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
export const cardSearchText = (name: string, card: GameCard) => `${name} ${card.effect ?? ""} ${card.factions.join(" ")} ${card.rarity ?? ""} ${card.mechanics.join(" ")}`.toLowerCase();
