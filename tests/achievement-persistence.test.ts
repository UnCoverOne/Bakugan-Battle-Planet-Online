import assert from "node:assert/strict";
import test from "node:test";
import {
  observeAchievementDecks,
  recordAchievementMatch,
} from "../lib/achievement-progress";
import { STARTER_DECKS } from "../lib/data";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BRAWLER_PROFILE,
  EMPTY_LIFETIME_MATCH_STATS,
  mergeSnapshots,
  normalizeAchievementCompletions,
  normalizeSnapshot,
  type UserSnapshot,
} from "../lib/persistence";

const snapshot = (
  updatedAt: number,
  achievementCompletions: Record<string, string> = {},
): UserSnapshot => ({
  schemaVersion: 1,
  updatedAt,
  profile: {
    ...DEFAULT_BRAWLER_PROFILE,
    achievementCompletions,
  },
  decks: [],
  deletedDecks: [],
  history: [],
  lifetimeStats: EMPTY_LIFETIME_MATCH_STATS,
  settings: DEFAULT_APP_SETTINGS,
  route: "dashboard",
  selectedDeckId: "",
  builderDeck: null,
  deckQuery: "",
  compendiumQuery: "",
  compendiumTab: "cards",
  format: "bo1",
  matchMode: "solo",
  joinCode: "",
  match: null,
  online: false,
  selectedCore: "",
  logFilter: "all",
  replay: null,
  replayIndex: 0,
  playerId: "player",
});

test("achievement completion timestamps are normalized and invalid entries are discarded", () => {
  assert.deepEqual(normalizeAchievementCompletions({
    "first-deck": "2026-07-04T10:00:00Z",
    invalid: "not-a-date",
    empty: null,
  }), {
    "first-deck": "2026-07-04T10:00:00.000Z",
  });
});

test("snapshot normalization preserves permanent achievement completions", () => {
  const fallback = snapshot(0);
  const normalized = normalizeSnapshot({
    ...fallback,
    profile: {
      ...fallback.profile,
      achievementCompletions: {
        "first-deck": "2026-07-04T10:00:00Z",
      },
    },
  }, fallback);

  assert.deepEqual(normalized.profile.achievementCompletions, {
    "first-deck": "2026-07-04T10:00:00.000Z",
  });
});

test("local and cloud snapshots union completion evidence and retain the earliest completion date", () => {
  const local = snapshot(20, {
    "first-deck": "2026-07-04T10:00:00.000Z",
    publisher: "2026-07-06T10:00:00.000Z",
  });
  const cloud = snapshot(10, {
    "first-deck": "2026-07-03T10:00:00.000Z",
    "first-win": "2026-07-05T10:00:00.000Z",
  });
  const merged = mergeSnapshots(local, cloud);

  assert.deepEqual(merged.profile.achievementCompletions, {
    "first-deck": "2026-07-03T10:00:00.000Z",
    publisher: "2026-07-06T10:00:00.000Z",
    "first-win": "2026-07-05T10:00:00.000Z",
  });
});

test("permanent deck and match achievement evidence survives normalization", () => {
  const fallback = snapshot(0);
  let progress = observeAchievementDecks(undefined, STARTER_DECKS.slice(0, 2));
  progress = recordAchievementMatch(
    progress,
    { id: "match-one", result: "Victor", mode: "casual", format: "bo1", opponentKey: "opponent-a" },
    STARTER_DECKS[0],
  );

  const normalized = normalizeSnapshot({
    ...fallback,
    profile: {
      ...fallback.profile,
      achievementProgress: progress,
    },
  }, fallback);

  assert.equal(normalized.profile.achievementProgress?.standardDeckIds.length, 2);
  assert.ok((normalized.profile.achievementProgress?.discoveredMainCardIds.length ?? 0) > 0);
  assert.deepEqual(normalized.profile.achievementProgress?.arenaWinIds.nonTraining, ["match-one"]);
  assert.deepEqual(normalized.profile.achievementProgress?.processedMatchIds, ["match-one"]);
});

test("local and cloud snapshots union permanent achievement progress", () => {
  const local = snapshot(20);
  const cloud = snapshot(10);
  local.profile.achievementProgress = recordAchievementMatch(
    observeAchievementDecks(undefined, [STARTER_DECKS[0]]),
    { id: "local-win", result: "Victor", mode: "casual", format: "bo1", opponentKey: "alice" },
    STARTER_DECKS[0],
  );
  cloud.profile.achievementProgress = recordAchievementMatch(
    observeAchievementDecks(undefined, [STARTER_DECKS[1]]),
    { id: "cloud-win", result: "Victor", mode: "ranked", format: "bo3", opponentKey: "bob" },
    STARTER_DECKS[1],
  );

  const merged = mergeSnapshots(local, cloud);
  const progress = merged.profile.achievementProgress!;
  assert.deepEqual(new Set(progress.processedMatchIds), new Set(["local-win", "cloud-win"]));
  assert.deepEqual(new Set(progress.onlineOpponentKeys), new Set(["alice", "bob"]));
  assert.deepEqual(new Set(progress.arenaWinIds.nonTraining), new Set(["local-win", "cloud-win"]));
  assert.deepEqual(progress.rankedWinIds, ["cloud-win"]);
  assert.ok(progress.discoveredMainCardIds.length >= new Set(STARTER_DECKS[0].cardIds).size);
});

test("competitive deck normalization keeps its full fifty-card main deck", () => {
  const fallback = snapshot(0);
  const normalized = normalizeSnapshot({
    ...fallback,
    decks: [{
      id: "competitive",
      name: "Competitive",
      factions: ["Pyrus"],
      bakuganIds: ["a", "b", "c"],
      coreIds: ["1", "2", "3", "4", "5", "6"],
      cardIds: Array.from({ length: 50 }, (_, index) => `card-${index}`),
      updatedAt: "2026-07-04T10:00:00.000Z",
      visibility: "Private",
      format: "competitive",
    }],
  }, fallback);

  assert.equal(normalized.decks[0]?.cardIds.length, 50);
});
