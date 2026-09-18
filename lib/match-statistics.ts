import type { LifetimeMatchStats, MatchResultRecord } from "./persistence";

type MatchRecord = Partial<MatchResultRecord>;

/** Results caused by leaving a match remain visible in history but do not count toward statistics. */
function completedStatMatches(history: readonly MatchRecord[]) {
  const unique = new Map<string, MatchRecord>();
  for (const record of history) {
    if (!record.id || /disconnect|abandon/i.test(record.reason ?? "")) continue;
    unique.set(record.id, record);
  }
  return [...unique.values()];
}

/** Practice results remain visible in match history, but never affect account competition statistics. */
export function countsTowardAccountStats(record: MatchRecord) {
  return record.mode !== "training"
    && !/disconnect|abandon/i.test(record.reason ?? "");
}

export function accountStatMatches(history: readonly MatchRecord[]) {
  return completedStatMatches(history).filter(countsTowardAccountStats);
}

/**
 * Rebuild lifetime totals from immutable, deduplicated match records.
 * Signed-in accounts use the server history archive as the authoritative
 * ledger, so replaying or reloading one completed result cannot increment a
 * counter twice.
 */
export function lifetimeMatchStatsFromHistory(
  history: readonly MatchRecord[],
): LifetimeMatchStats {
  const matches = completedStatMatches(history);
  return {
    matchesPlayed: matches.length,
    wins: matches.filter((record) => record.result === "Victor").length,
    losses: matches.filter((record) => record.result === "Defeat").length,
    draws: matches.filter((record) => record.result === "Draw").length,
    trainingMatches: matches.filter((record) => record.mode === "training").length,
    casualMatches: matches.filter(
      (record) => record.mode === "casual" || record.mode === "online",
    ).length,
    rankedMatches: matches.filter((record) => record.mode === "ranked").length,
  };
}
