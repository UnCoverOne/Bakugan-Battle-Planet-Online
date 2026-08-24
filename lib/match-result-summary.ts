export type MatchRoundSnapshot = {
  turn?: number;
  log?: Array<{ message?: string }>;
};

/**
 * Count rounds across the full match series. The engine resets `turn` between
 * games in a best-of-three series, while the match log remains cumulative.
 * Older snapshots without turn-start log entries fall back to the current
 * game's turn counter.
 */
export function matchRoundCount(match: MatchRoundSnapshot | null | undefined) {
  const loggedRounds = Array.isArray(match?.log)
    ? match.log.filter((event) => (
      typeof event?.message === "string" && /^Turn \d+ began\./.test(event.message)
    )).length
    : 0;
  const currentGameRounds = Number.isFinite(Number(match?.turn))
    ? Math.max(0, Number(match?.turn))
    : 0;
  return Math.max(loggedRounds, currentGameRounds);
}
