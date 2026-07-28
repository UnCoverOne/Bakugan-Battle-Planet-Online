import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Deck Library includes the complete responsive library composition", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  for (const contract of [
    "DeckAreaHeader",
    "DeckToolbar",
    "CharacterFan",
    "Selected for Play",
    "DeckLibrarySkeleton",
    "Working offline",
    "Deck storage needs attention",
    "No decks match these filters",
    "Build your first battle deck",
    'type LibraryView = "grid" | "list"',
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.toolbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.deckGrid_list/);
  assert.match(css, /\.deckCardSelected/);
});

test("Deck Builder uses a two-sided desktop workbench and two mobile tabs", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  for (const contract of [
    "Card Gallery",
    "Current Deck",
    "Bakugan Character Cards",
    "BakuCores",
    "Main Deck",
    'type BuilderView = "gallery" | "deck"',
    "Draft saved locally",
    "Save Deck",
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.builderLayout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.builderMobileTabs\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderMobileTabs\s*\{[^}]*display:\s*grid/s);
});

test("Deck Builder cards expose quantities, shared full-screen inspection, and section issue dialogs", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  for (const contract of [
    "BuilderGalleryCard",
    "copies in deck",
    "BuilderRequirementHeader",
    "BuilderIssues",
    "CardInspector",
    'mode="embedded"',
    "builderInspectorOverlay",
    "requirements satisfied",
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.builderInspectorOverlay\s*>\s*\[data-ui="card-inspector"\]\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
  assert.match(css, /\.builderInfoValid\s*\{[^}]*border:\s*2px solid white/s);
  assert.match(css, /\.builderInfoInvalid\s*\{[^}]*#ff5057/s);
});

test("team selection drives a removable faction filter and ordered BakuCore previews", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.match(route, /if \(adding \|\| factionFilterAuto\) setFactionFilters\(nextFactions\)/);
  assert.match(route, /setFactionFilterAuto\(false\)/);
  assert.match(route, /Team faction/);
  assert.match(route, /selectedCoreSlots/);
  assert.match(css, /opacity:\s*\.18/);
  assert.match(route, /FACTION_SYMBOLS/);
});

test("Card Gallery and Main Deck each provide search, sort, filter, and responsive dialogs", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.ok((route.match(/<BuilderToolbar/g) ?? []).length >= 2);
  assert.match(route, /surface: "gallery", panel: "sort"/);
  assert.match(route, /surface: "gallery", panel: "filter"/);
  assert.match(route, /surface: "deck", panel: "sort"/);
  assert.match(route, /surface: "deck", panel: "filter"/);
  assert.match(css, /\.builderMenuDialog\s*\{[^}]*width:\s*min\(100%,\s*34rem\)/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderMenuDialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
});

test("public copying and read-only details reuse validation and preserve attribution", async () => {
  const [route, persistence] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("lib/persistence.ts"),
  ]);
  assert.match(route, /DeckDetailPresentation/);
  assert.match(route, /sourceDeckId:\s*deck\.id/);
  assert.match(route, /sourceCreator:/);
  assert.match(route, /validateDeck\(deck\)/);
  assert.match(route, /Copy to My Decks/);
  assert.match(persistence, /sourceDeckId:/);
  assert.match(persistence, /sourceCreator:/);
});

test("all legality boundaries delegate to the centralized engine", async () => {
  const [data, play, server, decks] = await Promise.all([
    read("lib/data.ts"),
    read("components/routes/PlayRoutes.tsx"),
    read("app/api/user-data/route.ts"),
    read("components/routes/DeckRoutes.tsx"),
  ]);
  assert.match(data, /validateDeckConstruction/);
  assert.match(play, /validateDeck\(chosenDeck\)/);
  assert.match(play, /playSetupStartBlockers/);
  assert.match(server, /validateDeck\(deck as unknown as DeckRecord\)/);
  assert.match(server, /firstIssue\.code/);
  assert.match(decks, /const report = useMemo\(\(\) => validateDeck\(deck\)/);
});
