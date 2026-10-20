import type { MatchState } from "../game";

/** The base end-of-turn maximum before active card effects. */
export const BASE_MAXIMUM_HAND_SIZE = 7;

/**
 * Shields of Vestroia 99: while Sophie is in the Hero zone, her controller's
 * maximum hand size increases by one and every opposing player's decreases by
 * one. The printed catalogue text explicitly states only the opponent
 * reduction; the controller increase is an additional reviewed game ruling.
 *
 * Derive this value from active Heroes, rather than mutating player state,
 * so multiple copies stack and removing a source immediately restores limits.
 */
export function maximumHandSizeForPlayer(state: MatchState, playerId: string): number {
  const adjustment = state.players.reduce((total, controller) => (
    total + controller.heroes.reduce((heroTotal, hero) => (
      heroTotal + (hero.catalogId === "sv-99" ? (controller.id === playerId ? 1 : -1) : 0)
    ), 0)
  ), 0);
  return Math.max(0, BASE_MAXIMUM_HAND_SIZE + adjustment);
}
