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
  assert.match(shell, /function SyncGlyph/);
  assert.match(shell, /className="sync-icon"/);
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

test("Home uses the upgraded Pyrus hero, card fan, and intended desktop proportions", () => {
  const dashboard = source("components/routes/DashboardScreen.tsx");
  const layout = source("app/layout.tsx");
  const css = source("app/home-layout.css");
  const fidelity = source("app/home-fidelity.css");
  assert.match(dashboard, /bakugan-home-hero/);
  assert.match(dashboard, /home-feature-grid/);
  assert.match(dashboard, /home-achievement-summary/);
  assert.match(dashboard, /Achievement progress/);
  assert.match(dashboard, /home-featured-deck-stack/);
  assert.match(dashboard, /home-featured-deck-card/);
  assert.match(dashboard, /featured\.bakuganIds\.map/);
  assert.match(dashboard, /CARD_BY_ID/);
  assert.match(dashboard, /hero-pyrus\.svg/);
  assert.match(dashboard, /ChevronArrow/);
  assert.match(dashboard, /HeroSpeedLines/);
  assert.match(dashboard, /useHighResolutionHero/);
  assert.match(dashboard, /data:image\/webp;base64/);
  assert.match(dashboard, /home-profile-strip/);
  assert.match(dashboard, /AchievementGlyph/);
  assert.match(dashboard, /\.filter\(\(achievement\) => achievement\.unlocked\)\.reverse\(\)/);
  assert.doesNotMatch(dashboard, /home-featured-deck-art/);
  assert.doesNotMatch(dashboard, /of \{achievements\.length\} unlocked/);
  assert.doesNotMatch(dashboard, /PageHeader/);
  assert.match(layout, /home-layout\.css/);
  assert.match(layout, /home-fidelity\.css/);
  assert.match(css, /--home-max: 1470px/);
  assert.match(css, /height: calc\(100dvh - 76px\)/);
  assert.match(css, /grid-template-rows: minmax\(360px, 1\.08fr\) minmax\(330px, \.92fr\) 84px/);
  assert.match(css, /grid-template-columns: minmax\(390px, \.59fr\) minmax\(720px, 1fr\)/);
  assert.match(css, /\.home-featured-deck-card:nth-child\(4\)/);
  assert.match(css, /\.bakugan-home-hero-art img[\s\S]*height: 174%/);
  assert.match(fidelity, /Titillium Web/);
  assert.match(fidelity, /Lato/);
  assert.match(fidelity, /rotate\(-17deg\)/);
  assert.match(fidelity, /clip-path: polygon\(0 50%, 100% 0, 100% 100%\)/);
  assert.match(fidelity, /font-size: clamp\(5rem/);
  assert.match(fidelity, /\.button-arrow/);
  for (let part = 1; part <= 8; part += 1) {
    assert.equal(
      existsSync(`public/assets/home/hero-pyrus/part-${String(part).padStart(2, "0")}.txt`),
      true,
    );
  }
  assert.doesNotMatch(css, /height: calc\(100dvh - 88px\)/);
  assert.doesNotMatch(css, /main-stage:has\(\.bakugan-home\)[^{]*\{[^}]*overflow: hidden/);
});

test("the overhaul leaves the immersive Match implementation outside its source changes", () => {
  const css = source("app/website-overhaul.css");
  assert.match(css, /immersive Match screen is intentionally untouched/);
  assert.doesNotMatch(css, /\.gameplay-match-host\s*\{/);
  assert.doesNotMatch(css, /\.game-screen/);
});
