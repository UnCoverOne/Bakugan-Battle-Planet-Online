import type { GameCard, MatchState } from "../../lib/game";

export type EnergizeTransition = {
  playerId: string;
  cards: readonly GameCard[];
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
    const previousIds = new Set(before.energyZone.map((card) => card.id));
    const cards = player.energyZone.filter((card) => !previousIds.has(card.id));
    return cards.length ? [{ playerId: player.id, cards }] : [];
  });
}
