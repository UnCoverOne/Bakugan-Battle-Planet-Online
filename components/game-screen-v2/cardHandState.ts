import type { GameCard, MatchState } from "../../lib/game";

const IDEAL_ANGLE_STEP_DEGREES = 5.25;
const MIN_FAN_SPAN_DEGREES = 7.5;
const MAX_FAN_SPAN_DEGREES = 42;

export type HandCardPosition = {
  rotationDegrees: number;
  zIndex: number;
};

export function playerHandCards(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): readonly GameCard[] {
  if (!match?.players.length) return [];
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];
  return Array.isArray(player.hand) ? player.hand : [];
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
  if (count === 1) return [{ rotationDegrees: 0, zIndex: 100 }];

  const spanDegrees = handFanSpanDegrees(count);
  const stepDegrees = spanDegrees / (count - 1);
  const centre = (count - 1) / 2;

  return Array.from({ length: count }, (_, index) => {
    const rotationDegrees = -spanDegrees / 2 + stepDegrees * index;
    const distanceFromCentre = Math.abs(index - centre);
    return {
      rotationDegrees: Math.abs(rotationDegrees) < 1e-10 ? 0 : rotationDegrees,
      zIndex: Math.round((count - distanceFromCentre) * 100),
    };
  });
}
