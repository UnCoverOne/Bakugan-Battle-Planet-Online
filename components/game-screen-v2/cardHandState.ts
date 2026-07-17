import type { GameCard, MatchState, PlayerState } from "../../lib/game";

const IDEAL_ANGLE_STEP_DEGREES = 5.25;
const MIN_FAN_SPAN_DEGREES = 7.5;
const MAX_FAN_SPAN_DEGREES = 42;

export type HandCardPosition = {
  rotationDegrees: number;
  zIndex: number;
};

function handPlayers(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): { player: PlayerState | null; opponent: PlayerState | null } {
  if (!match?.players.length) return { player: null, opponent: null };
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
  const opponent = player
    ? match.players.find((candidate) => candidate.id !== player.id) ?? null
    : null;
  return { player, opponent };
}

export function playerHandCards(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): readonly GameCard[] {
  const { player } = handPlayers(match, playerId);
  return Array.isArray(player?.hand) ? player.hand : [];
}

export function opponentHandCardCount(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): number {
  const { opponent } = handPlayers(match, playerId);
  return Array.isArray(opponent?.hand) ? opponent.hand.length : 0;
}

export function handFanSpanDegrees(cardCount: number): number {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  if (count <= 1) return 0;
  return Math.min(
    MAX_FAN_SPAN_DEGREES,
    Math.max(MIN_FAN_SPAN_DEGREES, (count - 1) * IDEAL_ANGLE_STEP_DEGREES),
  );
}

export function handCardLayout(cardCount: number): readonly HandCardPosition[] {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  if (count === 0) return [];
  if (count === 1) return [{ rotationDegrees: 0, zIndex: 1 }];

  const spanDegrees = handFanSpanDegrees(count);
  const stepDegrees = spanDegrees / (count - 1);

  return Array.from({ length: count }, (_, index) => {
    const rotationDegrees = -spanDegrees / 2 + stepDegrees * index;
    return {
      rotationDegrees: Math.abs(rotationDegrees) < 1e-10 ? 0 : rotationDegrees,
      // Cards are ordered left-to-right. Increasing the stacking level makes
      // every card on the right overlap the card immediately to its left.
      zIndex: index + 1,
    };
  });
}
