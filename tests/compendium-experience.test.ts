import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compendiumSearchParams,
  coreCompendiumSearchParams,
  DEFAULT_COMPENDIUM_STATE,
  DEFAULT_CORE_COMPENDIUM_STATE,
  filterAndSortCompendiumCores,
  filterAndSortCompendiumCards,
  parseCoreCompendiumState,
  parseCompendiumState,
  relatedCompendiumCards,
  selectedCompendiumCore,
} from "../lib/compendium";
import {
  cardMatchesFilters,
  createCardFilterOptionCatalogue,
  createEmptyCardFilters,
  FACTION_SYMBOLS,
  HIDDEN_KEYWORD_FILTERS,
} from "../lib/card-filters";
import type { Core, GameCard } from "../lib/game";
import { compareCardCollectorOrder, CONTROLLED_CATALOGUE } from "../lib/content/catalogue";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const card = (overrides: Partial<GameCard> & Pick<GameCard, "catalogId" | "displayName">): GameCard => ({
  id: overrides.catalogId,
  number: 1,
  name: overrides.displayName,
  faction: "Pyrus",
  factions: ["Pyrus"],
  type: "Action",
  cost: 1,
  rarity: "Common",
  effect: "",
  mechanics: [],
  bPower: null,
  damage: null,
  coreTypes: [],
  evolvesFrom: null,
  art: "/assets/cards/card-missing.svg",
  slug: overrides.catalogId,
  ...overrides,
});

const core = (overrides: Partial<Core> & Pick<Core, "id" | "number" | "name">): Core => ({
  catalogId: overrides.id,
  type: "Fist",
  bonus: 0,
  damageBonus: 1,
  art: "/assets/cores/full/1.webp",
  ...overrides,
});


test("Compendium URL state round-trips filters, density, selection, and inspector tab", () => {
  const state = parseCompendiumState("q=dragonoid&set=BB&type=Character&coreType=Magic+Shield&faction=Pyrus&cost=2&rarity=Rare&keyword=Victor&sort=name-desc&density=compact&page=3&card=bb-1&tab=rulings");
  assert.deepEqual(state, {
    q: "dragonoid",
    set: ["BB"],
    type: ["Character"],
    coreType: ["Magic Shield"],
    faction: ["Pyrus"],
    cost: ["2"],
    rarity: ["Rare"],
    keyword: ["Victor"],
    sort: "name-desc",
    density: "compact",
    page: 3,
    card: "bb-1",
    tab: "rulings",
  });
  assert.deepEqual(parseCompendiumState(compendiumSearchParams(state)), state);
  assert.deepEqual(
    parseCompendiumState("sort=unsupported&density=huge&page=-4&tab=unknown"),
    DEFAULT_COMPENDIUM_STATE,
  );
});

test("Compendium query state preserves spaces while filtering ignores edge whitespace", () => {
  const state = parseCompendiumState("q=Light%27s+Courage+");
  assert.equal(state.q, "Light's Courage ");
  assert.equal(compendiumSearchParams(state).get("q"), "Light's Courage ");
  assert.deepEqual(
    filterAndSortCompendiumCards([
      card({ catalogId: "bb-1", displayName: "Light's Courage" }),
      card({ catalogId: "bb-2", displayName: "Darkus Snare" }),
    ], state).map((candidate) => candidate.catalogId),
    ["bb-1"],
  );
});

test("card filtering and sorting use every URL-driven facet", () => {
  const cards = [
    card({ catalogId: "bb-2", displayName: "Beta", number: 2, cost: 4, rarity: "Rare", mechanics: ["Victor"] }),
    card({ catalogId: "bb-1", displayName: "Alpha", number: 1, cost: 2, rarity: "Rare", mechanics: ["Victor"] }),
    card({ catalogId: "br-1", displayName: "Gamma", number: 1, faction: "Aquos", factions: ["Aquos"], cost: 1 }),
  ];
  const state = {
    ...DEFAULT_COMPENDIUM_STATE,
    set: ["BB"],
    faction: ["Pyrus"],
    rarity: ["Rare"],
    keyword: ["Victor"],
    sort: "cost-desc" as const,
  };
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, state).map((candidate) => candidate.catalogId),
    ["bb-2", "bb-1"],
  );
});

test("multi-select card filters round-trip repeated URL params and OR choices within each facet", () => {
  const state = parseCompendiumState("faction=Pyrus&faction=Aquos&type=Action&type=Hero&keyword=Victor&keyword=Draw");
  assert.deepEqual(state.faction, ["Pyrus", "Aquos"]);
  assert.deepEqual(state.type, ["Action", "Hero"]);
  assert.deepEqual(state.keyword, ["Victor", "Draw"]);
  const params = compendiumSearchParams(state);
  assert.deepEqual(params.getAll("faction"), ["Pyrus", "Aquos"]);
  assert.deepEqual(params.getAll("type"), ["Action", "Hero"]);
  assert.deepEqual(params.getAll("keyword"), ["Victor", "Draw"]);

  const cards = [
    card({ catalogId: "bb-1", displayName: "Pyrus Victor", type: "Action", mechanics: ["Victor"] }),
    card({ catalogId: "bb-2", displayName: "Aquos Draw", faction: "Aquos", factions: ["Aquos"], type: "Hero", mechanics: ["Draw"] }),
    card({ catalogId: "bb-3", displayName: "Darkus Victor", faction: "Darkus", factions: ["Darkus"], type: "Action", mechanics: ["Victor"] }),
    card({ catalogId: "bb-4", displayName: "Pyrus Evo", type: "Evo", mechanics: ["Victor"] }),
  ];
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, state).map((candidate) => candidate.catalogId),
    ["bb-1", "bb-2"],
  );
});

test("shared card filter authority owns options, symbols, hidden keywords, and matching semantics", () => {
  const candidates = [
    card({ catalogId: "bb-1", displayName: "Pyrus Victor", faction: "Pyrus", factions: ["Pyrus"], rarity: "Rare", mechanics: ["Victor", "Damage"] }),
    card({ catalogId: "bb-2", displayName: "Aquos Draw", faction: "Aquos", factions: ["Aquos"], rarity: "Common", mechanics: ["Draw"] }),
  ];
  const options = createCardFilterOptionCatalogue(candidates);
  assert.equal(options.faction.find((option) => option.value === "Aquos")?.icon, FACTION_SYMBOLS.Aquos);
  assert.equal(options.keyword.some((option) => option.value === "Damage"), false);
  assert.equal(options.keyword.some((option) => option.value === "Victor"), true);
  assert.equal(HIDDEN_KEYWORD_FILTERS.has("Triggered"), true);

  const filters = createEmptyCardFilters({
    faction: ["Pyrus", "Aquos"],
    rarity: ["Rare"],
    keyword: ["Victor", "Draw"],
  });
  assert.equal(cardMatchesFilters(candidates[0], filters), true);
  assert.equal(cardMatchesFilters(candidates[1], filters), false);
});

test("Energize keyword matches every printed Energize effect, not Energy costs or symbols", () => {
  const catalogue = CONTROLLED_CATALOGUE.map((record) => ({ ...record, catalogId: record.id }));
  const printedEnergize = /\\benergiz(?:e|es|ed|ing)\\b/i;
  for (const candidate of catalogue) {
    assert.equal(
      candidate.mechanics.includes("Energize"),
      printedEnergize.test(candidate.effect),
      `${candidate.catalogId}: Energize classification must follow printed card text`,
    );
  }

  const filtered = filterAndSortCompendiumCards(catalogue, {
    ...DEFAULT_COMPENDIUM_STATE,
    keyword: ["Energize"],
  }).map((candidate) => candidate.catalogId).toSorted();
  const expected = catalogue
    .filter((candidate) => candidate.fusionFace !== "b" && printedEnergize.test(candidate.effect))
    .map((candidate) => candidate.catalogId).toSorted();
  assert.deepEqual(filtered, expected);

  // Real examples from the original set and subsequent expansions.
  assert.ok(filtered.includes("bb-119")); // Mulch: Energize the top card.
  assert.ok(filtered.includes("aa-42")); // Gaia Force: Energize the top card.
  assert.ok(!filtered.includes("bb-109")); // Song of Fire: +5 [Energy].
  assert.ok(!filtered.includes("bb-97")); // Implosion: destroys Energy cards.
  assert.ok(!filtered.includes("aa-74")); // Dan Kouzo: Energy production.
  assert.ok(createCardFilterOptionCatalogue(catalogue).keyword.some((option) => option.value === "Energize"));
});

test("Character filtering ignores card-only facets and supports core/stat sorting", () => {
  const cards = [
    card({ catalogId: "char-1", displayName: "Alpha", type: "Character", coreTypes: ["Fist"], bPower: 700, damage: 3, cost: 6, rarity: "Rare" }),
    card({ catalogId: "char-2", displayName: "Beta", type: "Character", coreTypes: ["Magic Shield"], bPower: 500, damage: 7, cost: 1, rarity: "Common" }),
    card({ catalogId: "char-3", displayName: "Gamma", type: "Character", coreTypes: ["Magic Shield"], bPower: 900, damage: 2, cost: 0, rarity: "Common" }),
  ];
  const state = {
    ...DEFAULT_COMPENDIUM_STATE,
    type: ["Character"],
    coreType: ["Magic Shield"],
    cost: ["6"],
    rarity: ["Rare"],
    sort: "bpower-desc" as const,
  };
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, state).map((candidate) => candidate.catalogId),
    ["char-3", "char-2"],
  );
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, { ...state, sort: "damage-desc" }).map((candidate) => candidate.catalogId),
    ["char-2", "char-3"],
  );
});


test("canonical collector comparator follows release order and numeric collector numbers", () => {
  const candidates = [
    card({ catalogId: "aa-1", displayName: "AA One", number: 1 }),
    card({ catalogId: "bb-10", displayName: "BB Ten", number: 10 }),
    card({ catalogId: "br-1", displayName: "BR One", number: 1 }),
    card({ catalogId: "bb-2", displayName: "BB Two", number: 2 }),
  ];
  assert.deepEqual(
    candidates.toSorted(compareCardCollectorOrder).map((candidate) => candidate.catalogId),
    ["bb-2", "bb-10", "br-1", "aa-1"],
  );
});

test("EX participates in set filtering and collector release order", () => {
  const cards = [
    card({ catalogId: "ex-2", displayName: "EX Two", number: 2 }),
    card({ catalogId: "aa-1", displayName: "AA One", number: 1 }),
    card({ catalogId: "bb-1", displayName: "BB One", number: 1 }),
    card({ catalogId: "br-1", displayName: "BR One", number: 1 }),
    card({ catalogId: "ex-1", displayName: "EX One", number: 1 }),
  ];
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, { ...DEFAULT_COMPENDIUM_STATE, set: ["EX"] })
      .map((candidate) => candidate.catalogId),
    ["ex-1", "ex-2"],
  );
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, DEFAULT_COMPENDIUM_STATE)
      .map((candidate) => candidate.catalogId),
    ["bb-1", "br-1", "aa-1", "ex-1", "ex-2"],
  );
});

test("related cards connect evolutions and alternate identities", () => {
  const base = card({ catalogId: "bb-1", displayName: "Dragonoid", name: "Dragonoid", type: "Character" });
  const evo = card({ catalogId: "bb-2", displayName: "Hyper Dragonoid", name: "Hyper Dragonoid", type: "Evo", evolvesFrom: "Dragonoid" });
  const unrelated = card({ catalogId: "bb-3", displayName: "Dan Kouzo", type: "Hero" });
  assert.deepEqual(relatedCompendiumCards(base, [base, evo, unrelated]).map((candidate) => candidate.catalogId), ["bb-2"]);
});

test("BakuCore compendium state filters, sorts, and selects both sets", () => {
  const state = parseCoreCompendiumState("q=fusion&coreSet=Armored+Alliance&coreType=Fist&coreSort=bonus&coreDensity=compact&corePage=2&core=aa-core-70");
  assert.deepEqual(state, {
    q: "fusion",
    set: "Armored Alliance",
    type: "Fist",
    sort: "bonus",
    density: "compact",
    page: 2,
    core: "aa-core-70",
    tab: "overview",
  });
  assert.deepEqual(parseCoreCompendiumState(coreCompendiumSearchParams(state)), state);
  assert.deepEqual(parseCoreCompendiumState("coreSort=unknown&coreDensity=huge&corePage=-1"), DEFAULT_CORE_COMPENDIUM_STATE);
  const candidates = [
    core({ id: "core-1", number: 1, name: "Fist +0 B / +1 D", set: "Battle Brawlers" }),
    core({ id: "aa-core-70", number: 70, name: "AA 70 Fist / Fusion +5 D", set: "Armored Alliance", fusionDamageBonus: 5 }),
    core({ id: "aa-core-71", number: 71, name: "AA 71 Fist / Fusion +2 D", set: "Armored Alliance", fusionDamageBonus: 2 }),
  ];
  assert.deepEqual(filterAndSortCompendiumCores(candidates, state).map((candidate) => candidate.id), ["aa-core-70", "aa-core-71"]);
  assert.equal(selectedCompendiumCore(candidates, "aa-core-70")?.number, 70);
});

test("BakuCore collector ordering groups sets and sorts each set numerically", () => {
  const candidates = [
    core({ id: "aa-core-10", name: "AA 10", number: 10, set: "Armored Alliance" }),
    core({ id: "core-11", name: "BB 11", number: 11, set: "Battle Brawlers", printings: [
      { id: "aa-printing-4", set: "Armored Alliance", number: 4, art: "/assets/cores/armored-alliance/aa-04.png" },
    ] }),
    core({ id: "aa-core-2", name: "AA 2", number: 2, set: "Armored Alliance" }),
    core({ id: "core-2", name: "BB 2", number: 2, set: "Battle Brawlers" }),
  ];

  assert.deepEqual(
    filterAndSortCompendiumCores(candidates, DEFAULT_CORE_COMPENDIUM_STATE).map((item) => item.id),
    ["core-2", "core-11", "aa-core-2", "aa-core-10"],
  );
  assert.deepEqual(
    filterAndSortCompendiumCores(candidates, { ...DEFAULT_CORE_COMPENDIUM_STATE, set: "Armored Alliance" })
      .map((item) => item.id),
    ["aa-core-2", "core-11", "aa-core-10"],
  );
});

test("Collection reuses the complete filter controls in desktop and mobile surfaces", async () => {
  const route = await read("components/routes/CollectionScreen.tsx");
  assert.match(route, /const renderCollectionFilterControls = \(\) =>/);
  assert.equal((route.match(/\{renderCollectionFilterControls\(\)\}/g) ?? []).length, 2);
  for (const label of ["Archive sort", "Collection sort", "Core type", "Standard", "Foil", "Wishlist"]) {
    assert.match(route, new RegExp(`label=["']${label}["']|label=\\{quantityLabel`));
  }
  assert.match(route, /CardFilterPanel/);
  assert.match(route, /\["type", "set", "faction", "cost", "rarity", "coreType", "keyword"\]/);
});

test("Compendium renders the complete gallery and reusable inspector contracts", async () => {
  const [route, css, inspector, inspectorCss, modalCss, image] = await Promise.all([
    Promise.all([read("components/routes/CompendiumScreen.tsx"), read("lib/catalogue-sorting.ts")]).then(parts => parts.join("\n")),
    read("components/routes/CompendiumScreen.module.css"),
    read("components/cards/CardInspector.tsx"),
    read("components/cards/CardInspector.module.css"),
    read("components/cards/InspectorModal.module.css"),
    read("components/cards/ResponsiveCardImage.tsx"),
  ]);
  for (const contract of [
    "parseCompendiumState",
    "filterAndSortCompendiumCards",
    "coreType",
    "bpower-desc",
    "damage-desc",
    "COMPENDIUM_PAGE_SIZE",
    "FilterControls",
    "CardFilterPanel",
    "FilterPicker",
    "createCardFilterOptionCatalogue",
    "activeCardFilterCount",
    "CoreFilterControls",
    "filterRail",
    "Card filters",
    "BakuCore filters",
    "Filters &amp; sort",
    "filterDivider",
    "Share results",
    "Gallery",
    "Compact",
    "CardInspector",
    "useDeferredValue",
    "startTransition",
    "setSearchQuery",
    "handleSearchChange",
    "localSearchEditRef",
    "SEARCH_URL_DEBOUNCE_MS",
    "window.setTimeout",
    "window.history.pushState",
    "BAKUCORES",
    "CORE_COMPENDIUM_PAGE_SIZE",
    "CORE_COMPENDIUM",
    "corePreviewStats",
    "coreForSet",
    "coreStatList",
    "coreSetLabel",
    "filterAndSortCompendiumCores",
    "returnFocusRef",
  ]) assert.match(route, new RegExp(contract));
  assert.match(route, /onSortChange/);
  assert.match(route, /className=\{styles\.filterRail\}/);
  assert.match(route, /core=\{selectedCore\}/);
  assert.match(route, /tab=\{coreState\.tab\}/);
  const coreTiles = route.slice(route.indexOf("visibleCores.map((core) => {"), route.indexOf("</CardGrid>", route.indexOf("visibleCores.map((core) => {")));
  assert.match(coreTiles, /<strong>\{core\.type\}<\/strong>/);
  assert.match(coreTiles, /stats\.map\(\(stat\) => <span key=\{stat\}>\{stat\}<\/span>\)/);
  assert.match(coreTiles, /coreSetLabel/);
  assert.doesNotMatch(coreTiles, /core\.name|coreAlternate|coreCollector|coreStats|cardBadges|Alternate/);
  assert.doesNotMatch(inspector, /<StatusChip[^>]*>Alternate printing<\/StatusChip>/);
  assert.doesNotMatch(route, /function CoreInspector/);
  assert.doesNotMatch(route, /Refine archive/);
  assert.doesNotMatch(route, /Refine BakuCores/);
  assert.doesNotMatch(route, /reprintOf/);
  assert.doesNotMatch(css, /\.coreEffects span/);
  assert.match(route, /value=\{searchQuery\}/);
  assert.match(route, /onChange=\{\(event\) => handleSearchChange\(event\.target\.value\)\}/);
  assert.match(route, /localSearchEditRef\.current/);
  assert.doesNotMatch(route, /onChange=\{\(event\) => navigate\(\{ q: event\.target\.value \}/);
  for (const tab of ["Overview", "Rules", "Rulings", "Related"]) assert.match(inspector, new RegExp(tab));
  assert.match(inspector, /data-ui="card-inspector"/);
  assert.match(inspector, /CoreOverview/);
  assert.match(inspector, /CoreRelated/);
  assert.match(inspector, /const isCore/);
  assert.match(inspectorCss, /relatedCoreArt/);
  assert.match(image, /<CardArt/);
  assert.match(image, /presentation="readable"/);
  assert.doesNotMatch(image, /srcSet=\{/);
  assert.match(image, /cardArtSource\(card, "thumbnail"\)/);
  assert.match(image, /cardArtSource\(card, "full"\)/);
  assert.match(css, /\.toolbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.filterRail\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.filterSheet/);
  assert.match(inspectorCss, /\.modal\s*\{[^}]*width:\s*min\(66rem/s);
  assert.doesNotMatch(inspectorCss, /\.adaptive\s*\{/);
  assert.match(inspector, /InspectorModal/);
  assert.match(modalCss, /\.backdrop\s*\{[^}]*position:\s*fixed/s);
  assert.match(modalCss, /@media \(max-width:\s*900px\)[\s\S]*\.panel\s*\{[\s\S]*width:\s*100vw/s);
  assert.match(inspector, /data-ui="card-inspector"/);
  assert.match(inspectorCss, /@media \(max-width:\s*900px\)[\s\S]*\.modal \.overview\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
  assert.match(inspectorCss, /@media \(max-width:\s*900px\)[\s\S]*\.modal \.artWell\s*\{[\s\S]*position:\s*static/s);
  assert.doesNotMatch(css, /\.coreInspector\s*\{[^}]*position:\s*(?:sticky|relative)/s);
  assert.match(inspectorCss, /height:\s*100dvh/);
});

test("Reference contents drawers share a mobile-only, touch-sized close control", async () => {
  const [drawer, styles, rules, glossary, rulings] = await Promise.all([
    read("components/routes/ReferenceContentsDrawer.tsx"),
    read("components/routes/ReferenceContentsDrawer.module.css"),
    read("components/routes/OfficialRulebook.tsx"),
    read("components/routes/GlossaryScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
  ]);
  for (const view of [rules, glossary, rulings]) {
    assert.match(view, /<ReferenceContentsDrawer className=/);
  }
  assert.match(drawer, /<div className=\{styles\.closeControl\}>\s*<button[^>]+className=\{styles\.close\}/);
  assert.match(styles, /\.tab,\.scrim,\.closeControl\{display:none\}/);
  assert.match(styles, /@media\(max-width:900px\)\{[\s\S]*nav\.panel > \.closeControl\{[^}]*display:flex;/);
  assert.match(styles, /nav\.panel > \.closeControl > button\.close\{[^}]*width:30px;[^}]*height:30px;/);
  assert.match(styles, /nav\.panel > \.closeControl\{[^}]*top:calc\(var\(--space-4\) \+ env\(safe-area-inset-top\) - 6px\)/);
  assert.doesNotMatch(styles, /nav\.panel > button\.close/);
});

test("Compendium Rulings leaves submission and heading to the global feedback menu", async () => {
  const [compendium, rulings, shell] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
    read("components/application/AppShell.jsx"),
  ]);
  assert.match(rulings, /<ReferenceContentsDrawer/);
  assert.doesNotMatch(rulings, /<h2>Rulings<\/h2>|Submit a question|onSubmit/);
  assert.doesNotMatch(compendium, /showSubmission|submitRuling|rulingCardId/);
  assert.match(shell, /Feedback &amp; Reports/);
  assert.match(shell, /<FeedbackReportsDialog/);
});
