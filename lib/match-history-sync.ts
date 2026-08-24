import { MAX_MATCH_RECORDS, type MatchResultRecord } from "./persistence";

function occurredAt(record: MatchResultRecord) {
  const parsed = Date.parse(record.at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merge account match history pulled from D1 with records that may still be
 * pending in this browser. Local copies win duplicate IDs so device-local
 * replay metadata is never downgraded by an older cloud copy.
 */
export function mergeMatchHistories(
  local: MatchResultRecord[],
  remote: MatchResultRecord[],
  limit = MAX_MATCH_RECORDS,
) {
  const records = new Map<string, MatchResultRecord>();
  for (const record of remote) records.set(record.id, record);
  for (const record of local) records.set(record.id, record);
  return [...records.values()]
    .sort((left, right) => occurredAt(right) - occurredAt(left))
    .slice(0, Math.max(0, limit));
}

export function matchHistoriesEqual(
  left: MatchResultRecord[],
  right: MatchResultRecord[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
