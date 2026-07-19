import {
  playCard,
  type CardChoices,
  type MatchState,
  type Phase,
} from "./game";

const PRIORITY_TIMERS: Partial<Record<Phase, number>> = {
  preRoll: 30,
  power: 40,
  victor: 30,
  postDamage: 25,
  endPlay: 35,
};

/**
 * A played card enters the end of the batch, then priority passes to the
 * non-acting player without counting as a pass. This wrapper keeps the
 * authoritative card validation and effect queuing in game.ts while applying
 * the priority rule shared by each card-play window.
 */
export function playCardAndPassPriority(
  input: MatchState,
  playerId: string,
  cardId: string,
  choices: CardChoices = {},
) {
  const state = playCard(input, playerId, cardId, choices);
  const opponent = state.players.find((player) => player.id !== playerId);
  if (!opponent) return state;

  state.priority = opponent.id;
  state.passes = [];
  state.deadline = Date.now() + (PRIORITY_TIMERS[state.phase] ?? 30) * 1000;
  state.log.push({
    id: `${Date.now()}-priority-${state.version}`,
    at: Date.now(),
    kind: "game",
    message: `${opponent.name} received priority after the batch changed.`,
  });
  return state;
}
