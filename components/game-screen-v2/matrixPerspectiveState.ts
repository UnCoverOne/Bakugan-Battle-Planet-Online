import type { MatchState } from "../../lib/game";

export type MatrixPoint = { x: number; y: number };

/**
 * The second player sits across the Hide Matrix, so their local rendering is a
 * half-turn of the canonical server coordinates. Cell IDs remain canonical.
 */
export function playerUsesOppositeMatrixPerspective(
  match: Pick<MatchState, "players"> | null | undefined,
  playerId?: string,
) {
  if (!match?.players.length || !playerId) return false;
  return match.players.findIndex((player) => player.id === playerId) > 0;
}

export function orientMatrixPoint(
  point: MatrixPoint,
  oppositePerspective: boolean,
  width: number,
  height: number,
): MatrixPoint {
  return oppositePerspective
    ? { x: width - point.x, y: height - point.y }
    : point;
}

export function orientMatrixPath(
  points: readonly MatrixPoint[],
  oppositePerspective: boolean,
  width: number,
  height: number,
) {
  return oppositePerspective
    ? points.map((point) => orientMatrixPoint(point, true, width, height))
    : points;
}

