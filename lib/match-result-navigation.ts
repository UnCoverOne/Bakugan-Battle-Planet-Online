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

/**
 * Opens the result screen only when a game finishes while its match screen is
 * active. A persisted result must never take over unrelated routes, and the
 * same result must not reopen after the player navigates away.
 */
export function shouldOpenMatchResult(
  match: MatchResultSnapshot | null | undefined,
  pathname: string,
  presentedResultKey = "",
) {
  const resultKey = completedMatchKey(match);
  return Boolean(
    resultKey
    && resultKey !== presentedResultKey
    && pathname === "/play/match"
  );
}
