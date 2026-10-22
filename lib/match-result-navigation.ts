export type MatchResultSnapshot = {
  id: string;
  gameNumber: number;
  phase: string;
  winner: string;
  format?: "bo1" | "bo3";
  series?: Record<string, number>;
  ranked?: unknown;
  resultReason?: string;
};

export function isCompletedSeriesResult(match: MatchResultSnapshot | null | undefined) {
  if (match?.phase !== "result" || !match.winner) return false;
  const target = match.format === "bo3" ? 2 : 1;
  return Math.max(0, ...Object.values(match.series ?? {}).map(Number)) >= target;
}

export function isSeriesIntermissionResult(match: MatchResultSnapshot | null | undefined) {
  if (match?.phase !== "result" || !match.winner || match.format !== "bo3") return false;
  const wins = Math.max(0, ...Object.values(match.series ?? {}).map(Number));
  return wins > 0 && wins < 2;
}

/** Stable identity for a fully completed match series. */
export function completedSeriesResultKey(match: MatchResultSnapshot | null | undefined) {
  return isCompletedSeriesResult(match) ? match!.id : "";
}

/**
 * Only an in-memory transition from an observed, unfinished game may produce
 * a new history record. Mounting or reloading an already-completed game must
 * never recreate history deleted by an administrator.
 */
export function isFreshCompletedMatchResult(
  previous: MatchResultSnapshot | null | undefined,
  current: MatchResultSnapshot | null | undefined,
) {
  return Boolean(
    previous && current
    && previous.id === current.id
    && previous.gameNumber === current.gameNumber
    && !completedMatchKey(previous)
    && completedMatchKey(current)
  );
}

/** Reject incomplete result payloads before showing or uploading a record. */
export function hasRecordableMatchDetails(match: MatchResultSnapshot | null | undefined) {
  const scores = Object.values(match?.series ?? {});
  return Boolean(
    match
    && typeof match.resultReason === "string"
    && match.resultReason.trim()
    && scores.length >= 2
    && scores.every((score) => Number.isInteger(score) && score >= 0)
    && scores.some((score) => score > 0)
  );
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

