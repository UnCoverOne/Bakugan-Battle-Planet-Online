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

test("Home uses a vibrant, uncropped hero and fills a standard desktop viewport", () => {
  const dashboard = source("components/routes/DashboardScreen.tsx");
  const layout = source("app/layout.tsx");
  const css = source("app/home-layout.css");
  assert.match(dashboard, /bakugan-home-hero/);
  assert.match(dashboard, /home-feature-grid/);
  assert.match(dashboard, /home-achievement-summary/);
  assert.match(dashboard, /home-featured-deck/);
  assert.match(dashboard, /home-profile-strip/);
  assert.match(dashboard, /AchievementGlyph/);
  assert.match(dashboard, /\.filter\(\(achievement\) => achievement\.unlocked\)\.reverse\(\)/);
  assert.match(dashboard, /cardArtSource\(featuredLead, "full"\)/);
  assert.doesNotMatch(dashboard, /of \{achievements\.length\} unlocked/);
  assert.doesNotMatch(dashboard, /<span className="eyebrow">ACHIEVEMENTS/);
  assert.doesNotMatch(dashboard, /<span className="eyebrow">NEWEST PUBLIC DECK/);
  assert.doesNotMatch(dashboard, /PageHeader/);
  assert.match(layout, /home-layout\.css/);
  assert.match(css, /--home-cut-lg:18px;--home-cut-sm:8px/);
  assert.match(css, /\.bakugan-home\{[^}]*background:url\('\/assets\/burst\.jpg'\)/);
  assert.match(css, /\.bakugan-home-hero\{[^}]*width:100%[^}]*clip-path:none/);
  assert.match(css, /\.bakugan-home-hero-art img\{[^}]*left:-8%[^}]*width:108%/);
  assert.match(css, /\.bakugan-home-hero-copy \.hex-button\.red\{[^}]*min-width:170px[^}]*min-height:52px/);
  assert.match(css, /width:min\(1520px,calc\(100% - 2\.5rem\)\)/);
  assert.match(css, /height:calc\(100dvh - 88px\)/);
  assert.match(css, /grid-template-rows:minmax\(320px,1\.08fr\) minmax\(310px,\.92fr\) 76px/);
  assert.doesNotMatch(css, /main-stage:has\(\.bakugan-home\)\{[^}]*overflow:hidden/);
});

test("the overhaul leaves the immersive Match implementation outside its source changes", () => {
  const css = source("app/website-overhaul.css");
  assert.match(css, /immersive Match screen is intentionally untouched/);
  assert.doesNotMatch(css, /\.gameplay-match-host\s*\{/);
  assert.doesNotMatch(css, /\.game-screen/);
});
