import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_DETAILS,
  ACHIEVEMENT_DEFINITIONS,
  achievementsFor,
  applyAchievementCompletions,
  sortAchievements,
  type Achievement,
} from "../lib/achievements";
import { STARTER_DECKS, deckIsLegal, type DeckRecord } from "../lib/data";
import type { MatchResultRecord } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");

const match = (
  id: string,
  at: string,
  overrides: Partial<MatchResultRecord> = {},
): MatchResultRecord => ({
  id,
  result: "Defeat",
  opponent: `Opponent ${id}`,
  score: "0–1",
  reason: "Match completed",
  at,
  format: "bo1",
  mode: "casual",
  log: [],
  ...overrides,
});

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

test("achievement catalogue exposes four progression paths and 45 stable milestones", () => {
  assert.deepEqual(ACHIEVEMENT_CATEGORIES, [
    "Arsenal",
    "Arena",
    "Brawler Network",
    "Compendium",
  ]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 45);
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id)).size, 45);
  assert.deepEqual(
    new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.category)),
    new Set(ACHIEVEMENT_CATEGORIES),
  );
  assert.deepEqual(
    Object.keys(ACHIEVEMENT_CATEGORY_DETAILS),
    ACHIEVEMENT_CATEGORIES,
  );
  for (const item of ACHIEVEMENT_DEFINITIONS) {
    assert.ok(item.target > 0);
    assert.ok(item.name.trim());
    assert.ok(item.description.trim());
    assert.ok(ACHIEVEMENT_CATEGORY_DETAILS[item.category].glyph);
    assert.match(ACHIEVEMENT_CATEGORY_DETAILS[item.category].color, /^#[0-9a-f]{6}$/i);
  }
});

test("deck achievements use authoritative legality rather than size alone", () => {
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
  const achievements = achievementsFor(STARTER_DECKS.slice(0, 3), []);
  assert.equal(achievements.find((item) => item.id === "first-deck")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "deck-builder")?.unlocked, true);
});

test("duplicate deck copies do not inflate legal deck milestones", () => {
  const original = legalDeck(
    STARTER_DECKS[0],
    "original",
    "2026-07-01T10:00:00.000Z",
  );
  const copied = legalDeck(
    STARTER_DECKS[0],
    "copy",
    "2026-07-02T10:00:00.000Z",
  );
  const achievements = achievementsFor([original, copied], []);

  assert.equal(achievements.find((item) => item.id === "first-deck")?.current, 1);
  assert.equal(achievements.find((item) => item.id === "deck-builder")?.current, 1);
});

test("publishing progression counts distinct legal public decks at 1, 3, 6, and 9", () => {
  const publicDecks = STARTER_DECKS.slice(0, 3).map((item, index) =>
    legalDeck(item, `public-${index}`, `2026-07-0${index + 1}T10:00:00.000Z`, {
      visibility: "Public",
      publishedAt: `2026-07-0${index + 1}T10:00:00.000Z`,
    }),
  );
  const achievements = achievementsFor(publicDecks, []);

  assert.equal(achievements.find((item) => item.id === "publisher")?.current, 1);
  assert.equal(achievements.find((item) => item.id === "publisher")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "decks-five")?.current, 3);
  assert.equal(achievements.find((item) => item.id === "decks-five")?.unlocked, true);
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "public-five")?.target, 6);
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "decks-ten")?.target, 9);
});

test("format expertise is based on victories rather than participation", () => {
  const defeatOnly = achievementsFor([], [
    match("bo3-loss", "2026-07-01T10:00:00.000Z", { format: "bo3", result: "Defeat" }),
  ]);
  assert.equal(defeatOnly.find((item) => item.id === "first-series")?.current, 0);

  const history = [
    match("bo3-win", "2026-07-01T10:00:00.000Z", { format: "bo3", result: "Victor" }),
    ...Array.from({ length: 10 }, (_, index) =>
      match(`bo1-win-${index}`, `2026-07-${String(index + 2).padStart(2, "0")}T10:00:00.000Z`, {
        format: "bo1",
        result: "Victor",
      }),
    ),
  ];
  const achievements = achievementsFor([], history);
  assert.equal(achievements.find((item) => item.id === "first-series")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "bo1-ten")?.unlocked, true);
});

test("practice results remain eligible only for practice-specific achievements", () => {
  const achievements = achievementsFor([], [
    { result: "Victor", mode: "training" },
    { result: "Defeat", mode: "online" },
  ]);

  assert.equal(achievements.find((item) => item.id === "first-win")?.unlocked, false);
  assert.equal(achievements.find((item) => item.id === "training-day")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "online")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "opponents-five")?.current, 0);
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
