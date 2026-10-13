import type { DeckFormat } from "./data";
import { deckConstructionIdentity, type DeckRestriction, type ValidationCard } from "./deck-validation";

export function createBuilderCardControls(
  cardIds: readonly string[],
  catalogue: ReadonlyMap<string, ValidationCard>,
  format: DeckFormat | undefined,
  restrictions: readonly DeckRestriction[],
  maximum: number,
  rulesReady: boolean,
) {
  const counts = new Map<string, number>();
  const limits = new Map(restrictions.map(rule => [rule.constructionIdentity, rule.limit]));
  for (const id of cardIds) {
    const card = catalogue.get(id);
    if (card) {
      const identity = deckConstructionIdentity(card);
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
  }
  return {
    canAdd(id: string) {
      const card = catalogue.get(id);
      if (!card || cardIds.length >= maximum || (format === "competitive" && !rulesReady)) return false;
      const identity = deckConstructionIdentity(card);
      const normalLimit = format === "singleton" ? 1 : 3;
      const limit = format === "competitive" ? Math.min(normalLimit, limits.get(identity) ?? normalLimit) : normalLimit;
      return (counts.get(identity) ?? 0) < limit;
    },
    restrictionLabel(id: string): string | undefined {
      const card = catalogue.get(id);
      if (format !== "competitive" || !rulesReady || !card) return undefined;
      const limit = limits.get(deckConstructionIdentity(card));
      if (limit === undefined) return undefined;
      return limit === 0 ? "Banned in Competitive" : `Competitive: max ${limit} ${limit === 1 ? "copy" : "copies"}`;
    },
  };
}
