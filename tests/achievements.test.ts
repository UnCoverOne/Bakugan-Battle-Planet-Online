import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_DEFINITIONS,
  achievementsFor,
  sortAchievements,
  type Achievement,
} from "../lib/achievements";
import type { DeckRecord } from "../lib/data";
import type { MatchResultRecord } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");

const deck = (
  id: string,
  updatedAt: string,
  overrides: Partial<DeckRecord> = {},
): DeckRecord => ({
  id,
  name: id,
  factions: ["Pyrus"],
  bakuganIds: ["character-a", "character-b", "character-c"],
  coreIds: ["core-a", "core-b", "core-c", "core-d", "core-e", "core-f"],
  cardIds: Array.from({ length: 40 }, (_, index) => `card-${id}-${index}`),
  updatedAt,
  visibility: "Private",
  format: "standard",
  ...overrides,
});

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
  mode: "training",
  log: [],
  ...overrides,
});

test("achievement catalogue preserves seven originals and adds fifty real milestones", () => {
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 57);
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id)).size, 57);
  assert.deepEqual(
    new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.category)),
    new Set(ACHIEVEMENT_CATEGORIES),
  );
  for (const item of ACHIEVEMENT_DEFINITIONS) {
    assert.ok(item.target > 0);
    assert.ok(item.name.trim());
    assert.ok(item.description.trim());
  }
});

test("achievement progress uses persisted deck and match evidence", () => {
  const decks = [
    deck("alpha", "2026-07-01T10:00:00.000Z", {
      visibility: "Public",
      publishedAt: "2026-07-01T10:00:00.000Z",
    }),
    deck("beta", "2026-07-02T10:00:00.000Z"),
    deck("gamma", "2026-07-03T10:00:00.000Z"),
  ];
  const history = [
    match("one", "2026-07-04T10:00:00.000Z", {
      result: "Victor",
      mode: "online",
      opponent: "Alice",
    }),
    match("two", "2026-07-05T10:00:00.000Z", {
      result: "Victor",
      mode: "online",
      opponent: "Bob",
    }),
  ];
  const achievements = achievementsFor(decks, history);

  assert.equal(achievements.find((item) => item.id === "deck-builder")?.status, "completed");
  assert.equal(achievements.find((item) => item.id === "games-five")?.status, "in-progress");
  assert.equal(achievements.find((item) => item.id === "online")?.completedAt, "2026-07-04T10:00:00.000Z");
  assert.equal(achievements.find((item) => item.id === "online-wins-five")?.current, 2);
  assert.equal(achievements.find((item) => item.id === "opponents-five")?.current, 2);
});

test("status views use their required deterministic sort orders", () => {
  const base = {
    description: "",
    category: "Battle" as const,
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
  ]) {
    assert.match(implementation, new RegExp(contract.replace(/[()]/g, "\\$&")));
  }
  assert.match(implementation, /useSearchParams/);
  assert.match(implementation, /sortAchievements\(visible, activeStatus\)/);
  assert.match(profile, /view=\{segments\[1\]\}/);
  assert.match(styles, /grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /@media \(max-width: 860px\)/);
});
