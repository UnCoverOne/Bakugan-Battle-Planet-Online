import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredHistory } from "../lib/local-storage-normalization";
import { MAX_MATCH_RECORDS, normalizeLifetimeMatchStats } from "../lib/persistence";

test("match record normalization retains only the latest ten records", () => {
  const history = Array.from({ length: 15 }, (_, index) => ({
    id: `match-${index}`,
    result: index % 2 ? "Victor" : "Defeat",
    opponent: "Opponent",
    score: "1–0",
    reason: "Complete",
    at: new Date(1_900_000_000_000 - index * 1_000).toISOString(),
    schemaVersion: 3,
    replayId: `replay-${index}`,
    replayStorage: "server",
    replayAvailable: true,
  }));
  const normalized = normalizeStoredHistory(history);
  assert.equal(normalized.length, MAX_MATCH_RECORDS);
  assert.equal(normalized[0].id, "match-0");
  assert.equal(normalized.at(-1)?.id, "match-9");
  assert.ok(normalized.every((record) => record.log == null));
});

test("lifetime counters remain independent from retained record count", () => {
  const stats = normalizeLifetimeMatchStats({ matchesPlayed: 250, wins: 140, casualMatches: 190, rankedMatches: 60 });
  assert.equal(stats.matchesPlayed, 250);
  assert.equal(stats.wins, 140);
  assert.equal(stats.casualMatches + stats.rankedMatches, 250);
});
