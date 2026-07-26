import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PUBLIC_DECKS, STARTER_DECKS, deckLeadCard } from "../lib/data";
import { achievementsFor } from "../lib/achievements";

const source = (path: string) => readFileSync(path, "utf8");

test("the primary shell uses the approved four-item top navigation and profile menu", () => {
  const shell = source("components/application/AppShell.jsx");
  for (const label of ["Home", "Play", "Decks", "Compendium"]) assert.match(shell, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(shell, /label: "History"/);
  assert.match(shell, /mobile-bottom-nav/);
  assert.match(shell, /profile-popover-stats/);
  assert.match(shell, /View Profile/);
  assert.match(shell, /Achievements/);
  assert.match(shell, /Settings/);
  assert.match(shell, /Log Out/);
});

test("history is routed through profile and public deck browsing has dedicated routes", () => {
  assert.equal(existsSync("app/(workspace)/profile/[[...segments]]/page.tsx"), true);
  assert.equal(existsSync("app/(workspace)/decks/public/page.tsx"), true);
  assert.equal(existsSync("app/(workspace)/decks/public/[id]/page.tsx"), true);
  assert.match(source("app/(workspace)/history/[[...segments]]/page.tsx"), /profile\/records/);
});

test("every starter and curated public deck resolves a lead card contained in the deck", () => {
  for (const deck of [...STARTER_DECKS, ...PUBLIC_DECKS]) {
    const lead = deckLeadCard(deck);
    assert.ok(lead, `${deck.name} should resolve a Lead card`);
    assert.ok(deck.cardIds.includes(lead!.catalogId), `${deck.name}'s Lead card should be in its Main Deck`);
  }
});

test("achievement totals derive from saved decks and match records", () => {
  const achievements = achievementsFor(STARTER_DECKS, [
    { result: "Victor", mode: "training" },
    { result: "Defeat", mode: "online" },
  ]);
  assert.ok(achievements.some((achievement) => achievement.id === "first-win" && achievement.unlocked));
  assert.ok(achievements.some((achievement) => achievement.id === "online" && achievement.unlocked));
});

test("Home uses a full-width angular banner and a compact single-screen desktop layout", () => {
  const dashboard = source("components/routes/DashboardScreen.tsx");
  const layout = source("app/layout.tsx");
  const css = source("app/home-layout.css");
  assert.match(dashboard, /bakugan-home-hero/);
  assert.match(dashboard, /home-feature-grid/);
  assert.match(dashboard, /home-achievement-summary/);
  assert.match(dashboard, /home-featured-deck/);
  assert.match(dashboard, /home-profile-strip/);
  assert.match(dashboard, /home-achievement-icon/);
  assert.match(dashboard, /slice\(0, 3\)/);
  assert.doesNotMatch(dashboard, /of \{achievements\.length\} unlocked/);
  assert.doesNotMatch(dashboard, /<span className="eyebrow">ACHIEVEMENTS/);
  assert.doesNotMatch(dashboard, /<span className="eyebrow">NEWEST PUBLIC DECK/);
  assert.doesNotMatch(dashboard, /PageHeader/);
  assert.match(layout, /home-layout\.css/);
  assert.match(css, /\.bakugan-home-hero\{[^}]*width:100%/);
  assert.match(css, /clip-path:polygon/);
  assert.match(css, /height:calc\(100dvh - 76px\)/);
  assert.match(css, /grid-template-columns:minmax\(300px,\.82fr\) minmax\(0,1\.18fr\)/);
});

test("the overhaul leaves the immersive Match implementation outside its source changes", () => {
  const css = source("app/website-overhaul.css");
  assert.match(css, /immersive Match screen is intentionally untouched/);
  assert.doesNotMatch(css, /\.gameplay-match-host\s*\{/);
  assert.doesNotMatch(css, /\.game-screen/);
});
