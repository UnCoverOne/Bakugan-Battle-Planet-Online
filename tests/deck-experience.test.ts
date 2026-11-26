import { deckRouteSource } from "./route-source";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORES } from "../lib/data";
import { coreEffects } from "../lib/core-preview";
import { coreMatchesFilters, createEmptyCardFilters } from "../lib/card-filters";
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
  assert.match(route, /legalDeckFormats\(deck,/);
  assert.match(route, /validateDeck\(deck,/);
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
    read("lib/lobby-preparation.ts"),
    read("lib/user-data-server.ts"),
    deckRouteSource(),
  ]);
  assert.match(data, /validateDeckConstruction/);
  assert.match(play, /validateDeck\(/);
  assert.match(server, /validateDeck\(deck as unknown as DeckRecord\)/);
  assert.match(server, /firstIssue\.code/);
  assert.match(decks, /const report = useMemo\(\(\) => validateDeck\(\{ \.\.\.deck, name: saveName \}/);
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
  assert.match(css, /\.teamCharacterTags\{[^}]*padding-top:4px\}/);
  assert.match(css, /\.teamCharacter \+ \.pairedCores\{margin-top:4px\}/);
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

test("Team remove bars use Lucide minus beneath Character tags and BakuCore artwork", async () => {
  const [builder, icons, style] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/design-system/LucideIcon.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.equal((builder.match(/name="minus" size=\{1[67]\}/g) ?? []).length, 2);
  assert.match(icons, /"minus": <path d="M5 12h14"\/>/);
  assert.match(builder, /className=\{styles\.removeCharacter\} onClick=\{\(\) => toggleCharacter\(character\.id\)\}/);
  assert.match(builder, /className=\{styles\.removeCore\} onClick=\{\(\) => adjustCore\(core\.id, -1\)\}/);
  assert.match(builder, /<LucideIcon name="minus" size=\{17\} \/><span>Remove<\/span><\/button>/);
  assert.match(builder, /<LucideIcon name="minus" size=\{16\} \/><\/button>/);
  assert.match(builder, /aria-label=\{`Remove \$\{character\.name\}`\}/);
  assert.match(builder, /aria-label=\{`Remove \$\{core\.name\}`\}/);
  assert.match(style, /\.teamCharacter\{min-width:0;display:grid;align-content:start;gap:4px\}/);
  assert.match(style, /\.coreSlot\{min-width:0;display:grid;align-content:start;gap:3px\}/);
  assert.match(style, /\.removeCharacter,\.removeCore\{[\s\S]*?width:100%;min-height:29px/);
  assert.match(style, /\.removeCore\{min-height:29px;padding:0\}/);
  const characterStart = builder.indexOf('className={styles.teamCharacter}');
  const tagStart = builder.indexOf('className={styles.teamCharacterTags}', characterStart);
  const removeStart = builder.indexOf('className={styles.removeCharacter}', characterStart);
  const characterEnd = builder.indexOf('className={styles.emptyCharacter}', characterStart);
  assert.ok(characterStart >= 0 && tagStart > characterStart && removeStart > tagStart && characterEnd > removeStart,
    "Character Remove must follow the faction and rolling tags");
  const coreStart = builder.indexOf('className={styles.coreSlot}');
  const coreInspect = builder.indexOf('className={coreTileStyles.tile}', coreStart);
  const coreRemove = builder.indexOf('className={styles.removeCore}', coreStart);
  assert.ok(coreStart >= 0 && coreInspect > coreStart && coreRemove > coreInspect,
    "BakuCore Remove must follow its artwork");
  assert.match(style, /\.removeCharacter:hover,\.removeCore:hover\{[\s\S]*?var\(--bb-pyrus-border\)/);
  assert.match(style, /\.removeCharacter:focus-visible,\.removeCore:focus-visible/);
  assert.doesNotMatch(style, /\.removeCharacter,\.removeCore\{[^}]*position:absolute/);
  assert.doesNotMatch(style, /\.removeCharacter,\.removeCore\{[^}]*opacity:0/);
  assert.match(style, /\.pairedCores\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);align-items:start/);
});

test("Save Deck header button is text-only and keeps legal-deck guidance", async () => {
  const [builder, css] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilder.module.css"),
  ]);
  assert.match(builder, /className=\{styles\.saveButton\} onClick=\{openSaveDialog\}/);
  assert.match(builder, /title=\{report\.isLegal \? "Deck is legal"/);
  assert.match(builder, /className=\{styles\.saveButton\}[\s\S]*?\n\s*Save\n\s*<\/button>/);
  assert.doesNotMatch(builder, /report\.isLegal \? "check" : "circle-alert"/);
  assert.doesNotMatch(css, /\.saveButton>span|\.legal\{|\.unready\{/);
});

test("Save Deck has a persistent metadata layout and a dedicated featured-card modal", async () => {
  const [builder, dialog, css] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckSaveDialog.tsx"),
    read("components/routes/DeckSaveDialog.module.css"),
  ]);
  assert.match(builder, /<DeckSaveDialog/);
  assert.match(builder, /cards=\{grouped\}/);
  assert.match(dialog, /import \{ DeckPreview \} from "\.\/DeckGalleryCard"/);
  assert.match(dialog, /<DeckPreview deck=\{previewDeck\} \/>/);
  assert.match(dialog, /<textarea value=\{description\}/);
  assert.match(dialog, /data-ui="featured-card-picker"/);
  assert.match(dialog, /onFeaturedCardChange\(card\.catalogId\)/);
  assert.match(dialog, /name="save-deck-visibility"/);
  for (const text of ["Only visible to you.", "Only visible through its link.", "Visible in the Public Deck library."]) {
    assert.ok(dialog.includes(text), text);
  }
  assert.match(css, /\.topGrid\{display:grid;grid-template-columns:/);
  assert.match(css, /@media\(max-width:650px\)/);
  assert.doesNotMatch(builder, /<details className=\{styles\.saveDetails\}>/);
});

test("Save Deck places a small preview alongside the name on narrow screens", async () => {
  const css = await read("components/routes/DeckSaveDialog.module.css");
  const mobile = css.slice(css.indexOf("@media(max-width:650px)"));
  assert.match(mobile, /\.topGrid\{grid-template-columns:minmax\(0,1fr\) clamp\(99px,32\.5vw,135px\)/);
  assert.match(mobile, /\.previewSection,\.metadata\{display:contents\}/);
  assert.match(mobile, /\.metadata>\.field:first-child\{grid-column:1;grid-row:1/);
  assert.match(mobile, /\.preview\{grid-column:2;grid-row:1 \/ span 3/);
  assert.match(mobile, /\.valid,\.invalid\{grid-column:1;grid-row:2/);
  assert.match(mobile, /\.counts\{grid-column:1;grid-row:3/);
  assert.match(mobile, /\.metadata>\.field:nth-child\(2\)\{grid-column:1 \/ -1;grid-row:4/);
  assert.match(mobile, /\.featuredSection\{grid-column:1 \/ -1;grid-row:5/);
  assert.doesNotMatch(mobile, /\.preview\{max-width:320px\}/);
});

test("Save Deck footer uses a blue save action and neutral cancel button", async () => {
  const [dialog, designSystem] = await Promise.all([
    read("components/routes/DeckSaveDialog.tsx"),
    read("app/design-system.css"),
  ]);
  assert.match(dialog, /className="bb-button" onClick=\{onClose\}>Cancel<\/button>/);
  assert.match(dialog, /className="bb-button bb-button--blue" disabled=\{saveDisabled\} onClick=\{onSave\}/);
  assert.match(dialog, /className="bb-button" onClick=\{\(\) => setPickerOpen\(false\)\}>Back to Save Deck<\/button>/);
  assert.doesNotMatch(dialog, /<ActionButton/);
  assert.match(designSystem, /\.bb-button\s*\{/);
  assert.match(designSystem, /\.bb-button--blue\s*\{ background: var\(--bb-action-save\)/);
  assert.match(designSystem, /\.bb-button\.bb-button--blue:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
});

test("Unsaved changes dialog uses red Discard and blue Save draft buttons", async () => {
  const [builder, designSystem] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("app/design-system.css"),
  ]);
  const start = builder.indexOf('title="Unsaved changes"');
  const end = builder.indexOf('title="Save Deck"', start);
  const dialog = end > start ? builder.slice(start, end) : builder.slice(start, builder.indexOf('activeMenu?.panel === "save"', start));
  assert.ok(start >= 0, "Unsaved changes dialog exists");
  assert.match(dialog, /className="bb-button bb-button--danger" onClick=\{\(\) => \{/);
  assert.match(dialog, /\}>Discard<\/button>/);
  assert.match(dialog, /className="bb-button bb-button--blue"/);
  assert.match(dialog, /\}>Save draft<\/button>/);
  assert.match(dialog, /sessionEnded\.current = true; clearBuilderDraft\(scope, id\)/);
  assert.match(dialog, /setExitAfterSave\(true\); setSaveVisibility\("Draft"\); openSaveDialog\(\)/);
  assert.doesNotMatch(dialog, /<ActionButton/);
  assert.match(designSystem, /\.bb-button\s*\{/);
  assert.match(designSystem, /\.bb-button--danger\s*\{ background: var\(--bb-action-discard\)/);
  assert.match(designSystem, /\.bb-button--blue\s*\{ background: var\(--bb-action-save\)/);
  assert.match(designSystem, /\.bb-button\.bb-button--danger:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
  assert.match(designSystem, /\.bb-button\.bb-button--blue:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
  assert.match(designSystem, /\.bb-button\.bb-button--danger:not\(:disabled\):active/);
  assert.match(designSystem, /\.bb-button\.bb-button--blue:not\(:disabled\):active/);
});

test("Mobile Decks tiles retain the established Character crop and featured-card framing", async () => {
  const [gallery, library] = await Promise.all([
    read("components/routes/DeckGalleryCard.module.css"),
    read("components/routes/DeckLibrary.module.css"),
  ]);
  assert.match(gallery, /\.preview\{width:100%;aspect-ratio:1\.16\/1/);
  assert.match(gallery, /\.portrait img\{position:absolute!important;width:113\.63636%!important;max-width:none!important;height:auto!important;left:-6\.81818%;top:0;transform:translateY\(-15%\);object-fit:initial!important\}/);
  const mobile = gallery.slice(gallery.indexOf("/* On mobile, keep the 1.16:1 deck preview"));
  assert.match(mobile, /@media \(max-width: 499px\)/);
  assert.match(mobile, /:global\(\[data-deck-library-card\]\) \.body \{\s*display: contents;/);
  assert.match(mobile, /:global\(\[data-deck-library-card\]\) \.previewLink \{\s*display: flex;\s*align-items: center;\s*justify-content: center;/);
  assert.match(gallery, /\.portrait,\.emptyPortrait\{[^}]*border-radius:3px/);
  assert.match(mobile, /grid-column: 1;\s*grid-row: 1;\s*align-self: stretch;/);
  assert.match(mobile, /padding: 10px 7px 10px 10px;/);
  assert.doesNotMatch(mobile, /grid-row: 1 \/ span 2/);
  assert.match(mobile, /:global\(\[data-deck-library-card\]\) \.preview \{\s*width: 100%;\s*height: auto;\s*aspect-ratio: 1\.16 \/ 1;/);
  assert.doesNotMatch(mobile, /\.portrait img\s*\{/);
  assert.doesNotMatch(mobile, /object-fit:\s*cover/);
  assert.doesNotMatch(mobile, /position:\s*absolute/);
  assert.match(library, /\.card\[data-deck-library-card\] \{[\s\S]*?grid-template-columns: minmax\(0, 35%\) minmax\(0, 1fr\)/);
  assert.match(library, /\.card\[data-deck-library-card\] \.cardFooter \{\s*grid-column: 2;/);
});

test("Deck preview widens only the Featured Card column while preserving Character dimensions", async () => {
  const [component, style, saveStyle, libraryStyle] = await Promise.all([
    read("components/routes/DeckGalleryCard.tsx"),
    read("components/routes/DeckGalleryCard.module.css"),
    read("components/routes/DeckSaveDialog.module.css"),
    read("components/routes/DeckLibrary.module.css"),
  ]);
  assert.match(component, /<div className=\{styles\.previewArtwork\}>/);
  assert.match(style, /\.preview\{width:100%;aspect-ratio:1\.16\/1;position:relative;overflow:visible\}/);
  assert.match(style, /\.previewArtwork\{position:absolute;inset:0 auto 0 0;width:calc\(100% \+ 4px\);height:100%;display:grid/);
  assert.match(style, /grid-template-columns:minmax\(0,calc\(38\.375% - 2\.69px\)\) minmax\(0,1fr\)/);
  assert.match(style, /\.featuredCard img\{[^}]*object-fit:contain!important/);
  assert.match(style, /\.portrait img\{[^}]*transform:translateY\(-15%\);object-fit:initial!important/);
  const mobile = style.slice(style.indexOf("/* On mobile, keep the 1.16:1 deck preview"));
  assert.match(mobile, /padding: 10px 7px 10px 10px;/);
  assert.match(mobile, /grid-column: 1;\s*grid-row: 1;/);
  assert.match(saveStyle, /\.preview\{width:100%;max-width:340px/);
  assert.match(libraryStyle, /grid-template-columns: minmax\(0, 35%\) minmax\(0, 1fr\)/);
  for (const width of [90, 120, 180, 340, 600]) {
    const oldCharacterWidth = (width - 3) * (.444 / (.444 + .713));
    const newCharacterWidth = (width + 4) * .38375 - 2.69;
    assert.ok(Math.abs(newCharacterWidth - oldCharacterWidth) < .05,
      "Character portrait width should not change");
    const oldFeaturedWidth = width - 3 - oldCharacterWidth;
    const newFeaturedWidth = width + 4 - 3 - newCharacterWidth;
    assert.ok(newFeaturedWidth - oldFeaturedWidth > 3.95,
      "Almost all added width should go to Featured Card");
  }
});


test("Deck Editor reuses Compendium filter styling in a single draft-and-apply modal", async () => {
  const [builder, dialog, dialogCss, compendium, filters, sorting] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilderFilterSortDialog.tsx"),
    read("components/routes/DeckBuilderFilterSortDialog.module.css"),
    read("components/routes/CompendiumFieldPicker.module.css"),
    read("lib/card-filters.ts"),
    read("lib/builder-sorting.ts"),
  ]);
  assert.match(builder, /<DeckBuilderFilterSortDialog/);
  assert.match(builder, /setFilterSurface\("gallery"\)/);
  assert.match(builder, /setFilterSurface\("deck"\)/);
  assert.doesNotMatch(builder, /<CardFilterPanel/);
  assert.doesNotMatch(builder, /panel: "sort"|panel: "filter"/);
  assert.match(dialog, /import compendium from "\.\/CompendiumFieldPicker\.module\.css"/);
  for (const cls of ["trigger", "chip", "option", "checked", "search"]) {
    assert.ok(dialog.includes("compendium." + cls), cls + " uses Compendium selector classes");
    assert.match(compendium, new RegExp("\\." + cls + "(?:\\{|\\s*\\{)"));
  }
  assert.match(dialog, /const \[draftFilters, setDraftFilters\] = useState/);
  assert.match(dialog, /const \[draftSort, setDraftSort\] = useState/);
  assert.match(dialog, /onApply\(\{ filters: draftFilters, sort: draftSort, fusionOnly: draftFusion \}\)/);
  assert.match(dialog, />Cancel<\/button>/);
  assert.match(dialog, />Show results<\/button>/);
  assert.match(dialog, /const \[openField, setOpenField\] = useState/);
  assert.match(dialog, /onKeyDown=\{onDialogKeyDown\}/);
  assert.match(dialogCss, /@media\(max-width:800px\)/);
  assert.match(dialogCss, /height:100dvh/);
  assert.match(filters, /coreEffects\(core\)\.some\(effect => filters\.keyword\.includes\(effect\.kind\)\)/);
  assert.match(sorting, /"count-desc", "Copies high–low"/);
});

test("Deck Editor's BakuCore, Fusion and Evo facets keep category-specific state", async () => {
  const [builder, dialog] = await Promise.all([
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckBuilderFilterSortDialog.tsx"),
  ]);
  assert.match(builder, /const \[galleryCoreFilters, setGalleryCoreFilters\] = useState/);
  assert.match(builder, /const \[galleryFusionOnly, setGalleryFusionOnly\] = useState/);
  assert.match(builder, /galleryCoreFilters, galleryFusionOnly, factionFilterAuto/);
  assert.match(builder, /galleryCategory === "cores"\s*\? \{ \.\.\.galleryCoreFilters, set: galleryFilters\.set, coreType: galleryFilters\.coreType \}/);
  assert.match(builder, /galleryCategory === "characters" && galleryFusionOnly && item\.kind === "character" && !item\.card\.fusionPairId/);
  assert.match(builder, /if \(next\.faction\.join\("\|"\) !== galleryFilters\.faction\.join\("\|"\)\) setFactionFilterAuto\(false\)/);
  assert.match(dialog, /category === "cores"/);
  assert.match(dialog, /field\("keyword", \{ label: "Effects"/);
  assert.match(dialog, /field\("faction", \{ label: "Conditional Factions"/);
  assert.match(dialog, /category === "characters"/);
  assert.match(dialog, /key: "fusions"/);
  assert.match(dialog, /filters\.type\.includes\("Evo"\)/);
  assert.match(dialog, /key === "type" && !fieldDraft\.includes\("Evo"\) \? \{ bPower: \[\], damage: \[\] \}/);
});


test("Builder hides cross-category Character power filters when browsing non-Evo Cards", async () => {
  const builder = await read("components/routes/DeckBuilderScreen.tsx");
  assert.match(builder, /galleryCategory === "cards" && !galleryFilters\.type\.includes\("Evo"\)/);
  assert.match(builder, /BUILDER_MAIN_DECK_FILTER_FACETS\.filter\(facet => facet !== "bPower" && facet !== "damage"\)/);
  assert.match(builder, /restrictCardFilters\(\s*effectiveGalleryFilters,\s*galleryFilterFacets,/);
});


test("BakuCore filtering matches the Compendium's printed stats, effects and conditional factions", () => {
  const conditional = CORES.find(core => Boolean(core.conditionalFactions?.length));
  assert.ok(conditional, "A conditional-faction BakuCore should exist");
  const faction = conditional.conditionalFactions![0];
  const nonFactionCore = CORES.find(core => !core.conditionalFactions?.includes(faction));
  assert.ok(nonFactionCore, "Another Core should lack this conditional faction");
  assert.equal(coreMatchesFilters(conditional, createEmptyCardFilters({ faction: [faction] })), true);
  assert.equal(coreMatchesFilters(nonFactionCore, createEmptyCardFilters({ faction: [faction] })), false);

  const withEffect = CORES.find(core => coreEffects(core).length > 0);
  assert.ok(withEffect, "A Core with a printable effect should exist");
  const kind = coreEffects(withEffect)[0].kind;
  const withoutEffect = CORES.find(core => !coreEffects(core).some(effect => effect.kind === kind));
  assert.ok(withoutEffect, "Other Cores should lack this effect");
  assert.equal(coreMatchesFilters(withEffect, createEmptyCardFilters({ keyword: [kind] })), true);
  assert.equal(coreMatchesFilters(withoutEffect, createEmptyCardFilters({ keyword: [kind] })), false);

  const differentPower = CORES.find(core => core.bonus !== withEffect.bonus);
  const differentDamage = CORES.find(core => core.damageBonus !== withEffect.damageBonus);
  assert.ok(differentPower);
  assert.ok(differentDamage);
  assert.equal(coreMatchesFilters(withEffect, createEmptyCardFilters({ bPower: [String(withEffect.bonus)] })), true);
  assert.equal(coreMatchesFilters(differentPower, createEmptyCardFilters({ bPower: [String(withEffect.bonus)] })), false);
  assert.equal(coreMatchesFilters(withEffect, createEmptyCardFilters({ damage: [String(withEffect.damageBonus)] })), true);
  assert.equal(coreMatchesFilters(differentDamage, createEmptyCardFilters({ damage: [String(withEffect.damageBonus)] })), false);
});


test("Every save and discard action in the Deck Editor uses muted palette tokens", async () => {
  const [palette, builderStyle, builder, saveDialog] = await Promise.all([
    read("app/design-system.css"),
    read("components/routes/DeckBuilder.module.css"),
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/DeckSaveDialog.tsx"),
  ]);
  assert.match(palette, /--bb-deck-accent-border: #30718d/);
  assert.match(palette, /--bb-deck-warning-border: #a94b4b/);
  assert.match(palette, /--bb-action-save: var\(--bb-deck-accent-border\)/);
  assert.match(palette, /--bb-action-discard: var\(--bb-deck-warning-border\)/);
  assert.match(palette, /\.bb-button--blue\s*\{ background: var\(--bb-action-save\); border-color: var\(--bb-action-save\)/);
  assert.match(palette, /\.bb-button--danger\s*\{ background: var\(--bb-action-discard\); border-color: var\(--bb-action-discard\)/);
  for (const state of ["hover", "pressed"]) {
    assert.match(palette, new RegExp("--bb-action-save-" + state + ": color-mix"));
    assert.match(palette, new RegExp("--bb-action-discard-" + state + ": color-mix"));
    assert.match(builderStyle, new RegExp("var\\(--bb-action-save-" + state + "\\)"));
  }
  assert.match(builderStyle, /\.saveButton\{[^}]*border:1px solid var\(--bb-action-save\);background:var\(--bb-action-save\)/);
  assert.match(builder, /className=\{styles\.saveButton\} onClick=\{openSaveDialog\}/);
  assert.match(builder, /className="bb-button bb-button--danger" onClick=\{\(\) => \{/);
  assert.match(builder, /className="bb-button bb-button--blue"\s+onClick=\{\(\) => \{ setExitAfterSave/);
  assert.match(saveDialog, /className="bb-button bb-button--blue" disabled=\{saveDisabled\} onClick=\{onSave\}/);
  assert.match(saveDialog, /visibility === "Public" \? "Publish Deck" : visibility === "Draft" \? "Save Draft" : "Save Deck"/);
  assert.match(saveDialog, /className="bb-button" onClick=\{onClose\}>Cancel<\/button>/);
});
