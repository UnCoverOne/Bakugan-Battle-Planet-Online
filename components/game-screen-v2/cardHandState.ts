import type { GameCard, MatchState } from "../../lib/game";

export type HandCardPosition = {
  leftPercent: number;
  rotationDegrees: number;
  dropPixels: number;
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

export function handCardLayout(cardCount: number): readonly HandCardPosition[] {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  if (count === 0) return [];
  if (count === 1) {
    return [{ leftPercent: 50, rotationDegrees: 0, dropPixels: 0, zIndex: 1 }];
  }

  const spreadPercent = Math.min(64, (count - 1) * 9);
  const stepPercent = spreadPercent / (count - 1);
  const centre = (count - 1) / 2;
  const halfRange = Math.max(1, centre);
  const maxRotation = Math.min(8, (count - 1) * 2.2);

  return Array.from({ length: count }, (_, index) => {
    const centredIndex = index - centre;
    const normalized = centredIndex / halfRange;
    return {
      leftPercent: 50 - spreadPercent / 2 + stepPercent * index,
      rotationDegrees: normalized * maxRotation,
      dropPixels: Math.abs(normalized) * 13,
      zIndex: index + 1,
    };
  });
}
