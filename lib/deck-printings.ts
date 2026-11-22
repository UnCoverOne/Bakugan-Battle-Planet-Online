import { CARD_BY_ID, CARDS, type DeckRecord } from "./data";
import { deckConstructionIdentity } from "./deck-validation";
import { inspectorCardPrintings } from "./card-inspector-data";
import type { Core, GameCard } from "./game";

export const cardPrintingKey = (card: GameCard) => `card:${deckConstructionIdentity(card)}`;
export const corePrintingKey = (core: Core) => `core:${core.id}`;

/** One tile and one construction counter for all physical printings. */
export function uniqueConstructionCards(cards: readonly GameCard[]): GameCard[] {
  const seen = new Set<string>();
  return cards.filter(card => {
    if (card.fusionFace === "b") return false;
    const key = cardPrintingKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countConstructionCopies(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const card = CARD_BY_ID.get(id);
    if (!card) continue;
    const key = cardPrintingKey(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function preferredCardPrinting(card: GameCard, preferences?: DeckRecord["printingPreferences"]): GameCard {
  const id = preferences?.[cardPrintingKey(card)];
  if (!id) return card;
  const candidate = CARD_BY_ID.get(id);
  return candidate && inspectorCardPrintings(card, CARDS).some(print => print.catalogId === candidate.catalogId)
    ? candidate : card;
}

export function preferredCorePrinting(core: Core, preferences?: DeckRecord["printingPreferences"]): Core {
  const id = preferences?.[corePrintingKey(core)];
  const printing = core.printings?.find(candidate => candidate.id === id);
  return printing ? { ...core, set: printing.set, number: printing.number, art: printing.art } : core;
}
