export type MatchResultSnapshot = {
  id: string;
  gameNumber: number;
  phase: string;
  winner: string;
  format?: "bo1" | "bo3";
  series?: Record<string, number>;
  ranked?: unknown;
};

export function isCompletedSeriesResult(match: MatchResultSnapshot | null | undefined) {
  if (match?.phase !== "result" || !match.winner) return false;
  const target = match.format === "bo3" ? 2 : 1;
  return Math.max(0, ...Object.values(match.series ?? {}).map(Number)) >= target;
}

/** Stable identity for a fully completed match series. */
export function completedSeriesResultKey(match: MatchResultSnapshot | null | undefined) {
  return isCompletedSeriesResult(match) ? match!.id : "";
}

/** Stable identity for a completed game within a match series. */
export function completedMatchKey(match: MatchResultSnapshot | null | undefined) {
  if (match?.phase !== "result" || !match.winner) return "";
  if (match.ranked) {
    if (Math.max(...Object.values(match.series ?? {}), 0) < 2) return "";
    return match.id;
  }
  return `${match.id}-${match.gameNumber}`;
}

