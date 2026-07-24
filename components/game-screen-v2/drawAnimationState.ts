import type { GameCard, MatchState } from "../../lib/game";

export type DrawTransition = {
  playerId: string;
  count: number;
  cards: readonly GameCard[];
};

function deckCount(player: MatchState["players"][number]) {
  return Number.isFinite(player.deck) ? player.deck : player.deckCards.length;
}

/**
 * Detect only hand gains that are paired with cards leaving the same player's
 * deck. This avoids animating cards that return from discard, enter from an
 * effect, or are restored by a state resynchronisation. The public deck count
 * is used so hidden opponent deck contents still produce an animation.
 */
export function drawTransitions(
  previous: MatchState | null | undefined,
  current: MatchState | null | undefined,
): readonly DrawTransition[] {
  if (!previous || !current || previous.id !== current.id) return [];

  return current.players.flatMap((player) => {
    const before = previous.players.find((candidate) => candidate.id === player.id);
    if (!before) return [];

    const deckDelta = Math.max(0, deckCount(before) - deckCount(player));
    const handDelta = Math.max(0, player.hand.length - before.hand.length);
    const count = Math.min(deckDelta, handDelta);
    if (!count) return [];

    const previousIds = new Set(before.hand.map((card) => card.id));
    const newlyVisibleCards = player.hand.filter((card) => !previousIds.has(card.id));
    const cards = newlyVisibleCards.length >= count
      ? newlyVisibleCards.slice(-count)
      : player.hand.slice(-count);

    return [{ playerId: player.id, count, cards }];
  });
}

