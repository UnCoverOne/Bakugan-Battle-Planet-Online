import type { GameCard, MatchState } from "../../lib/game";

export type DiscardFlipTransition = {
  playerId: string;
  count: number;
  cards: readonly GameCard[];
};

function deckCount(player: MatchState["players"][number]) {
  return Number.isFinite(player.deck) ? player.deck : player.deckCards.length;
}

/**
 * Detect cards that leave a player's main deck and become newly public in that
 * player's discard pile. Exact card identity is used whenever the previous
 * deck is available; redacted online states fall back to public zone deltas.
 */
export function discardFlipTransitions(
  previous: MatchState | null | undefined,
  current: MatchState | null | undefined,
): readonly DiscardFlipTransition[] {
  if (!previous || !current || previous.id !== current.id) return [];

  return current.players.flatMap((player) => {
    const before = previous.players.find((candidate) => candidate.id === player.id);
    if (!before) return [];

    const deckDelta = Math.max(0, deckCount(before) - deckCount(player));
    if (!deckDelta) return [];

    const previousDiscardIds = new Set(before.discard.map((card) => card.id));
    const newlyDiscarded = player.discard.filter((card) => !previousDiscardIds.has(card.id));
    if (!newlyDiscarded.length) return [];

    const previousDeckIds = new Set(before.deckCards.map((card) => card.id));
    const exactDeckCards = newlyDiscarded.filter((card) => previousDeckIds.has(card.id));
    if (exactDeckCards.length) {
      const cards = exactDeckCards.slice(-Math.min(deckDelta, exactDeckCards.length));
      return [{ playerId: player.id, count: cards.length, cards }];
    }

    // Online projections hide deck order. Account for simultaneous hand gains
    // before assigning the remaining public deck loss to the discard pile.
    const handGain = Math.max(0, player.hand.length - before.hand.length);
    const discardCount = Math.min(
      newlyDiscarded.length,
      Math.max(0, deckDelta - Math.min(deckDelta, handGain)),
    );
    if (!discardCount) return [];

    const cards = newlyDiscarded.slice(-discardCount);
    return [{ playerId: player.id, count: cards.length, cards }];
  });
}
