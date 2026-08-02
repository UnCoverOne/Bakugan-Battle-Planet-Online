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
  assert.match(shell, /PROFILE_TITLES/);
  assert.match(shell, /FACTION_ICONS\[profile\.faction\]/);
  assert.match(shell, /profile-popover-title/);
  assert.match(shell, /profile-popover-stat-value/);
  assert.match(shell, /profile-popover-row-icon/);
  assert.match(shell, /profile-popover-chevron/);
  assert.match(shell, /profile-popover-logout/);
  assert.match(shell, /View Profile/);
  assert.match(shell, /Achievements/);
  assert.match(shell, /Settings/);
  assert.match(shell, /Log out/);
  assert.match(shell, /function SyncGlyph/);
  assert.match(shell, /className="sync-icon"/);
  assert.match(shell, /aria-label="Open profile menu"/);
  assert.match(shell, /aria-controls="profile-menu"/);
  assert.match(shell, /id="profile-menu"/);

  const mobileNavigation = shell.slice(
    shell.indexOf('<nav className="mobile-bottom-nav"'),
    shell.indexOf("{toast &&"),
  );
  assert.match(mobileNavigation, /NAV\.map/);
  assert.doesNotMatch(mobileNavigation, /href="\/profile"/);
  assert.doesNotMatch(mobileNavigation, />Profile<\/span>/);
  const shellCss = source("app/website-overhaul.css");
  assert.match(
    shellCss,
    /\.mobile-bottom-nav\{[^}]*grid-template-columns:repeat\(4,1fr\)/,
  );
  assert.match(
    shellCss,
    /@media \(max-width:820px\)\{[\s\S]*?\.profile-popover\{position:absolute;left:auto;right:0;top:calc\(100% \+ 8px\);bottom:auto;/,
  );
  assert.match(shellCss, /\.profile-popover\{[^}]*width:clamp\(320px,24vw,360px\)/);
  assert.match(shellCss, /\.profile-popover-heading\{[^}]*min-height:88px/);
  assert.match(shellCss, /\.profile-popover-avatar\{[^}]*flex:0 0 14%/);
  assert.match(shellCss, /\.profile-popover-stats\{[^}]*grid-template-columns:1fr 1fr/);
  assert.match(shellCss, /\.profile-popover-row\{[^}]*min-height:44px/);
  assert.match(shellCss, /\.profile-popover-logout\{[^}]*min-height:54px/);
  assert.doesNotMatch(
    shellCss,
    /@media \(max-width:820px\)\{[\s\S]*?\.profile-popover\{position:fixed;/,
  );
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
  assert.match(dashboard, /data:image\/avif;base64/);
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

test("secondary routes use shared primitives and route-owned CSS Modules", () => {
  const primitives = source("components/design-system/primitives.tsx");
  const layout = source("app/layout.tsx");
  for (const primitive of ["Surface", "RouteHero", "ActionButton", "StatusChip", "Tabs", "Field", "CardGrid"]) {
    assert.match(primitives, new RegExp(`export function ${primitive}`));
  }
  for (const route of ["DeckRoutes", "PlayRoutes", "CompendiumScreen"]) {
    assert.equal(existsSync(`components/routes/${route}.module.css`), true);
    assert.match(source(`components/routes/${route}.tsx`), new RegExp(`import styles from ["']\\.\\/${route}\\.module\\.css["']`));
  }
  assert.doesNotMatch(layout, /design-system\.css/);
  assert.match(source("app/globals.css"), /--content-wide:/);
  assert.match(source("app/globals.css"), /--type-meta:\.75rem/);
  assert.match(source("app/globals.css"), /--chamfer-panel:/);
});

test("large secondary-route card scans use full assets", () => {
  const play = source("components/routes/PlayRoutes.tsx");
  const compendium = source("components/routes/CompendiumScreen.tsx");
  const responsiveCardImage = source("components/cards/ResponsiveCardImage.tsx");
  const decks = source("components/routes/DeckRoutes.tsx");
  assert.doesNotMatch(play, /cardArtSource\([^)]*,\s*"thumbnail"\)/);
  assert.match(compendium, /ResponsiveCardImage/);
  assert.match(responsiveCardImage, /const full = cardArtSource\(card,\s*"full"\)/);
  assert.match(responsiveCardImage, /const thumbnail = cardArtSource\(card,\s*"thumbnail"\)/);
  assert.match(responsiveCardImage, /\$\{thumbnail\} 160w, \$\{full\} 360w/);
  assert.match(responsiveCardImage, /srcSet=\{srcSet\}/);
  assert.match(decks, /function CharacterFan[\s\S]*cardArtSource\(character\.character,\s*"full"\)/);
  assert.match(decks, /detailTeam[\s\S]*cardArtSource\(item!\.character,\s*"full"\)/);
});

test("shared primitives expose stable visual-regression selectors", () => {
  const primitives = source("components/design-system/primitives.tsx");
  for (const selector of [
    "surface",
    "route-hero",
    "action-button",
    "status-chip",
    "tabs",
    "field",
    "card-grid",
  ]) {
    assert.match(primitives, new RegExp(`data-ui="${selector}"`));
  }
});

test("legacy global rules no longer neutralize migrated route primitives", () => {
  const consistency = source("app/site-consistency.css");
  const legacy = source("app/website-overhaul.css");
  assert.doesNotMatch(consistency, /\.main-stage \.panel/);
  for (const selector of [
    "play-setup-main",
    "play-confirmation",
    "overhaul-toolbar",
    "import-drawer",
    "rules-contents",
    "rule-article",
    "ruling-submission-modal",
    "compendium-filters",
  ]) {
    assert.doesNotMatch(consistency, new RegExp(`\\.${selector}[,\\n)]`));
  }
  assert.doesNotMatch(
    legacy,
    /\.compendium-filters\{[^}]*?(?:clip-path:none|border-radius:[1-9])/,
  );
  for (const selector of [
    String.raw`\.play-setup-main,\.play-confirmation`,
    String.raw`\.overhaul-toolbar`,
    String.raw`\.import-drawer`,
    String.raw`\.overhaul-deck-card`,
    String.raw`\.deck-card-main`,
    String.raw`\.public-deck-card`,
    String.raw`\.public-deck-lead`,
    String.raw`\.deck-detail-lead`,
    String.raw`\.deck-detail-v2 \.panel`,
    String.raw`\.deck-team-strip>div`,
    String.raw`\.overhaul-builder \.deck-validation-summary\.compact`,
    String.raw`\.reference-card\.compact`,
  ]) {
    assert.doesNotMatch(
      legacy,
      new RegExp(`${selector}\\{[^}]*(?:clip-path:none|border-radius:[1-9])`),
    );
  }
});

test("deck names, metadata, and visual coverage retain their stabilization contracts", () => {
  const decks = source("components/routes/DeckRoutes.module.css");
  const visualConfig = source("playwright.visual.config.ts");
  const visualSuite = source("tests/visual/foundation.spec.ts");
  assert.match(decks, /-webkit-line-clamp:\s*2/);
  assert.match(decks, /overflow-wrap:\s*anywhere/);
  assert.match(source("app/globals.css"), /--type-meta:\.75rem/);
  for (const width of [390, 768, 1440, 1920]) {
    assert.match(visualConfig, new RegExp(`width: ${width}`));
  }
  for (const route of [
    "/decks",
    "/decks/public",
    "/builder/deck-pyrus",
    "/play",
    "/compendium",
    "/compendium/rules",
    "/profile",
    "/profile/records",
    "/settings",
  ]) {
    assert.match(visualSuite, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(visualSuite, /metadata must remain at least 12px/);
  assert.match(visualSuite, /full scans must not be enlarged beyond source width/);
  assert.match(visualSuite, /visible route panels must retain the shared chamfer/);
  assert.match(visualSuite, /the focused control must expose a visible indicator/);
});
