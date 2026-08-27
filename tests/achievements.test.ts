import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_DETAILS,
  ACHIEVEMENT_DEFINITIONS,
  achievementTrainingConfigurable,
  achievementTrainingRule,
  achievementsFor,
  applyAchievementCompletions,
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

test("achievement catalogue uses four thematic progression paths", () => {
  assert.deepEqual(ACHIEVEMENT_CATEGORIES, [
    "Arsenal",
    "Arena",
    "Brawler Network",
    "Compendium",
  ]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 37);
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id)).size, 37);
  assert.deepEqual(
    new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.category)),
    new Set(ACHIEVEMENT_CATEGORIES),
  );
  assert.deepEqual(Object.keys(ACHIEVEMENT_CATEGORY_DETAILS), ACHIEVEMENT_CATEGORIES);
  for (const item of ACHIEVEMENT_DEFINITIONS) {
    assert.ok(item.target > 0);
    assert.ok(item.name.trim());
    assert.ok(item.description.trim());
    assert.ok(ACHIEVEMENT_CATEGORY_DETAILS[item.category].glyph);
    assert.match(ACHIEVEMENT_CATEGORY_DETAILS[item.category].color, /^#[0-9a-f]{6}$/i);
    assert.ok(ACHIEVEMENT_CATEGORY_DETAILS[item.category].description.trim());
  }
});

test("Arena generic progression has one participation milestone followed only by win milestones", () => {
  const arenaMatches = ACHIEVEMENT_DEFINITIONS.filter(
    (item) => item.category === "Arena" && item.metric === "matches",
  );
  assert.deepEqual(arenaMatches.map((item) => item.target), [1]);

  const genericWins = ACHIEVEMENT_DEFINITIONS.filter(
    (item) => item.category === "Arena" && item.metric === "wins",
  );
  assert.deepEqual(genericWins.map((item) => item.target), [3, 5, 10, 25, 50]);

  for (const removedTarget of [5, 10, 25, 50, 100]) {
    assert.equal(
      ACHIEVEMENT_DEFINITIONS.some((item) => item.metric === "matches" && item.target === removedTarget),
      false,
    );
  }
});

test("Arsenal contains Standard, Singleton, Competitive, Character, and BakuCore breadth", () => {
  const arsenal = ACHIEVEMENT_DEFINITIONS.filter((item) => item.category === "Arsenal");
  assert.deepEqual(
    arsenal.filter((item) => item.metric === "standardDecks").map((item) => item.target),
    [1, 3],
  );
  assert.equal(arsenal.find((item) => item.metric === "singletonDecks")?.target, 1);
  assert.equal(arsenal.find((item) => item.metric === "competitiveDecks")?.target, 1);
  assert.equal(arsenal.find((item) => item.metric === "characterCards")?.target, 9);
  assert.equal(arsenal.find((item) => item.metric === "coreTypes")?.target, 5);
});

test("Brawler Network publishing progression is 1, 3, 6, and 9 distinct legal Standard decks", () => {
  assert.deepEqual(
    ACHIEVEMENT_DEFINITIONS
      .filter((item) => item.metric === "publishedDecks")
      .map((item) => item.target),
    [1, 3, 6, 9],
  );
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
  assert.equal(
    achievementsFor([sizeOnlyDeck], []).find((item) => item.id === "first-deck")?.unlocked,
    false,
  );

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
    {
      id: "discovery-match",
      result: "Defeat",
      mode: "training",
      format: "bo1",
    },
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
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].target, 1);
  for (const item of ranked) {
    assert.equal(item.category, "Arena");
    assert.equal(achievementTrainingConfigurable(item), false);
    assert.equal(achievementTrainingRule(item), "ranked");
  }
});

test("faction mastery requires all six winning factions, five mono-faction ten-win milestones, and the capstone", () => {
  const progress = normalizeAchievementProgress({
    winningFactions: {
      nonTraining: [...ACHIEVEMENT_FACTIONS],
      training: [],
    },
    monoFactionWinIds: Object.fromEntries(
      MONO_MASTERY_FACTIONS.map((faction) => [
        faction,
        {
          nonTraining: Array.from({ length: 10 }, (_, index) => `${faction}-${index}`),
          training: [],
        },
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

test("Aurelus participates in the six-faction exploration achievement but has no mono-faction mastery", () => {
  assert.deepEqual(ACHIEVEMENT_FACTIONS, ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);
  assert.deepEqual(MONO_MASTERY_FACTIONS, ["Pyrus", "Aquos", "Ventus", "Haos", "Darkus"]);
  assert.equal(
    ACHIEVEMENT_DEFINITIONS.some((item) => /Aurelus Mastery/i.test(item.name)),
    false,
  );
});

test("Master of the Elements is the Elemental Mastery capstone reward", () => {
  const customization = source("lib/profile-customization.ts");
  assert.match(customization, /master-of-the-elements/);
  assert.match(customization, /Master of the Elements/);
  assert.match(customization, /"complete-ten"/);
});

test("stored completion evidence keeps an earned achievement unlocked", () => {
  const live = achievementsFor([], []);
  const sticky = applyAchievementCompletions(live, {
    "first-deck": "2026-07-04T10:00:00.000Z",
  });
  const achievement = sticky.find((item) => item.id === "first-deck");
  assert.equal(achievement?.unlocked, true);
  assert.equal(achievement?.status, "completed");
  assert.equal(achievement?.current, achievement?.target);
  assert.equal(achievement?.completedAt, "2026-07-04T10:00:00.000Z");
});

test("status views use their required deterministic sort orders", () => {
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

test("achievement identity and Training rules are visible across player and Administrator surfaces", () => {
  const achievementsScreen = source("components/routes/AchievementsScreen.tsx");
  const profile = source("components/profile/BrawlerProfileView.tsx");
  const admin = source("components/routes/AchievementRewardManagement.tsx");

  for (const contract of [
    "ACHIEVEMENT_CATEGORY_DETAILS",
    "Training progress allowed",
    "Training progress not allowed",
    "Ranked matches only",
  ]) {
    assert.match(achievementsScreen, new RegExp(contract));
  }
  assert.match(profile, /ACHIEVEMENT_CATEGORY_DETAILS/);
  assert.match(profile, /category\.glyph/);
  assert.match(profile, /category\.color/);
  assert.match(admin, /achievementTrainingConfigurable/);
  assert.match(admin, /Training progress/);
  assert.match(admin, /categoryDetails\.glyph/);
  assert.match(admin, /categoryDetails\.color/);
});

test("achievement route provides overview previews, search, categories, and view-all screens", () => {
  const implementation = source("components/routes/AchievementsScreen.tsx");
  const profile = source("components/routes/ProfileScreen.tsx");
  const styles = source("components/routes/AchievementsScreen.module.css");

  for (const contract of [
    "Search achievements",
    "All categories",
    "Completed",
    "In Progress",
    "Locked",
    "View All",
    "slice(0, 3)",
    "/profile/achievements/",
    "ACHIEVEMENT_CATEGORY_DETAILS",
  ]) {
    assert.match(implementation, new RegExp(contract.replace(/[()]/g, "\\$&")));
  }
  assert.match(implementation, /useSearchParams/);
  assert.match(implementation, /sortAchievements\(visible, activeStatus\)/);
  assert.match(profile, /applyAchievementCompletions/);
  assert.match(profile, /view=\{segments\[1\]\}/);
  assert.match(styles, /grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /@media \(max-width: 860px\)/);
});
