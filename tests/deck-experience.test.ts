import { deckRouteSource } from "./route-source";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUILDER_GALLERY_PAGE_SIZE, paginateBuilderGallery } from "../lib/builder-gallery-pagination";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Deck Library includes the complete responsive library composition", async () => {
  const [route, css] = await Promise.all([
    deckRouteSource(),
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
    deckRouteSource(),
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

test("Deck Builder paginates the complete sorted gallery without dropping results", () => {
  const cards = Array.from({ length: 257 }, (_, index) => index + 1);
  assert.equal(BUILDER_GALLERY_PAGE_SIZE, 24);
  assert.deepEqual(paginateBuilderGallery(cards, 1), {
    items: cards.slice(0, 24), page: 1, pageCount: 11, start: 1, end: 24,
  });
  assert.deepEqual(paginateBuilderGallery(cards, 2), {
    items: cards.slice(24, 48), page: 2, pageCount: 11, start: 25, end: 48,
  });
  assert.deepEqual(paginateBuilderGallery(cards, 99), {
    items: cards.slice(240), page: 11, pageCount: 11, start: 241, end: 257,
  });
  assert.deepEqual(paginateBuilderGallery([], 8), {
    items: [], page: 1, pageCount: 1, start: 0, end: 0,
  });
  assert.equal(paginateBuilderGallery(cards.slice(0, 8), 5).page, 1);
});

test("Deck Builder keeps gallery/deck switching inside the mobile header and only the search tools sticky", async () => {
  const [route, css] = await Promise.all([
    deckRouteSource(),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  const headerStart = route.indexOf('<header className={styles.builderHeader}>');
  const headerEnd = route.indexOf("</header>", headerStart);
  const header = route.slice(headerStart, headerEnd);
  assert.ok(headerStart > 0 && headerEnd > headerStart);
  assert.match(header, /builderDeckIdentity/);
  assert.match(header, /builderFormat/);
  assert.match(header, /Save Deck/);
  assert.match(header, /builderMobileTabs/);
  assert.match(route, /paginateBuilderGallery\(galleryItems, galleryPage\)/);
  assert.match(route, /galleryPagination\.items\.map/);
  assert.match(route, /Card Gallery pages/);
  assert.match(route, /setGalleryPage\(1\)/);
  assert.doesNotMatch(route, /\.slice\(0, 240\)/);
  assert.match(css, /\.builderGalleryTabs\s*\{[^}]*clip-path:\s*none/s);
  assert.match(css, /\.builderHeader \.builderMobileTabs\s*\{[^}]*position:\s*static/s);
  assert.match(css, /\.builderGallery \.builderToolbar\s*\{[^}]*top:\s*64px/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderHeader\s*\{[^}]*position:\s*relative/s);
});

test("mobile Deck Builder header uses full-width compact tabs, aligned controls and site-styled format options", async () => {
  const [route, css] = await Promise.all([
    deckRouteSource(),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  const start = route.indexOf('<header className={styles.builderHeader}>');
  const header = route.slice(start, route.indexOf("</header>", start));
  assert.match(header, /<FilterPicker[\s\S]*?label="Deck format"[\s\S]*?mode="single"[\s\S]*?clearable=\{false\}/);
  assert.match(header, /DECK_FORMAT_OPTIONS/);
  assert.match(header, /commit\(\{ \.\.\.deck, format \}\)/);
  assert.doesNotMatch(header, /<select|<option/);
  assert.match(header, /title=\{deck.name\}/);
  assert.match(css, /\.builderHeader \.builderDeckIdentity strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.builderHeader \.builderFormat \[data-ui="filter-picker"\] > button\s*\{[^}]*height:\s*2\.75rem/s);
  assert.match(css, /\.builderHeader > \[data-ui="action-button"\]\s*\{[^}]*height:\s*2\.75rem[^}]*clip-path:\s*none/s);
  assert.match(css, /\.builderHeader \.builderMobileTabs\s*\{[^}]*width:\s*calc\(100% \+ 2 \* var\(--builder-header-gutter\)\)[^}]*height:\s*2\.75rem/s);
  assert.match(css, /\.builderHeader \.builderMobileTabs > button\s*\{[^}]*height:\s*2\.75rem/s);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.builderHeader\s*\{[^}]*grid-template-columns:\s*1\.875rem minmax\(0, 1fr\) 5\.85rem 5\.8rem/s);
});

test("builder status rail has three single-line totals without legality or mobile scrolling", async () => {
  const [route, css] = await Promise.all([deckRouteSource(), read("components/routes/DeckRoutes.module.css")]);
  const start = route.indexOf('<footer className={styles.builderStatus}>');
  const footer = route.slice(start, route.indexOf("</footer>", start));
  assert.ok(start > -1);
  for (const label of ["Characters", "BakuCores", "Main Deck"]) assert.match(footer, new RegExp(label));
  assert.doesNotMatch(footer, /Legality|report\.issues/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.builderStatus\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.builderStatus\s*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(css, /\.builderStatus\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.builderStatus\s*\{[^}]*height:\s*2\.5rem;\s*min-height:\s*2\.5rem/);
  const layoutCss = await read("app/deck-builder-layout.css");
  assert.match(layoutCss, /@media \(max-width: 800px\)[\s\S]*?--deck-builder-status-height:\s*2\.5rem/);
});

test("phone Card Gallery pagination uses one row and avoids unnecessary bottom padding", async () => {
  const [css, layoutCss, route] = await Promise.all([
    read("components/routes/DeckRoutes.module.css"),
    read("app/deck-builder-layout.css"),
    deckRouteSource(),
  ]);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.builderGalleryPageControls\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*2\.75rem 2\.75rem minmax\(0, 1fr\) 2\.75rem 2\.75rem/s);
  assert.match(css, /\.builderGalleryPageControls > button\s*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(css, /\.builderGalleryPageLong\s*\{\s*display:\s*none/s);
  assert.match(css, /\.builderGalleryPageShort\s*\{\s*display:\s*inline/s);
  assert.match(route, /builderGalleryPageIndicator/);
  assert.match(layoutCss, /--deck-builder-bottom-offset:\s*4\.2rem;[\s\S]*?padding-bottom:\s*calc\(\s*var\(--deck-builder-status-height\)\s*\+ var\(--deck-builder-bottom-offset\)\s*\)/);
});

test("Deck Builder cards expose quantities, responsive shared inspection, and section issue dialogs", async () => {
  const [route, css, inspectorCss] = await Promise.all([
    deckRouteSource(),
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
    deckRouteSource(),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.match(route, /setGalleryFilters\(\(current\) => \(\{ \.\.\.current, faction: nextFactions \}\)\)/);
  assert.match(route, /faction:\s*\[\.\.\.new Set\(deck\.factions \?\? \[\]\)\]/);
  assert.match(route, /item\.kind === "character" && factionFilterAuto/);
  assert.match(route, /setFactionFilterAuto\(false\)/);
  assert.match(route, /restrictCardFilters/);
  assert.match(route, /Team faction/);
  assert.match(route, /selectedCoreSlots/);
  assert.match(route, /BakuCoreBack/);
  assert.match(route, /BakuCore reverse/);
  assert.match(route, /CORE_BACK_IMAGES/);
  assert.match(route, /<OriginalImage\s+[\s\S]*?src=\{CORE_BACK_IMAGES\[type\]/);
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

test("Card Gallery tabs and both card collections provide search, category sorting, filters, and responsive dialogs", async () => {
  const [route, css] = await Promise.all([
    deckRouteSource(),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.ok((route.match(/<BuilderToolbar/g) ?? []).length >= 2);
  for (const tab of ["Character Cards", "Cores", "Main Deck Cards"]) assert.match(route, new RegExp(tab));
  assert.match(route, /builderSortOptions\(activeMenu.surface/);
  assert.match(route, /normalizeBuilderSort\(galleryCategory, restoredText\("gallerySort", "collector"\)\)/);
  assert.match(route, /sortBuilderItems\(left, right, effectiveGallerySort/);
  assert.match(route, /surface: "gallery", panel: "sort"/);
  assert.match(route, /surface: "gallery", panel: "filter"/);
  assert.match(route, /surface: "deck", panel: "sort"/);
  assert.match(route, /surface: "deck", panel: "filter"/);
  assert.match(route, /CardFilterPanel/);
  assert.match(route, /createCardFilterOptionCatalogue/);
  assert.match(route, /cardMatchesFilters/);
  assert.match(route, /coreMatchesFilters/);
  assert.match(route, /BUILDER_MAIN_DECK_FILTER_FACETS/);
  assert.match(route, /BUILDER_GALLERY_FILTER_FACETS/);
  assert.doesNotMatch(route, /function BuilderFilterGroup/);
  assert.doesNotMatch(route, /builderFilterSelects/);
  assert.match(css, /\.builderMenuDialog\s*\{[^}]*width:\s*min\(100%,\s*34rem\)/s);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.builderMenuDialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
});

test("deck builder Cores use Compendium preview hierarchy and a three-column phone gallery", async () => {
  const [builder, css] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckRoutes.module.css"),
  ]);
  assert.match(builder, /corePreviewStats\(core\)\.map/);
  assert.match(builder, /coreForSet\(core, selectedCoreSet\)/);
  assert.match(builder, /galleryCategory === "cores" \? styles\.builderCoreGalleryGrid/);
  assert.match(builder, /builderCoreStatList/);
  assert.match(builder, /builderCoreSetLabel/);
  const start = builder.indexOf("{core && displayedCore ? (");
  assert.ok(start > 0, "Missing simplified BakuCore identity");
  const coreIdentity = builder.slice(start, builder.indexOf(") : (", start));
  assert.match(coreIdentity, /<strong>\{core\.type\}<\/strong>/);
  assert.doesNotMatch(coreIdentity, /item\.name|metadata|Alternate/);
  assert.match(css, /\.builderCoreIdentity[\s\S]*?\.builderCoreStatList[\s\S]*?\.builderCoreSetLabel/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.builderCoreGalleryGrid\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.builderGalleryGrid,\s*\.builderMainDeckGrid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.builderCoreGalleryGrid \.builderQuantity\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("Save Deck dialog owns metadata, featured card choice, and permits invalid non-public decks", async () => {
  const [route, data, persistence, server, css] = await Promise.all([
    deckRouteSource(),
    read("lib/data.ts"),
    read("lib/persistence.ts"),
    read("lib/user-data-server.ts"),
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
  assert.match(route, /\(saveVisibility === "Public" \|\| adminAiId \|\| adminOfflineId\) && !latest\.isLegal/);
  assert.match(data, /visibility:\s*"Draft" \| "Private" \| "Public"/);
  assert.match(persistence, /deck\.visibility === "Draft" \? "Draft"/);
  assert.match(server, /deck\.visibility === "Public" && !validation\.isLegal/);
});

test("public copying and read-only details reuse validation and preserve attribution", async () => {
  const [route, persistence] = await Promise.all([
    deckRouteSource(),
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

test("public deck details expose creator identity through the established Brawler preview", async () => {
  const [route, publicDeckApi, identity, preview] = await Promise.all([
    deckRouteSource(),
    read("app/api/public-decks/route.ts"),
    read("components/profile/DeckCreatorIdentity.tsx"),
    read("components/profile/PlayerPreview.tsx"),
  ]);
  assert.match(publicDeckApi, /listManagedPublicDecks/);
  assert.match(publicDeckApi, /creatorUserId:\s*item\.source\.kind === "user" \? item\.source\.userId : undefined/);
  assert.match(route, /DeckCreatorIdentity/);
  assert.match(route, /creatorUserId\?: string/);
  assert.match(identity, /ProfileAvatar/);
  assert.match(identity, /PlayerPreview/);
  assert.match(identity, /\/api\/profile\?userId=/);
  assert.match(preview, />\s*VIEW PROFILE\s*</);
  assert.match(preview, /\/brawlers\/\$\{encodeURIComponent\(summary\.userId\)\}/);
});

test("all legality boundaries delegate to the centralized engine", async () => {
  const [data, play, server, decks] = await Promise.all([
    read("lib/data.ts"),
    read("components/routes/PlayRoutes.tsx"),
    read("lib/user-data-server.ts"),
    deckRouteSource(),
  ]);
  assert.match(data, /validateDeckConstruction/);
  assert.match(play, /validateDeck\(chosenDeck\)/);
  assert.match(play, /playSetupStartBlockers/);
  assert.match(server, /validateDeck\(deck as unknown as DeckRecord\)/);
  assert.match(server, /firstIssue\.code/);
  assert.match(decks, /const report = useMemo\(\(\) => validateDeck\(deck(?:,|\))/);
});
