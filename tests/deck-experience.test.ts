import { deckRouteSource } from "./route-source";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUILDER_GALLERY_PAGE_SIZE, paginateBuilderGallery } from "../lib/builder-gallery-pagination";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Deck Library uses a separate compact stylesheet and preserves deck previews", async () => {
  const [route, css] = await Promise.all([deckRouteSource(), read("components/routes/DeckLibrary.module.css")]);
  for (const contract of ["DeckLibraryHeader", "DeckToolbar", "DeckGalleryBody", "DeckLibrarySkeleton", "Working offline", "Deck storage needs attention", "No decks match", "Build your first deck"]) {
    assert.match(route, new RegExp(contract));
  }
  assert.match(css, /\.gridList\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.cardFooter\{/);
  assert.doesNotMatch(route, /Selected for Play|Select for Play/);
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
    read("components/routes/MatchCreationScreen.tsx"),
    read("lib/user-data-server.ts"),
    deckRouteSource(),
  ]);
  assert.match(data, /validateDeckConstruction/);
  assert.match(play, /deckIsLegalForFormat\(deck, "standard"\)/);
  assert.match(play, /deckIsLegalForFormat\(deck, "competitive"/);
  assert.match(server, /validateDeck\(deck as unknown as DeckRecord\)/);
  assert.match(server, /firstIssue\.code/);
  assert.match(decks, /const report = useMemo\(\(\) => validateDeck\(\{ \.\.\.deck, name: saveName \}/);
});

test("Select Your Deck keeps tags, title, and description in separate styled rows", async () => {
  const css = await read("app/(workspace)/play/presentation-fix.module.css");
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
  assert.match(css, /span:nth-child\(2\)[\s\S]*?grid-row:\s*1/);
  assert.match(css, /> strong\)[\s\S]*?grid-row:\s*2/);
  assert.match(css, /span:last-child:not\(:first-child\)[\s\S]*?grid-row:\s*3/);
  assert.match(css, /span:nth-child\(2\) > span\)[\s\S]*?text-transform:\s*uppercase[\s\S]*?clip-path:/);
});


test("Builder is a single compact workspace with shared Compendium galleries", async () => {
  const [builder, css, cards, cores] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilder.module.css"),
    read("components/routes/CardsGallery.tsx"),
    read("components/routes/CoresGallery.tsx"),
  ]);
  assert.match(builder, /<CardsGallery cards=/);
  assert.match(builder, /<CoresGallery cores=/);
  assert.match(builder, /function BuilderQuantity/);
  assert.match(cards, /renderControls\?: \(card: GameCard\)/);
  assert.match(cores, /renderControls\?: \(core: Core\)/);
  assert.match(cards, /<ResponsiveCardImage card=\{displayed\} presentation="tile"/);
  assert.match(cores, /<BakuCoreArt core=\{displayedCore\}/);
  assert.match(css, /\.workspace\{[^}]*grid-template-columns:minmax\(0,57fr\) minmax\(0,43fr\)/);
  assert.match(css, /@media\(max-width:800px\)/);
  assert.match(css, /\.mobileTabs\{display:grid/);
  assert.doesNotMatch(builder, /builderStatus|BuilderRequirementHeader|BuilderIssues|builderInfoInvalid/);
});

test("Team links each Character to exactly two BakuCore slots without redundant labels", async () => {
  const builder = await read("components/routes/DeckBuilderScreen.tsx");
  assert.match(builder, /Array\.from\(\{ length: 3 \}, \(_, index\) =>/);
  assert.match(builder, /className=\{styles\.pairedCores\}/);
  assert.match(builder, /\[0, 1\]\.map\(offset =>/);
  assert.match(builder, /const slot = index \* 2 \+ offset/);
  assert.match(builder, /requiredCoreTypes\[slot\]/);
  assert.match(builder, /chooseCoreSlot\(type\)/);
  assert.match(builder, /preferredCorePrinting\(core, deck\.printingPreferences\)/);
  assert.doesNotMatch(builder, /Each pair sits beneath|Character requirements|BakuCore requirements/);
});

test("One quantity counter is shared across printings and both Builder galleries", async () => {
  const [builder, helper, controls, inspector] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("lib/deck-printings.ts"),
    read("lib/builder-card-selection.ts"),
    read("components/cards/CardInspector.tsx"),
  ]);
  assert.match(builder, /countConstructionCopies\(deck\.cardIds\)/);
  assert.match(builder, /cardCounts\.get\(cardPrintingKey\(card\)\)/);
  assert.match(builder, /renderControls=\{card => <BuilderQuantity/);
  assert.match(builder, /onPrintingChange=\{next => \{ setInspectorPrinting\(next\); selectPreferredPrinting\(cardPrintingKey\(inspection\.card\), next\); \}\}/);
  assert.match(helper, /inspectorCardPrintings\(card, CARDS\)/);
  assert.match(controls, /deckConstructionIdentity/);
  assert.match(inspector, /onPrintingChange\?\.\(next\)/);
  assert.doesNotMatch(builder, /printingCounts|copies of this printing|alternateCount/);
});

test("Builder uses the same Main Deck card grid in Browse and Deck", async () => {
  const [builder, css] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.equal((builder.match(/<CardsGallery /g) ?? []).length, 2);
  assert.match(builder, /cards=\{mainDeckCards\.map\(entry => entry\.card\)\}/);
  assert.match(builder, /galleryDensity/);
  assert.match(builder, /deck\.cardIds\.length\}\/\{mainDeckMaximum\}/);
  assert.doesNotMatch(builder, /progressTrack|progressBar/);
  assert.match(css, /\.deck :global\(\[data-cards-gallery\]\)/);
  assert.match(css, /@media\(max-width:350px\)/);
});

test("Save preserves preferred artwork without reinstating a preselected play deck", async () => {
  const [builder, deck, transfer, session, page] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("lib/data.ts"),
    read("lib/deck-transfer.ts"),
    read("lib/builder-session.ts"),
    read("app/(workspace)/builder/[id]/page.tsx"),
  ]);
  assert.match(deck, /printingPreferences\?: Record<string, string>/);
  assert.match(transfer, /printingPreferences: cleanDeckPrintingPreferences/);
  assert.match(transfer, /printingPreferences: deck\.printingPreferences/);
  assert.match(session, /printingPreferences: deck\.printingPreferences/);
  assert.match(builder, /printingPreferences: \{ \.\.\.deck\.printingPreferences/);
  assert.match(builder, /setDecks\(\(items: DeckRecord\[\]\)/);
  assert.doesNotMatch(builder, /setSelectedDeckId/);
  assert.doesNotMatch(page, /DeckBuilderPresentationBridge|presentation-fix/);
});

test("Obsolete Deck Builder presentation code, layout overrides and status rail are gone", async () => {
  const [legacy, current, page] = await Promise.all([
    read("components/routes/DeckRoutes.module.css"),
    read("components/routes/DeckBuilder.module.css"),
    read("app/(workspace)/builder/[id]/page.tsx"),
  ]);
  for (const obsolete of [
    "components/routes/DeckBuilderPresentationBridge.tsx",
    "components/routes/DeckBuilderPresentationBridge.module.css",
    "app/(workspace)/builder/[id]/presentation-fix.module.css",
    "app/deck-builder-layout.css",
  ]) assert.equal(existsSync(new URL("../" + obsolete, import.meta.url)), false, obsolete);
  assert.doesNotMatch(legacy, /\.builder(?:[A-Z]|\s*\{)|\.builderStatus|\.builderGallery/);
  assert.doesNotMatch(current, /\.builderStatus|\.builderIssueList|\.builderRequirementHeader/);
  assert.match(page, /<DeckBuilderScreen id=\{decodedId\}/);
});

test("Builder and Compendium use the same Lucide glyphs for view and filter controls", async () => {
  const [builder, compendium, iconSource, css] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/CompendiumToolbar.tsx"),
    read("components/design-system/LucideIcon.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.match(builder, /import \{ LucideIcon \} from "\.\.\/design-system\/LucideIcon"/);
  assert.match(compendium, /import \{ LucideIcon \} from "\.\.\/design-system\/LucideIcon"/);
  for (const icon of ["layout-list", "layout-grid", "sliders-horizontal", "search"]) {
    assert.match(builder, new RegExp('"' + icon + '"'));
    assert.match(compendium, new RegExp('"' + icon + '"'));
    assert.match(iconSource, new RegExp('"' + icon + '":'));
  }
  assert.match(builder, /galleryDensity === "detailed" \? "layout-list" : "layout-grid"/);
  assert.match(compendium, /density === "gallery" \? "layout-list" : "layout-grid"/);
  assert.match(iconSource, /stroke="currentColor" strokeWidth=\{2\}/);
  assert.match(iconSource, /aria-hidden="true" focusable="false"/);
  assert.match(css, /\.searchIcon\{position:absolute/);
});

test("Builder uses Lucide icons throughout its controls without text-symbol fallbacks", async () => {
  const [builder, icons] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/design-system/LucideIcon.tsx"),
  ]);
  for (const icon of [
    "arrow-left", "arrow-down-up", "check", "circle-alert", "layout-list",
    "layout-grid", "sliders-horizontal", "search", "hexagon", "plus", "minus",
    "x", "chevron-left", "chevron-right",
  ]) assert.match(icons, new RegExp('"' + icon + '":'));
  for (const icon of ["arrow-left", "chevron-left", "chevron-right", "hexagon", "plus", "minus", "x"])
    assert.match(builder, new RegExp('name="' + icon + '"'));
  assert.doesNotMatch(builder, /[←✓▦↕◇＋×‹›−]/);
  assert.match(builder, /<BakuCoreBack type=\{type\} \/>/);
  assert.match(builder, /<BakuCoreArt core=\{displayCore\}/);
});

test("Team Characters display full-size Compendium faction and rolling tags beneath their artwork", async () => {
  const [builder, gallery, stats, css, galleryCss] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/CardsGallery.tsx"),
    read("components/cards/BakuganRollingStats.tsx"),
    read("components/routes/DeckBuilder.module.css"),
    read("components/routes/CardsGallery.module.css"),
  ]);
  assert.match(builder, /const rolling = character && bakuganRollingValues\(character\.character\)/);
  assert.match(builder, /const factions = display \? \[\.\.\.new Set\(display\.factions\.length \? display\.factions : \[display\.faction\]\)\] : \[\]/);
  assert.match(builder, /className=\{styles\.teamCharacterTags\} data-ui="team-character-tags"/);
  assert.match(builder, /className=\{cardTileStyles\.factions\}/);
  assert.match(builder, /factions\.map\(faction => <CardFactionTag key=\{faction\} faction=\{faction\} \/>\)/);
  assert.match(builder, /<BakuganRollingStat kind="rollAccuracy" value=\{rolling\.rollAccuracy\} plain \/>/);
  assert.match(builder, /<BakuganRollingStat kind="doubleCoreChance" value=\{rolling\.doubleCoreChance\} plain \/>/);
  assert.match(builder, /cardTileStyles\.tag/);
  assert.match(builder, /cardTileStyles\.rollingTag/);
  assert.match(gallery, /BakuganRollingStat kind="rollAccuracy"/);
  assert.match(gallery, /BakuganRollingStat kind="doubleCoreChance"/);
  assert.match(stats, /const label = isRollAccuracy \? "Roll Accuracy" : "Double Core Chance"/);
  assert.doesNotMatch(builder, /BakuganRollingOverlay/);
  assert.match(css, /\.teamCharacterTags\{display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center;gap:4px/);
  assert.doesNotMatch(css, /\.teamRollingStats/);
  assert.doesNotMatch(css, /\.teamCharacterTags\{[^}]*justify-content:center/);
  assert.match(galleryCss, /\.faction \{[\s\S]*?width: 24px;\s*height: 24px/);
  assert.match(galleryCss, /\.tag \{[\s\S]*?padding: 3px 6px;[\s\S]*?font: 500 10px\/16px/);
});

test("Team inspection uses the same pointer cursor, sheen and focus behavior as Compendium tiles", async () => {
  const [builder, css, cardCss, coreCss] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilder.module.css"),
    read("components/routes/CardsGallery.module.css"),
    read("components/routes/CoresGallery.module.css"),
  ]);
  assert.match(builder, /className=\{cardTileStyles\.tile\}/);
  assert.match(builder, /className=\{coreTileStyles\.tile\}/);
  assert.match(builder, /className=\{cardTileStyles\.artwork\}/);
  assert.match(builder, /className=\{coreTileStyles\.artwork\}/);
  assert.match(cardCss, /\.tile:hover \.artwork::after/);
  assert.match(coreCss, /\.tile:hover \.artwork::after/);
  assert.match(cardCss, /\.tile:focus-visible \.artwork/);
  assert.match(coreCss, /\.tile:focus-visible \.artwork/);
  assert.doesNotMatch(css, /cursor:zoom-in/);
  assert.match(css, /\.teamCharacter>button:first-child\{width:100%;cursor:pointer\}/);
  assert.match(css, /\.coreSlot>button:first-child\{width:100%;cursor:pointer\}/);
});

test("Team counts use a matching Lucide card and BakuCore icon", async () => {
  const [builder, icons, style] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/design-system/LucideIcon.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.match(builder, /name="rectangle-vertical" size=\{16\}/);
  assert.match(builder, /name="hexagon" size=\{16\}/);
  assert.match(builder, /className=\{styles\.teamCountDivider\}/);
  assert.match(icons, /"rectangle-vertical": <rect width="12" height="20" x="6" y="2" rx="2"\/>/);
  assert.match(style, /\.teamCountDivider\{display:block/);
});

test("Team removal uses high-contrast circular Lucide buttons and remains available on touch and keyboard", async () => {
  const [builder, icons, style] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/design-system/LucideIcon.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.equal((builder.match(/name="circle-minus"/g) ?? []).length, 2);
  assert.match(icons, /"circle-minus": <><circle cx="12" cy="12" r="10"\/><path d="M8 12h8"\/><\/>/);
  assert.match(builder, /className=\{styles\.removeCharacter\} onClick=\{\(\) => toggleCharacter\(character\.id\)\}/);
  assert.match(builder, /className=\{styles\.removeCore\} onClick=\{\(\) => adjustCore\(core\.id, -1\)\}/);
  assert.match(style, /\.removeCharacter,\.removeCore\{[\s\S]*?position:absolute;right:4px;top:4px;z-index:2/);
  assert.match(style, /border:0;\s*border-radius:50%;background:rgba\(2,12,17,\.85\)/);
  assert.match(style, /\.removeCore\{top:3px;right:3px;width:28px;height:28px\}/);
  assert.match(style, /border-radius:50%;background:rgba\(2,12,17,\.85\);color:var\(--bb-white\)/);
  assert.match(style, /\.removeCharacter:hover,\.removeCore:hover\{[\s\S]*?background:rgba\(15,45,58,\.95\)/);
  assert.doesNotMatch(style, /\.removeCharacter svg,\.removeCore svg\{\s*filter:drop-shadow/);
  assert.match(style, /@media \(hover:hover\) and \(pointer:fine\)\{/);
  assert.match(style, /\.teamCharacter:focus-within \.removeCharacter/);
  assert.match(style, /\.coreSlot:focus-within \.removeCore/);
  assert.match(style, /\.removeCharacter:focus-visible,\.removeCore:focus-visible/);
  const touchRules = style.slice(style.indexOf("/* Contextual Lucide minus:"));
  assert.ok(touchRules.indexOf("opacity:0") > touchRules.indexOf("@media (hover:hover) and (pointer:fine)"));
});
