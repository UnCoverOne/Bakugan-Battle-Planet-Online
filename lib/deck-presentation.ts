import { CARD_BY_ID, type DeckRecord } from "./data";
import { cardPrintingKey, preferredCardPrinting } from "./deck-printings";
import type { GameCard } from "./game";

export type DeckCardEntry = {
  card: GameCard;
  count: number;
};

export type EnergyCurveBucket = {
  cost: number | "X";
  label: string;
  count: number;
};

export function groupedDeckCards(deck: Pick<DeckRecord, "cardIds" | "printingPreferences">): DeckCardEntry[] {
  const grouped = new Map<string, DeckCardEntry>();
  for (const id of deck.cardIds) {
    const card = CARD_BY_ID.get(id);
    if (!card) continue;
    const key = cardPrintingKey(card);
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { card, count: 1 });
  }
  return [...grouped.values()]
    .map(({ card, count }) => ({ card: preferredCardPrinting(card, deck.printingPreferences), count }))
    .sort((left, right) => {
      const leftCost = left.card.cost === "X" ? Number.MAX_SAFE_INTEGER : left.card.cost;
      const rightCost = right.card.cost === "X" ? Number.MAX_SAFE_INTEGER : right.card.cost;
      return leftCost - rightCost
        || left.card.type.localeCompare(right.card.type)
        || left.card.displayName.localeCompare(right.card.displayName);
    });
}

export function deckEnergyCurve(deck: Pick<DeckRecord, "cardIds">): EnergyCurveBucket[] {
  const numericCosts = deck.cardIds
    .map((id) => CARD_BY_ID.get(id)?.cost)
    .filter((cost): cost is number => typeof cost === "number");
  const maximumCost = Math.max(0, ...numericCosts);
  const buckets: EnergyCurveBucket[] = Array.from({ length: maximumCost + 1 }, (_, cost) => ({
    cost,
    label: String(cost),
    count: 0,
  }));
  let xCount = 0;

  for (const id of deck.cardIds) {
    const cost = CARD_BY_ID.get(id)?.cost;
    if (cost === "X") xCount += 1;
    else if (typeof cost === "number") buckets[cost].count += 1;
  }

  if (xCount) buckets.push({ cost: "X", label: "X", count: xCount });
  return buckets;
}

export function deckExportFilename(name: string, extension: "txt" | "png") {
  const base = name
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase()
    .slice(0, 72) || "bakugan-deck";
  return `${base}.${extension}`;
}
