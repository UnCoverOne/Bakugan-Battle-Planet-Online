import type { GameCard, MatchState } from "../../lib/game";

export type EnergizeTransition = {
  playerId: string;
  cards: readonly GameCard[];
  deckCards: readonly GameCard[];
};

/** Detect cards that newly entered a player's Energy Zone between authoritative states. */
export function energizeTransitions(
  previous: MatchState | null | undefined,
  current: MatchState | null | undefined,
): readonly EnergizeTransition[] {
  if (!previous || !current || previous.id !== current.id) return [];

  return current.players.flatMap((player) => {
    const before = previous.players.find((candidate) => candidate.id === player.id);
    if (!before) return [];
    const previousEnergyIds = new Set(before.energyZone.map((card) => card.id));
    const cards = player.energyZone.filter((card) => !previousEnergyIds.has(card.id));
    if (!cards.length) return [];

    // A card visible in the previous authoritative deck and newly present in
    // Energy made a direct deck-to-Energy transition. Hidden opponent deck
    // contents naturally produce no reveal candidates for the local client.
    const previousDeckIds = new Set(before.deckCards.map((card) => card.id));
    const deckCards = cards.filter((card) => previousDeckIds.has(card.id));
    return [{ playerId: player.id, cards, deckCards }];
  });
}
