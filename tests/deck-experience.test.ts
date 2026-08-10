import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

test("Deck Builder uses independently scrolling desktop columns and two mobile tabs", async () => {
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
  assert.match(css, /\.builder\s*\{[^}]*height:\s*calc\(100dvh - 76px\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.builderLayout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.builderGallery,\s*\.builderCurrentDeck\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.builderMobileTabs\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builder\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderMobileTabs\s*\{[^}]*display:\s*grid/s);
});

test("Deck Builder cards expose quantities, responsive shared inspection, and section issue dialogs", async () => {
  const [route, css, inspectorCss] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
    read("components/cards/CardInspector.module.css"),
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
  assert.match(css, /\.builderInspectorOverlay\s*>\s*\[data-ui="card-inspector"\]\s*\{[^}]*width:\s*min\(72rem[^}]*height:\s*min\(82dvh/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderInspectorOverlay\s*>\s*\[data-ui="card-inspector"\]\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
  assert.match(inspectorCss, /\.embedded \.overview\s*\{[^}]*grid-template-columns:\s*minmax\(16rem[^}]*minmax\(0,\s*1\.14fr\)/s);
  assert.match(css, /\.builderInfoValid\s*\{[^}]*border:\s*2px solid white/s);
  assert.match(css, /\.builderInfoInvalid\s*\{[^}]*#ff5057/s);
});

test("team selection drives a removable faction filter and ordered BakuCore previews", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.match(route, /if \(adding \|\| factionFilterAuto\) setFactionFilters\(nextFactions\)/);
  assert.match(route, /\[\.\.\.new Set\(source\?\.factions \?\? \[\]\)\]/);
  assert.match(route, /item\.kind === "card" \|\| !factionFilterAuto/);
  assert.match(route, /setFactionFilterAuto\(false\)/);
  assert.match(route, /Team faction/);
  assert.match(route, /selectedCoreSlots/);
  assert.match(route, /BakuCoreBack/);
  assert.match(route, /BakuCore reverse/);
  assert.match(route, /CORE_BACK_IMAGES/);
  assert.match(route, /<img\s+[\s\S]*?src=\{CORE_BACK_IMAGES\[type\]/);
  assert.match(css, /\.bakuCoreBack\s*\{[^}]*opacity:\s*\.24/s);
  assert.match(css, /\.bakuCoreBack\s*>\s*img\s*\{[^}]*object-fit:\s*contain/s);
  for (const slug of ["fist", "flaming-fist", "shield", "magic-shield", "helix"]) {
    assert.equal(
      existsSync(new URL(`../public/assets/bakucores/backs/${slug}.png`, import.meta.url)),
      true,
      `missing ${slug} BakuCore reverse asset`,
    );
  }
  assert.match(route, /FACTION_SYMBOLS/);
});

test("Card Gallery tabs and both card collections provide search, Card ID sorting, filters, and responsive dialogs", async () => {
  const [route, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.ok((route.match(/<BuilderToolbar/g) ?? []).length >= 2);
  for (const tab of ["Character Cards", "Cores", "Main Deck Cards"]) assert.match(route, new RegExp(tab));
  assert.match(route, /\["id-asc", "Card ID"\]/);
  assert.match(route, /left\.id\.localeCompare\(right\.id/);
  assert.match(route, /surface: "gallery", panel: "sort"/);
  assert.match(route, /surface: "gallery", panel: "filter"/);
  assert.match(route, /surface: "deck", panel: "sort"/);
  assert.match(route, /surface: "deck", panel: "filter"/);
  assert.match(css, /\.builderMenuDialog\s*\{[^}]*width:\s*min\(100%,\s*34rem\)/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderMenuDialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
});

test("Save Deck dialog owns metadata, featured card choice, and permits invalid non-public decks", async () => {
  const [route, data, persistence, server, css] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("lib/data.ts"),
    read("lib/persistence.ts"),
    read("app/api/user-data/route.ts"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.doesNotMatch(route, /<input aria-label="Deck name"/);
  assert.doesNotMatch(route, /<label>Visibility<select/);
  for (const contract of [
    'panel: "save"',
    "Deck name",
    "Deck description",
    "Featured Card",
    "Choose the Main Deck card used as this deck’s featured artwork.",
    "saveLeadCardId",
    "builderFeaturedCardPicker",
    "Draft",
    "Only visible to you.",
    "Only visible through its link.",
    "Visible in the Public Deck library.",
    "eligible for featuring on the Home Page",
    "Draft and Private decks can be saved with issues.",
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(route, /leadCardId:\s*saveLeadCardId\s*&&\s*deck\.cardIds\.includes\(saveLeadCardId\)/);
  assert.match(route, /grouped\.map\(\(\{ card \}\)/);
  assert.match(css, /\.builderFeaturedCardPicker\s*>\s*div\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.match(route, /\(saveVisibility === "Public" \|\| adminAiId\) && !latest\.isLegal/);
  assert.match(data, /visibility:\s*"Draft" \| "Private" \| "Public"/);
  assert.match(persistence, /deck\.visibility === "Draft" \? "Draft"/);
  assert.match(server, /deck\.visibility === "Public" && !validation\.isLegal/);
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
