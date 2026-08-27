import assert from "node:assert/strict";
import test from "node:test";
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
