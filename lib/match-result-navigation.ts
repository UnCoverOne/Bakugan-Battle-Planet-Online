export type MatchResultSnapshot = {
  id: string;
  gameNumber: number;
  phase: string;
  winner: string;
};

/** Stable identity for a completed game within a match series. */
export function completedMatchKey(match: MatchResultSnapshot | null | undefined) {
  if (match?.phase !== "result" || !match.winner) return "";
  return `${match.id}-${match.gameNumber}`;
}

