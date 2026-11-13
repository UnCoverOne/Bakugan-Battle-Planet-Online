import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compendiumSearchParams,
  compareCompendiumCards,
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
  CARD_TYPE_OPTIONS,
  createCardFilterOptionCatalogue,
  createEmptyCardFilters,
  FACTION_SYMBOLS,
  HIDDEN_KEYWORD_FILTERS,
} from "../lib/card-filters";
import type { Core, GameCard } from "../lib/game";
import { compareCardCollectorOrder, CONTROLLED_CATALOGUE } from "../lib/content/catalogue";
import { BAKUGAN } from "../lib/data";
import { CHARACTER_SORTS, NON_CHARACTER_SORTS } from "../lib/catalogue-sorting";
import { bakuganRollingValues } from "../lib/bakugan-rolling";

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
  const printedEnergize = /\benergiz(?:e|es|ed|ing)\b/i;
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
    bonusType: "All",
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
  assert.match(route, /facets=\{\["type"\]\}/);
  assert.match(route, /facets=\{secondaryCardFacets\}/);
  assert.match(route, /const secondaryCardFacets: CardFilterFacet\[\] = \["set", "faction"/);
  assert.match(route, /!isCharacterOnly \? \["cost", "rarity"\]/);
  assert.match(route, /includesCharacter \? \["coreType"\]/);
  assert.match(route, /nextIsCharacterOnly \? \{ cost: null, rarity: null \}/);
});

test("Compendium redesign uses five sections, fixed search and 48-item dual pagination", async () => {
  const [route, css, inspector, rulebook, glossary, rulings] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumScreen.module.css"),
    read("components/cards/CardInspector.tsx"),
    read("components/routes/OfficialRulebook.tsx"),
    read("components/routes/GlossaryScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
  ]);
  assert.equal((route.match(/const NAV_ITEMS:/g) || []).length, 1);
  for (const section of ["Cards","BakuCores","Glossary","Rules","Rulings"]) assert.match(route, new RegExp("label:\\""+section+"\\""));
  assert.doesNotMatch(route, /<RouteHero/);
  assert.match(route, /placeholder=\{section === "cards"/);
  assert.match(route, /sectionUrls\.current/);
  assert.match(css, /\.sectionNav/);
  assert.match(css, /\.cardTile:hover \.cardArtFrame/);
  assert.match(css, /\.resultsToolbar\{position:sticky/);
  assert.equal((route.match(/aria-label="Card result pages"/g) || []).length,2);
  assert.equal((route.match(/aria-label="BakuCore result pages"/g) || []).length,2);
  assert.match(route,/pendingCardFilters/);
  assert.match(route,/pendingCoreFilters/);
  assert.match(route,/bonusType/);
  assert.match(inspector,/const visibleTabs: CardInspectorTab\[\] = \["overview", "collection", "references"\]/);
  assert.match(inspector,/activeCardPrintingId/);
  assert.match(inspector,/onPrevious/);
  assert.match(rulebook,/handleCrossRef/);
  assert.match(rulebook,/returnContext/);
  assert.match(glossary,/setCategory\("Printed Icons"\)/);
  assert.match(glossary,/item\.definition/);
  assert.match(rulings,/Original Q&amp;A/);
  assert.match(rulings,/expanded/);
});

test("Reference navigation remains full-screen on mobile with accessible close control", async () => {
  const [drawer, styles, rules, glossary, rulings] = await Promise.all([
    read("components/routes/ReferenceContentsDrawer.tsx"),
    read("components/routes/ReferenceContentsDrawer.module.css"),
    read("components/routes/OfficialRulebook.tsx"),
    read("components/routes/GlossaryScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
  ]);
  for (const source of [rules,glossary,rulings]) assert.match(source,/<ReferenceContentsDrawer/);
  assert.match(drawer,/aria-label="Close contents"/);
  assert.match(styles,/width:100vw/);
  assert.match(styles,/width:44px;height:44px/);
});

test("Compendium Rulings leaves submission and heading to the global feedback menu", async () => {
  const [compendium, rulings, shell] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
    read("components/application/AppShell.jsx"),
  ]);
  assert.match(rulings, /<ReferenceContentsDrawer/);
  assert.doesNotMatch(rulings, /<h2>Rulings<\/h2>|Submit a question|onSubmit/);
  // The ruling-submission UI lives in Feedback & Reports, not Compendium.
  // Referencing its removed setter caused a ReferenceError on every tab load.
  assert.doesNotMatch(compendium, /\b(?:setShowSubmission|showSubmission|submitRuling|rulingCardId)\b/);
  assert.match(shell, /Feedback &amp; Reports/);
  assert.match(shell, /<FeedbackReportsDialog/);
});


test("Bakugan rolling probabilities remain in gameplay and inspector statistics", async () => {
  const [rolling, rollingStyles, compendium, collection, builder, administrator, detail, inspector] = await Promise.all([
    read("components/cards/BakuganRollingStats.tsx"),
    read("components/cards/BakuganRollingStats.module.css"),
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CollectionScreen.tsx"),
    read("components/routes/DeckBuilderScreen.tsx"),
    read("components/routes/AdministratorCardManagement.tsx"),
    read("components/routes/DeckDetailPresentation.tsx"),
    read("components/cards/CardInspector.tsx"),
  ]);
  assert.match(rolling, /bakuganRollingValues/);
  assert.match(rolling, /export function BakuganRollingOverlay/);
  assert.match(rolling, /rollAccuracy/);
  assert.match(rolling, /doubleCoreChance/);
  assert.match(rollingStyles, /\/assets\/symbols\/roll\.svg/);
  assert.match(rollingStyles, /\/assets\/symbols\/double-core\.svg/);
  assert.match(rollingStyles, /display: flex/);
  assert.match(rollingStyles, /\.plain\s*\{/);
  for (const gallery of [collection, builder, administrator, detail]) {
    assert.match(gallery, /<BakuganRollingOverlay card=/);
  }
  assert.match(inspector, /<dt>Roll Accuracy<\/dt>/);
  assert.match(inspector, /<dt>Double Core Chance<\/dt>/);
  assert.doesNotMatch(compendium, /<BakuganRollingOverlay card=\{card\}/);
  assert.match(inspector, /kind="rollAccuracy" value=\{rolling\.rollAccuracy\} plain/);
  assert.match(inspector, /kind="doubleCoreChance" value=\{rolling\.doubleCoreChance\} plain/);
  assert.match(administrator, /<BakuganRollingStat kind="rollAccuracy"/);
  assert.match(administrator, /<BakuganRollingStat kind="doubleCoreChance"/);
});

test("Card Type filter options are alphabetically ordered", () => {
  const labels = CARD_TYPE_OPTIONS.map((option) => option.label);
  assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right)));
});

test("Character-only sorting uses the live Bakugan rolling values", () => {
  const characters = BAKUGAN.filter((item) => item.character.fusionFace !== "b").slice(0, 2);
  assert.equal(characters.length, 2);
  const [first, second] = characters;
  const overrides = new Map<string, { rollAccuracy: number; doubleCoreChance: number }>([
    [first.character.catalogId, { rollAccuracy: 95, doubleCoreChance: 1 }],
    [second.character.catalogId, { rollAccuracy: 40, doubleCoreChance: 70 }],
  ]);
  const cards = characters.map((item) => item.character);

  assert.equal(bakuganRollingValues(first.character)?.rollAccuracy, first.rollAccuracy);
  assert.ok(CHARACTER_SORTS.has("roll-accuracy-desc"));
  assert.ok(CHARACTER_SORTS.has("double-core-chance-desc"));
  assert.ok(!NON_CHARACTER_SORTS.has("roll-accuracy-desc"));
  assert.equal(parseCompendiumState("type=Character&sort=roll-accuracy-desc").sort, "roll-accuracy-desc");
  assert.equal(parseCompendiumState("type=Character&sort=double-core-chance-desc").sort, "double-core-chance-desc");

  const accuracyState = parseCompendiumState("type=Character&sort=roll-accuracy-desc");
  const doubleCoreState = parseCompendiumState("type=Character&sort=double-core-chance-desc");
  assert.equal(filterAndSortCompendiumCards(cards, accuracyState, { rollingByCardId: overrides })[0]?.catalogId, first.character.catalogId);
  assert.equal(filterAndSortCompendiumCards(cards, doubleCoreState, { rollingByCardId: overrides })[0]?.catalogId, second.character.catalogId);
  assert.ok(compareCompendiumCards(first.character, second.character, "roll-accuracy-desc", overrides) < 0);
  assert.ok(compareCompendiumCards(first.character, second.character, "double-core-chance-desc", overrides) > 0);
});
