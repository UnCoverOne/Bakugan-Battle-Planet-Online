import type { MatchState } from "../game";

/** Additional ordinary Energize Step decisions granted by live Hero text. */
const EXTRA_HAND_ENERGIZE = /\bmay Energize an additional card from your hand each turn\b/i;
/** A replacement destination for Action cards that finish resolving. */
const ACTION_TO_ENERGY = /\bAction cards you play are Energized uncharged\b/i;

export function additionalTurnEnergizesForPlayer(state: MatchState, playerId: string): number {
  return state.players.find((player) => player.id === playerId)?.heroes
    .filter((hero) => EXTRA_HAND_ENERGIZE.test(hero.effect)).length ?? 0;
}

export function actionCardsEnergizeUnchargedForPlayer(state: MatchState, playerId: string): boolean {
  return Boolean(state.players.find((player) => player.id === playerId)?.heroes
    .some((hero) => ACTION_TO_ENERGY.test(hero.effect)));
}
