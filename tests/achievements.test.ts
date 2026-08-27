import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_DETAILS,
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_METRICS,
  achievementCompletionKey,
  achievementTrainingConfigurable,
  achievementTrainingRule,
  achievementsFor,
  applyAchievementCompletions,
  normalizeAchievementDefinitions,
  sortAchievements,
  type Achievement,
} from "../lib/achievements";
import {
  ACHIEVEMENT_FACTIONS,
  MONO_MASTERY_FACTIONS,
  normalizeAchievementProgress,
  observeAchievementDecks,
  recordAchievementMatch,
} from "../lib/achievement-progress";
import { STARTER_DECKS, deckIsLegal, type DeckRecord } from "../lib/data";
import { EMPTY_LIFETIME_MATCH_STATS } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");

const legalDeck = (
  sourceDeck: DeckRecord,
  id: string,
  updatedAt: string,
  overrides: Partial<DeckRecord> = {},
): DeckRecord => ({
  ...sourceDeck,
  id,
  name: id,
  updatedAt,
  visibility: "Private",
  ...overrides,
});

test("achievement catalogue uses only the four current progression paths", () => {
  assert.deepEqual(ACHIEVEMENT_CATEGORIES, [
    "Arsenal",
    "Arena",
    "Brawler Network",
    "Compendium",
  ]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 37);
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id)).size, 37);
  assert.deepEqual(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.category)), new Set(ACHIEVEMENT_CATEGORIES));
  assert.deepEqual(Object.keys(ACHIEVEMENT_CATEGORY_DETAILS), ACHIEVEMENT_CATEGORIES);
  for (const item of ACHIEVEMENT_DEFINITIONS) {
    assert.ok(item.target > 0);
    assert.ok(item.name.trim());
    assert.ok(item.description.trim());
    assert.ok(ACHIEVEMENT_CATEGORY_DETAILS[item.category].glyph);
    assert.match(ACHIEVEMENT_CATEGORY_DETAILS[item.category].color, /^#[0-9a-f]{6}$/i);
  }
});

test("legacy achievement metrics and migration code are gone", () => {
  const legacyMetrics = [
    "decks",
    "completeDecks",
    "publicDecks",
    "privateDecks",
    "favouriteDecks",
    "describedDecks",
    "deckFactions",
    "trainingGames",
    "bo1Games",
    "bo3Games",
    "onlineWins",
    "uniqueMainCards",
    "uniqueCharacters",
    "uniqueCores",
  ];
  for (const metric of legacyMetrics) assert.equal((ACHIEVEMENT_METRICS as readonly string[]).includes(metric), false, metric);
  const implementation = source("lib/achievements.ts");
  assert.doesNotMatch(implementation, /PREVIOUS_BUNDLED_DEFINITION_FIELDS|ORIGINAL_BUNDLED_DEFINITION_FIELDS|COMPLETION_REQUIRES_CURRENT_PROGRESS/);
});

test("Arena generic progression has one participation milestone followed only by win milestones", () => {
  assert.deepEqual(
    ACHIEVEMENT_DEFINITIONS.filter((item) => item.category === "Arena" && item.metric === "matches").map((item) => item.target),
    [1],
  );
  assert.deepEqual(
    ACHIEVEMENT_DEFINITIONS.filter((item) => item.category === "Arena" && item.metric === "wins").map((item) => item.target),
    [3, 5, 10, 25, 50],
  );
});

test("old aggregate lifetime wins do not grant current Arena achievements", () => {
  const achievements = achievementsFor([], [], {
    ...EMPTY_LIFETIME_MATCH_STATS,
    matchesPlayed: 50,
    wins: 50,
  });
  assert.equal(achievements.find((item) => item.id === "first-win")?.current, 0);
  assert.equal(achievements.find((item) => item.id === "wins-fifty")?.unlocked, false);
});

test("Arsenal contains Standard, Singleton, Competitive, Character, and BakuCore breadth", () => {
  const arsenal = ACHIEVEMENT_DEFINITIONS.filter((item) => item.category === "Arsenal");
  assert.deepEqual(arsenal.filter((item) => item.metric === "standardDecks").map((item) => item.target), [1, 3]);
  assert.equal(arsenal.find((item) => item.metric === "singletonDecks")?.target, 1);
  assert.equal(arsenal.find((item) => item.metric === "competitiveDecks")?.target, 1);
  assert.equal(arsenal.find((item) => item.metric === "characterCards")?.target, 9);
  assert.equal(arsenal.find((item) => item.metric === "coreTypes")?.target, 5);
});

test("Brawler Network publishing progression is 1, 3, 6, and 9 distinct legal Standard decks", () => {
  assert.deepEqual(
    ACHIEVEMENT_DEFINITIONS.filter((item) => item.metric === "publishedDecks").map((item) => item.target),
    [1, 3, 6, 9],
  );
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "online")?.name, "First Connection");
});

test("deck achievements use authoritative legality and duplicate lists do not inflate progress", () => {
  const sizeOnlyDeck: DeckRecord = {
    id: "invalid-size-only",
    name: "Looks Complete",
    factions: ["Pyrus"],
    bakuganIds: ["character-a", "character-b", "character-c"],
    coreIds: ["core-a", "core-b", "core-c", "core-d", "core-e", "core-f"],
    cardIds: Array.from({ length: 40 }, (_, index) => `unknown-card-${index}`),
    updatedAt: "2026-07-01T10:00:00.000Z",
    visibility: "Private",
    format: "standard",
  };
  assert.equal(deckIsLegal(sizeOnlyDeck), false);
  assert.equal(achievementsFor([sizeOnlyDeck], []).find((item) => item.id === "first-deck")?.unlocked, false);

  assert.ok(STARTER_DECKS.length >= 3);
  assert.ok(STARTER_DECKS.slice(0, 3).every(deckIsLegal));
  const original = legalDeck(STARTER_DECKS[0], "original", "2026-07-01T10:00:00.000Z");
  const copied = legalDeck(STARTER_DECKS[0], "copy", "2026-07-02T10:00:00.000Z");
  const achievements = achievementsFor([original, copied], []);
  assert.equal(achievements.find((item) => item.id === "first-deck")?.current, 1);
  assert.equal(achievements.find((item) => item.id === "deck-builder")?.current, 1);
});

test("deck-building evidence remains after qualifying decks leave the current library", () => {
  const progress = observeAchievementDecks(undefined, STARTER_DECKS.slice(0, 3));
  const achievements = achievementsFor([], [], undefined, undefined, progress);
  assert.equal(achievements.find((item) => item.id === "first-deck")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "deck-builder")?.unlocked, true);
});

test("Compendium discovery comes from a legal Standard deck used in a completed match and persists", () => {
  const deck = STARTER_DECKS[0];
  const progress = recordAchievementMatch(
    undefined,
    { id: "discovery-match", result: "Defeat", mode: "training", format: "bo1" },
    deck,
    [],
  );
  assert.ok(progress.discoveredMainCardIds.length > 0);
  assert.equal(progress.discoveredMainCardIds.length, new Set(deck.cardIds).size);
  const achievements = achievementsFor([], [], undefined, undefined, progress);
  assert.equal(
    achievements.find((item) => item.id === "cards-twenty-five")?.current,
    Math.min(25, progress.discoveredMainCardIds.length),
  );
});

test("Training eligibility is configured per Arena achievement and credited progress is frozen", () => {
  const firstWin = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "first-win");
  assert.ok(firstWin);
  assert.equal(achievementTrainingConfigurable(firstWin), true);
  assert.equal(achievementTrainingRule(firstWin), "allowed");

  let progress = recordAchievementMatch(
    undefined,
    { id: "training-win-1", result: "Victor", mode: "training", format: "bo1" },
    STARTER_DECKS[0],
    [{ id: firstWin.id, metric: firstWin.metric }],
  );
  const disabledDefinitions = ACHIEVEMENT_DEFINITIONS.map((item) =>
    item.id === firstWin.id ? { ...item, trainingAllowed: false } : item,
  );
  let achievements = achievementsFor([], [], undefined, disabledDefinitions, progress);
  assert.equal(achievements.find((item) => item.id === "first-win")?.current, 1);
  assert.equal(achievements.find((item) => item.id === "first-win")?.trainingRule, "blocked");

  progress = recordAchievementMatch(
    progress,
    { id: "training-win-2", result: "Victor", mode: "training", format: "bo1" },
    STARTER_DECKS[0],
    [],
  );
  achievements = achievementsFor([], [], undefined, disabledDefinitions, progress);
  assert.equal(achievements.find((item) => item.id === "first-win")?.current, 1);
});

test("Ranked victory achievements are Arena achievements and cannot be progressed in Training", () => {
  const ranked = ACHIEVEMENT_DEFINITIONS.filter((item) => item.metric === "rankedWins");
  assert.deepEqual(ranked.map((item) => item.target), [1, 5, 10, 25, 50]);
  for (const item of ranked) {
    assert.equal(item.category, "Arena");
    assert.equal(achievementTrainingConfigurable(item), false);
    assert.equal(achievementTrainingRule(item), "ranked");
  }
});

test("faction mastery requires all six winning factions, five mono-faction ten-win milestones, and the capstone", () => {
  const progress = normalizeAchievementProgress({
    winningFactions: { nonTraining: [...ACHIEVEMENT_FACTIONS], training: [] },
    monoFactionWinIds: Object.fromEntries(
      MONO_MASTERY_FACTIONS.map((faction) => [
        faction,
        { nonTraining: Array.from({ length: 10 }, (_, index) => `${faction}-${index}`), training: [] },
      ]),
    ),
  });
  const achievements = achievementsFor([], [], undefined, undefined, progress);
  assert.equal(achievements.find((item) => item.id === "all-factions")?.unlocked, true);
  for (const id of ["games-five", "games-ten", "games-twenty-five", "games-fifty", "games-one-hundred"]) {
    assert.equal(achievements.find((item) => item.id === id)?.unlocked, true, id);
  }
  assert.equal(achievements.find((item) => item.id === "complete-ten")?.unlocked, true);
});

test("Aurelus participates in faction exploration but has no mono-faction mastery", () => {
  assert.deepEqual(ACHIEVEMENT_FACTIONS, ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);
  assert.deepEqual(MONO_MASTERY_FACTIONS, ["Pyrus", "Aquos", "Ventus", "Haos", "Darkus"]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.some((item) => /Aurelus Mastery/i.test(item.name)), false);
});

test("only current namespaced completions are accepted and they stay permanent", () => {
  const live = achievementsFor([], []);
  const oldCompletion = applyAchievementCompletions(live, {
    "first-win": "2026-07-04T10:00:00.000Z",
  });
  assert.equal(oldCompletion.find((item) => item.id === "first-win")?.unlocked, false);

  const completedAt = "2026-08-28T00:00:00.000Z";
  const sticky = applyAchievementCompletions(live, {
    [achievementCompletionKey("first-win")]: completedAt,
  });
  const achievement = sticky.find((item) => item.id === "first-win");
  assert.equal(achievement?.unlocked, true);
  assert.equal(achievement?.status, "completed");
  assert.equal(achievement?.current, achievement?.target);
  assert.equal(achievement?.completedAt, completedAt);
});

test("definition normalization accepts only current ids and current metrics", () => {
  const configured = normalizeAchievementDefinitions([
    { ...ACHIEVEMENT_DEFINITIONS[0], name: "Edited Battle Ready", target: 2 },
    { ...ACHIEVEMENT_DEFINITIONS[1], metric: "completeDecks", target: 99 },
    { id: "obsolete-achievement", name: "Old", description: "Old", category: "Battle", metric: "matches", target: 1 },
  ]);
  assert.equal(configured.length, 2);
  assert.equal(configured[0].name, "Edited Battle Ready");
  assert.equal(configured[0].target, 2);
  assert.equal(configured[1].metric, ACHIEVEMENT_DEFINITIONS[1].metric);
  assert.equal(configured[1].target, 99);
});

test("status views use deterministic sort orders", () => {
  const base = {
    description: "",
    category: "Arena" as const,
    target: 10,
    unlocked: false,
    trainingRule: "blocked" as const,
  };
  const achievements: Achievement[] = [
    { ...base, id: "old", name: "Old", current: 10, unlocked: true, status: "completed", completedAt: "2026-07-01T00:00:00.000Z" },
    { ...base, id: "new", name: "New", current: 10, unlocked: true, status: "completed", completedAt: "2026-07-03T00:00:00.000Z" },
    { ...base, id: "near", name: "Near", current: 9, status: "in-progress", completedAt: null },
    { ...base, id: "far", name: "Far", current: 2, status: "in-progress", completedAt: null },
    { ...base, id: "z", name: "Zulu", current: 0, status: "locked", completedAt: null },
    { ...base, id: "a", name: "Alpha", current: 0, status: "locked", completedAt: null },
  ];
  assert.deepEqual(sortAchievements(achievements, "completed").map((item) => item.id), ["new", "old"]);
  assert.deepEqual(sortAchievements(achievements, "in-progress").map((item) => item.id), ["near", "far"]);
  assert.deepEqual(sortAchievements(achievements, "locked").map((item) => item.id), ["a", "z"]);
});

test("achievement identity and Training rules remain visible across player and Administrator surfaces", () => {
  const achievementsScreen = source("components/routes/AchievementsScreen.tsx");
  const profile = source("components/profile/BrawlerProfileView.tsx");
  const admin = source("components/routes/AchievementRewardManagement.tsx");
  for (const contract of ["ACHIEVEMENT_CATEGORY_DETAILS", "Training progress allowed", "Training progress not allowed", "Ranked matches only"]) {
    assert.match(achievementsScreen, new RegExp(contract));
  }
  assert.match(profile, /ACHIEVEMENT_CATEGORY_DETAILS/);
  assert.match(admin, /achievementTrainingConfigurable/);
  assert.match(admin, /Training progress/);
});
