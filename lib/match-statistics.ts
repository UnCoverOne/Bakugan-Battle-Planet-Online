import type { MatchResultRecord } from "./persistence";

type MatchRecord = Partial<MatchResultRecord>;

/** Practice results remain visible in match history, but never affect account competition statistics. */
export function countsTowardAccountStats(record: MatchRecord) {
  return record.mode !== "training"
    && !/disconnect|abandon/i.test(record.reason ?? "");
}

export function accountStatMatches(history: readonly MatchRecord[]) {
  return history.filter(countsTowardAccountStats);
}
