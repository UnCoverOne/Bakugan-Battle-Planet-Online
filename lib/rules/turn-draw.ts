import type { GameCard, MatchState } from "../game";

export type ExtraTurnDrawTarget = "controller" | "opponent" | "all-players";

export type ExtraTurnDrawModifier = {
  id: string;
  sourceCardId: string;
  controllerId: string;
  target: ExtraTurnDrawTarget;
  amount: number;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const EXTRA_TURN_DRAW = /\b(all players|each player|you|your opponent)\s+draws?\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?additional cards?\s+each turn\b/gi;

function amountFor(value: string | undefined) {
  if (!value) return 1;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || 1);
}

function targetFor(subject: string): ExtraTurnDrawTarget {
  if (/^your opponent$/i.test(subject)) return "opponent";
  if (/^(?:all players|each player)$/i.test(subject)) return "all-players";
  return "controller";
}

/**
 * Compile the generic "additional draw each turn" mechanic from a card's
 * printed rules text. This intentionally has no card-name or catalogue-ID
 * knowledge: any in-play source with matching text activates the same mechanic.
 */
export function extraTurnDrawModifiersForCard(
  card: GameCard,
  controllerId: string,
): ExtraTurnDrawModifier[] {
  const text = card.effect.replace(/\s+/g, " ").trim();
  return [...text.matchAll(EXTRA_TURN_DRAW)].map((match, index) => ({
    id: `${card.id}:extra-turn-draw:${index}`,
    sourceCardId: card.id,
    controllerId,
    target: targetFor(match[1]),
    amount: amountFor(match[2]),
  }));
}

/**
 * Return every currently active extra-turn-draw modifier.
 *
 * Hero cards activate their static text only while they are in the Hero zone.
 * Each physical copy is evaluated independently, so multiple copies stack.
 */
export function activeExtraTurnDrawModifiers(state: MatchState): ExtraTurnDrawModifier[] {
  return state.players.flatMap((controller) => controller.heroes.flatMap((hero) => (
    extraTurnDrawModifiersForCard(hero, controller.id)
  )));
}

function modifierAffectsPlayer(
  state: MatchState,
  modifier: ExtraTurnDrawModifier,
  playerId: string,
) {
  if (modifier.target === "all-players") return state.players.some((player) => player.id === playerId);
  if (modifier.target === "controller") return modifier.controllerId === playerId;
  return state.players.some((player) => player.id === playerId && player.id !== modifier.controllerId);
}

export function extraTurnDrawsForPlayer(state: MatchState, playerId: string) {
  return activeExtraTurnDrawModifiers(state)
    .filter((modifier) => modifierAffectsPlayer(state, modifier, playerId))
    .reduce((total, modifier) => total + modifier.amount, 0);
}

export function turnDrawCountForPlayer(state: MatchState, playerId: string, baseDraws = 1) {
  return Math.max(0, baseDraws) + extraTurnDrawsForPlayer(state, playerId);
}

export function turnDrawCounts(state: MatchState, baseDraws = 1): Record<string, number> {
  return Object.fromEntries(state.players.map((player) => [
    player.id,
    turnDrawCountForPlayer(state, player.id, baseDraws),
  ]));
}
