import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Achievement } from "../lib/achievements";
import type { DeckRecord } from "../lib/data";
import {
  closestUnfinishedAchievements,
  latestLegalStandardCommunityDeck,
} from "../lib/home-dashboard";

const source = (path: string) => readFileSync(path, "utf8");

function achievement(name: string, current: number, target: number, unlocked = false): Achievement {
  return {
    id: name,
    name,
    description: "",
    category: "Arena",
    current,
    target,
    unlocked,
    status: unlocked ? "completed" : "in-progress",
    completedAt: null,
    trainingRule: null,
  };
}

test("achievement selector shows only three unfinished goals nearest completion", () => {
  const entries = [
    achievement("Completed", 10, 10, true),
    achievement("Far", 1, 10),
    achievement("Closest", 9, 10),
    achievement("Second", 4, 5),
    achievement("Third", 3, 4),
    achievement("Unstarted", 0, 1),
  ];
  assert.deepEqual(
    closestUnfinishedAchievements(entries).map((entry) => entry.name),
    ["Closest", "Second", "Third"],
  );
  assert.equal(entries.length, 6, "selector does not mutate the source");
  assert.deepEqual(closestUnfinishedAchievements([achievement("Done", 1, 1, true)]), []);
});

const deck = (
  id: string,
  publishedAt: string,
  updatedAt = publishedAt,
  options: Partial<DeckRecord> = {},
): DeckRecord => ({
  id,
  name: `Deck ${id}`,
  factions: [],
  bakuganIds: [],
  coreIds: [],
  cardIds: [],
  visibility: "Public",
  format: "standard",
  publishedAt,
  updatedAt,
  creator: "Community Brawler",
  ...options,
});

test("featured selector chooses newest currently legal user-published Standard deck", () => {
  const entries = [
    { source: { kind: "user" }, deck: deck("old-legal", "2026-09-01T12:00:00Z", "2026-12-01T12:00:00Z") },
    { source: { kind: "user" }, deck: deck("recent-invalid", "2026-10-10T12:00:00Z") },
    { source: { kind: "user" }, deck: deck("newest-legal", "2026-10-08T12:00:00Z") },
    { source: { kind: "user" }, deck: deck("competitive", "2026-11-01T12:00:00Z", undefined, { format: "competitive" }) },
    { source: { kind: "user" }, deck: deck("private", "2026-12-01T12:00:00Z", undefined, { visibility: "Private" }) },
    { source: { kind: "resource" }, deck: deck("admin", "2026-12-02T12:00:00Z") },
  ];
  const selected = latestLegalStandardCommunityDeck(entries, (candidate) => candidate.id !== "recent-invalid");
  assert.equal(selected?.id, "newest-legal");
  assert.deepEqual(Object.keys(selected ?? {}).sort(), ["creator", "description", "id", "name", "publishedAt"].sort());
  assert.equal(latestLegalStandardCommunityDeck(entries, () => false), null);
});

test("homepage contains only the four agreed functional sections and uses compact data", () => {
  const page = source("app/page.tsx");
  const dashboard = source("components/home/HomeDashboard.tsx");
  const achievements = source("components/home/HomeAchievements.tsx");
  const endpoint = source("app/api/home/featured-deck/route.ts");

  assert.match(page, /<HomeDashboard \/>/);
  for (const heading of ["Play", "Featured Community Deck", "Player Statistics"]) {
    assert.ok(dashboard.includes(`>${heading}<`));
  }
  assert.match(dashboard, /import\("\.\/HomeAchievements"\)/);
  assert.match(achievements, /achievementsForProfile/);
  assert.match(achievements, /closestUnfinishedAchievements/);
  assert.match(dashboard, /resumeCurrentMatch\(\)/);
  assert.match(dashboard, /resumeAccountMatch\(recoverableSession\)/);
  assert.match(dashboard, /href="\/play"/);
  assert.match(dashboard, /href="\/decks"/);
  assert.doesNotMatch(dashboard, /My Decks|Recent Activity|PUBLIC_DECKS|CARD_BY_ID|cardArtSource/);
  assert.match(dashboard, /fetch\("\/api\/home\/featured-deck"/);
  assert.match(endpoint, /latestLegalStandardCommunityDeck/);
  assert.match(endpoint, /validateDeck\(candidate\)\.isLegal/);
  assert.doesNotMatch(endpoint, /\.\.\.deck|cardIds:|bakuganIds:/);
});
