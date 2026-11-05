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

// All-mode headline totals are shared by the menu, dashboard, own profile and public profile.
// Signed-in accounts use the deduplicated server archive; guests retain lifetime
// counters because their device history keeps only a small recent window.
export function playerMatchSummary(
  history: readonly MatchRecord[],
  lifetimeStats: LifetimeMatchStats,
  signedIn: boolean,
) {
  const archived = lifetimeMatchStatsFromHistory(history);
  const matchesPlayed = signedIn
    ? archived.matchesPlayed
    : Math.max(archived.matchesPlayed, lifetimeStats.matchesPlayed);
  const gamesWon = signedIn
    ? archived.wins
    : Math.max(archived.wins, lifetimeStats.wins);
  // Older guest counters may be incomplete; never show more wins than games.
  const gamesPlayed = Math.max(matchesPlayed, gamesWon);
  const trainingGames = signedIn
    ? archived.trainingMatches
    : Math.max(archived.trainingMatches, lifetimeStats.trainingMatches);
  const competitiveGames = signedIn
    ? accountStatMatches(history).length
    : Math.max(accountStatMatches(history).length, matchesPlayed - trainingGames);
  return {
    gamesPlayed,
    gamesWon,
    winRate: gamesPlayed ? Math.round((gamesWon / gamesPlayed) * 100) : 0,
    trainingGames,
    competitiveGames,
  };
}
