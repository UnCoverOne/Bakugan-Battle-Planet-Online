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
  selectedCompendiumCard,
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
import { coreEffects, coreForSet, CORE_EFFECT_OPTIONS } from "../lib/core-preview";

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
  const state = parseCompendiumState("q=dragonoid&set=BB&type=Character&coreType=Magic+Shield&faction=Pyrus&cost=2&rarity=Rare&keyword=Victor&sort=name-desc&density=compact&page=3&card=bb-1&printing=bb-7&tab=rulings");
  assert.deepEqual(state, {
    q: "dragonoid",
    set: ["BB"],
    type: ["Character"],
    fusionOnly: false,
    coreType: ["Magic Shield"],
    bPower: [],
    damage: [],
    faction: ["Pyrus"],
    cost: ["2"],
    rarity: ["Rare"],
    keyword: ["Victor"],
    sort: "name-desc",
    density: "compact",
    page: 3,
    card: "bb-1",
    printing: "bb-7",
    tab: "references",
  });
  assert.deepEqual(parseCompendiumState(compendiumSearchParams(state)), state);
  assert.deepEqual(
    parseCompendiumState("sort=unsupported&density=huge&page=-4&tab=unknown"),
    DEFAULT_COMPENDIUM_STATE,
  );
});

test("Fusions filter round-trips only for Character-only URLs and stays absent by default", () => {
  const state = parseCompendiumState("type=Character&fusions=1&faction=Aquos&sort=bpower-desc&page=2");
  assert.equal(state.fusionOnly, true);
  assert.equal(compendiumSearchParams(state).get("fusions"), "1");
  assert.deepEqual(parseCompendiumState(compendiumSearchParams(state)), state);
  assert.equal(parseCompendiumState("type=Character").fusionOnly, false);
  for (const type of ["", "type=Action", "type=Character&type=Evo"]) {
    const invalid = parseCompendiumState(`${type}${type ? "&" : ""}fusions=1`);
    assert.equal(invalid.fusionOnly, false);
    assert.equal(compendiumSearchParams(invalid).has("fusions"), false);
  }
});

test("Fusions filter shows exclusively fused-side Character Cards and respects other facets", () => {
  const unfused = card({
    catalogId: "bb-201a", displayName: "Alpha", type: "Character",
    fusionPairId: "fusion-alpha", fusionFace: "a", bPower: 400, damage: 2,
  });
  const fused = card({
    catalogId: "bb-201b", displayName: "Alpha Fused", type: "Character",
    fusionPairId: "fusion-alpha", fusionFace: "b",
    faction: "Aquos", factions: ["Pyrus", "Aquos"], bPower: 1000, damage: 8,
  });
  const anotherFused = card({
    catalogId: "bb-202b", displayName: "Beta Fused", type: "Character",
    fusionPairId: "fusion-beta", fusionFace: "b", bPower: 600, damage: 5,
  });
  const ordinary = card({
    catalogId: "bb-203", displayName: "Ordinary", type: "Character",
    bPower: 1000, damage: 8,
  });
  const action = card({ catalogId: "bb-204", displayName: "Fusion Action", type: "Action" });
  const catalogue = [unfused, fused, anotherFused, ordinary, action];
  const state = parseCompendiumState("type=Character&fusions=1");
  assert.deepEqual(
    filterAndSortCompendiumCards(catalogue, state).map(candidate => candidate.catalogId),
    ["bb-201b", "bb-202b"],
  );
  assert.deepEqual(
    filterAndSortCompendiumCards(catalogue, {
      ...state, faction: ["Aquos"], bPower: ["1000"], damage: ["8"],
    }).map(candidate => candidate.catalogId),
    ["bb-201b"],
  );
  assert.deepEqual(
    filterAndSortCompendiumCards(catalogue, { ...state, fusionOnly: false })
      .map(candidate => candidate.catalogId),
    ["bb-201a", "bb-203"],
  );
  assert.equal(selectedCompendiumCard(catalogue, fused.catalogId), unfused);
  assert.equal(selectedCompendiumCard(catalogue, fused.catalogId, true), fused);
  // Invalid programmatic states must not expose fused faces in the general catalogue.
  assert.ok(!filterAndSortCompendiumCards(catalogue, { ...state, type: [], fusionOnly: true })
    .some(candidate => candidate.fusionFace === "b"));
});

test("Fused-side Character previews inherit their Bakugan rolling stats", async () => {
  const fusion = BAKUGAN.find(candidate => candidate.fusionCharacter);
  assert.ok(fusion?.fusionCharacter, "Expected an actual Fusion Bakugan with two faces");
  assert.equal(bakuganRollingValues(fusion.fusionCharacter)?.rollAccuracy, fusion.rollAccuracy);
  assert.equal(bakuganRollingValues(fusion.fusionCharacter)?.doubleCoreChance, fusion.doubleCoreChance);
  const [screen, inspector, rolling] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/cards/CardInspector.tsx"),
    read("components/routes/CardsGallery.tsx"),
  ]);
  assert.match(screen, /label="Fusions"/);
  assert.match(screen, /onFusionChange/);
  assert.match(screen, /fusionOnly: false/);
  assert.match(inspector, /inspectorFusionFace/);
  assert.match(rolling, /bakuganRollingValues\(card\)/);
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

test("BakuCore compendium state filters, sorts, and selects both sets", () => {
  const state = parseCoreCompendiumState("q=fusion&coreSet=Armored+Alliance&coreType=Fist&coreSort=bonus&coreDensity=compact&corePage=2&core=aa-core-70");
  assert.deepEqual(state, {
    q: "fusion",
    set: ["Armored Alliance"],
    type: ["Fist"],
    bonus: [],
    damage: [],
    effects: [],
    faction: [],
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

test("BakuCore effect tags cover all ten supported mechanics without ranking them", () => {
  const all = core({
    id: "effects-all", number: 90, name: "Effects",
    bonus: -100, damageBonus: 3, bakuGearCostReduction: 2,
    frostStrike: 1, shadowStrike: true,
    fusionBonus: 500, fusionDamageBonus: 4, fusionFrostStrike: 2,
    conditionalFactions: ["Pyrus", "Darkus"], conditionalBonus: 400, conditionalDamage: 3,
  });
  const effects = coreEffects(all);
  assert.deepEqual(effects.map((effect) => effect.kind), CORE_EFFECT_OPTIONS.map((option) => option.value));
  assert.ok(effects.every((effect) => effect.label.length > 0));
  assert.equal(effects.find((effect) => effect.kind === "power")?.value, "-100");
  assert.deepEqual(effects.find((effect) => effect.kind === "conditional-damage")?.factions, ["Pyrus", "Darkus"]);
  assert.deepEqual(coreEffects(core({ id: "zero", number: 91, name: "Zero", damageBonus: 0 })), []);
});

test("Core multi-select fields combine OR within a facet and AND between facets", () => {
  const candidates = [
    core({ id: "aa-core-70", number: 70, name: "Fusion Damage", set: "Armored Alliance",
      type: "Fist", fusionDamageBonus: 5, damageBonus: 0 }),
    core({ id: "aa-core-74", number: 74, name: "Fusion Power", set: "Armored Alliance",
      type: "Shield", fusionBonus: 500, bonus: 0 }),
    core({ id: "core-11", number: 11, name: "Conditional", set: "Battle Brawlers",
      type: "Fist", bonus: 100, damageBonus: 0, conditionalFactions: ["Pyrus", "Darkus"], conditionalDamage: 3 }),
    core({ id: "core-37", number: 37, name: "Magic Shield", set: "Battle Brawlers",
      type: "Magic Shield", bonus: 500 }),
  ];
  const state = parseCoreCompendiumState(
    "coreSet=Armored+Alliance&coreSet=Battle+Brawlers&coreType=Fist&coreType=Shield" +
    "&coreEffect=fusion-damage&coreEffect=conditional-damage",
  );
  assert.deepEqual(state.set, ["Armored Alliance", "Battle Brawlers"]);
  assert.deepEqual(state.type, ["Fist", "Shield"]);
  assert.deepEqual(coreCompendiumSearchParams(state).getAll("coreEffect"), ["fusion-damage", "conditional-damage"]);
  assert.deepEqual(parseCoreCompendiumState(coreCompendiumSearchParams(state)), state);
  assert.deepEqual(filterAndSortCompendiumCores(candidates, state).map((candidate) => candidate.id),
    ["core-11", "aa-core-70"]);
  assert.deepEqual(filterAndSortCompendiumCores(candidates, {
    ...state, effects: ["conditional-damage"], faction: ["Darkus"], bonus: ["100"], damage: ["0"],
  }).map((candidate) => candidate.id), ["core-11"]);
  assert.equal(filterAndSortCompendiumCores(candidates, { ...state, effects: ["fusion-power"], type: ["Fist"] }).length, 0);
});

test("Core alternate printings follow the chosen set and never duplicate playable identities", () => {
  const candidate = core({ id: "core-7", number: 7, name: "Reprinted Fist",
    set: "Battle Brawlers", printings: [
      { id: "aa-printing-24", set: "Armored Alliance", number: 24, art: "/assets/cores/armored-alliance/aa-24.png" },
    ],
  });
  assert.equal(coreForSet(candidate, []).number, 7);
  assert.equal(coreForSet(candidate, ["Armored Alliance"]).number, 24);
  assert.equal(coreForSet(candidate, ["Armored Alliance"]).art, "/assets/cores/armored-alliance/aa-24.png");
  assert.equal(coreForSet(candidate, ["Battle Brawlers", "Armored Alliance"]).number, 7);
  assert.deepEqual(filterAndSortCompendiumCores([candidate],
    { ...DEFAULT_CORE_COMPENDIUM_STATE, set: ["Armored Alliance"] }).map((core) => core.id), ["core-7"]);
});

test("Core gallery uses a single nonwrapping equal-weight effect row and no fallback overlays", async () => {
  const [gallery, css, tag, artwork, artworkCss, screen, screenCss] = await Promise.all([
    read("components/routes/CoresGallery.tsx"),
    read("components/routes/CoresGallery.module.css"),
    read("components/routes/CoreEffectTag.tsx"),
    read("components/bakucore/BakuCoreArt.tsx"),
    read("components/bakucore/BakuCoreArt.module.css"),
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumScreen.module.css"),
  ]);
  assert.match(gallery, /useLayoutEffect/);
  assert.match(gallery, /ResizeObserver/);
  assert.match(gallery, /additional effects/);
  assert.match(gallery, /data-core-meta/);
  assert.match(css, /grid-template-rows: 20px 24px/);
  assert.match(css, /white-space: nowrap/);
  assert.match(css, /aspect-ratio: 240 \/ 209/);
  assert.match(tag, /CORE_EFFECT_OPTIONS|CoreEffectTag/);
  assert.doesNotMatch(artwork, /overlayItems|effectFallback|hasProvidedScan/);
  assert.doesNotMatch(artworkCss, /\.overlay/);
  assert.match(screen, /<CoresGallery/);
  assert.doesNotMatch(screen, /corePreviewStats|<CardGrid/);
  assert.doesNotMatch(screenCss, /\.coreTile|\.coreStatList|\.cardGridCompact/);
});

test("BakuCore gallery widths, mobile columns and overflow labels follow the compact design", async () => {
  const [gallery, css, cardsCss] = await Promise.all([
    read("components/routes/CoresGallery.tsx"),
    read("components/routes/CoresGallery.module.css"),
    read("components/routes/CardsGallery.module.css"),
  ]);
  assert.match(css, /minmax\(min\(100%, 10\.5rem\), 1fr\)/);
  assert.match(css, /minmax\(min\(100%, 8rem\), 1fr\)/);
  assert.match(css, /@media \(min-width: 560px\) and \(max-width: 700px\)/);
  assert.match(css, /\.gallery:not\(\.compact\) \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(gallery, /}>\+\{hidden\.length\}<\/span>/);
  assert.doesNotMatch(gallery, /}>\+\$\{hidden\.length\}<\/span>/);
  assert.match(gallery, /getComputedStyle\(available\)\.columnGap/);
  assert.match(cardsCss, /minmax\(min\(100%, 13rem\), 1fr\)/);
  assert.match(cardsCss, /minmax\(min\(100%, 9rem\), 1fr\)/);
});

test("BakuCore effect icons preserve original artwork colours and faction glyph colours", async () => {
  const [effectTag, galleryCss, factionTag, cardsGallery] = await Promise.all([
    read("components/routes/CoreEffectTag.tsx"),
    read("components/routes/CoresGallery.module.css"),
    read("components/routes/CardFactionTag.tsx"),
    read("components/routes/CardsGallery.tsx"),
  ]);
  assert.match(effectTag, /src=\{SYMBOLS\[kind\]\}/);
  assert.match(effectTag, /<OriginalImage className=\{styles\.effectSymbol\}/);
  assert.doesNotMatch(effectTag, /maskImage|WebkitMaskImage|filter:\s*grayscale/);
  assert.doesNotMatch(galleryCss, /mask-position|mask-size|background-color:\s*currentColor|filter:\s*grayscale/);
  assert.match(galleryCss, /\.effectSymbol\s*\{[^}]*object-fit:\s*contain/);
  assert.match(effectTag, /<CardFactionGlyph faction=\{faction\} className=\{styles\.factionSymbol\} useFactionColor\s*\/>/);
  for (const color of ["#f62230", "#5b9ce9", "#17af57", "#6d6d6d", "#4fdbda", "#fbee37"]) {
    assert.ok(factionTag.includes(color), `Missing faction colour ${color}`);
  }
  assert.match(factionTag, /style=\{useFactionColor \? \{ color: symbol\.background \} : undefined\}/);
  assert.match(factionTag, /useFactionColor = false/);
  assert.match(cardsGallery, /<CardFactionTag key=\{faction\} faction=\{faction\}/);
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
    filterAndSortCompendiumCores(candidates, { ...DEFAULT_CORE_COMPENDIUM_STATE, set: ["Armored Alliance"] })
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

test("Compendium uses unified sticky toolbar, sidebar and responsive field pickers", async () => {
  const [route, toolbar, toolbarCss, sidebar, sidebarCss, picker, pickerCss, inspector] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumToolbar.tsx"),
    read("components/routes/CompendiumToolbar.module.css"),
    read("components/routes/CompendiumSidebar.tsx"),
    read("components/routes/CompendiumSidebar.module.css"),
    read("components/routes/CompendiumFieldPicker.tsx"),
    read("components/routes/CompendiumFieldPicker.module.css"),
    read("components/cards/CardInspector.tsx"),
  ]);
  assert.match(toolbar, /CompendiumNavigation/);
  assert.match(toolbarCss, /position:sticky/);
  assert.match(toolbar, /Filters/);
  assert.match(toolbar, /Contents/);
  // The button presents the target view, not the currently active view.
  assert.match(toolbar, /sliders-horizontal/);
  assert.match(toolbar, /LucideIcon name=\{density === "gallery" \? "layout-list" : "layout-grid"\}/);
  assert.match(toolbar, /density === "gallery"/);
  const icons = await read("components/design-system/LucideIcon.tsx");
  assert.match(icons, /M14 4h7/);
  assert.match(icons, /x="14" y="14" rx="1"/);
  assert.doesNotMatch(toolbar, /grid-3x3/);
  assert.match(sidebar, /className=\{styles\.header\}/);
  assert.match(sidebar, /className=\{styles\.clearRow\}/);
  assert.match(sidebarCss, /width: 44px/);
  assert.match(sidebarCss, /height: 100dvh !important/);
  assert.match(route, /setDesktopSidebarVisible\(false\)/);
  assert.match(route, /withoutSidebar/);
  for (const facet of ["coreType", "bPower", "damage", "faction", "set", "rarity", "cost", "keyword"]) {
    assert.match(route, new RegExp(facet));
  }
  assert.match(route, /characterOnly/);
  assert.match(route, /hasStats/);
  assert.match(route, /CompendiumFieldPicker/);
  assert.doesNotMatch(route, /filterSheetOpen|mobileFilterButton|CardFilterPanel|styles\.filterDivider/);
  assert.match(picker, /createPortal/);
  assert.match(picker, /className=\{styles\.chip\}/);
  assert.match(picker, /aria-checked=\{checked\}/);
  assert.match(picker, /role="tooltip"/);
  assert.match(picker, /tooltipRef/);
  assert.match(picker, /window\.innerWidth - 24/);
  assert.match(picker, /styles\.headerLine/);
  assert.match(picker, /visibleChipCount/);
  assert.match(picker, /ResizeObserver/);
  assert.match(picker, /selected\.slice\(0, visibleChipCount\)/);
  assert.match(picker, /ref=\{measureRef\}/);
  assert.match(pickerCss, /\.headerLine\{display:flex/);
  assert.match(pickerCss, /\.headerLine\.hasInfo \.name\{margin-right:36px\}/);
  assert.match(pickerCss, /\.summary\{display:flex;align-items:center;flex-wrap:nowrap;overflow:hidden/);
  assert.match(pickerCss, /\.tooltip\{position:fixed;z-index:1900/);
  assert.match(picker, /onClick=\{apply\}/);
  assert.match(pickerCss, /width:min\(460px,100%\)/);
  assert.match(pickerCss, /height:100dvh/);
  assert.match(pickerCss, /min-height:66px/);
  assert.match(pickerCss, /\.headerLine\{[^}]*min-height:26px/);
  assert.match(pickerCss, /\.info\{[^}]*width:32px;height:32px/);
  assert.match(pickerCss, /\.trigger\{min-height:81px;padding:6px 12px;gap:3px\}/);
  assert.match(pickerCss, /\.info\{width:44px;height:44px;top:6px\}/);
  assert.match(inspector, /data-ui="card-inspector"/);
  assert.match(route, /CardInspector/);
});

test("stat filters round-trip and filter only matching B Power and Damage values", () => {
  const sample = [
    card({catalogId: "char-a", displayName: "Alpha", type: "Character", bPower: 700, damage: 3}),
    card({catalogId: "char-b", displayName: "Beta", type: "Character", bPower: 900, damage: 3}),
    card({catalogId: "evo-c", displayName: "Gamma Evo", type: "Evo", bPower: 700, damage: 5}),
    card({catalogId: "action-d", displayName: "Action", type: "Action"}),
  ];
  const state = parseCompendiumState("type=Character&type=Evo&bPower=700&damage=3");
  assert.deepEqual(state.bPower, ["700"]);
  assert.deepEqual(state.damage, ["3"]);
  assert.deepEqual(parseCompendiumState(compendiumSearchParams(state)), state);
  assert.deepEqual(filterAndSortCompendiumCards(sample, state).map(c => c.catalogId), ["char-a"]);
  const options = createCardFilterOptionCatalogue(sample);
  assert.deepEqual(options.bPower.map(o => o.value), ["700", "900"]);
  assert.deepEqual(options.damage.map(o => o.value), ["3", "5"]);
  const noStat = {...state, bPower: [], damage: []};
  assert.equal(filterAndSortCompendiumCards(sample, noStat).length, 3);
});

test("Compendium Rulings leaves submission and heading to the global feedback menu", async () => {
  const [compendium, rulings, shell] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/RulingsReference.tsx"),
    read("components/application/AppShell.jsx"),
  ]);
  assert.match(rulings, /<CompendiumSidebar/);
  assert.doesNotMatch(rulings, /<h2>Rulings<\/h2>|Submit a question|onSubmit/);
  // The ruling-submission UI lives in Feedback & Reports, not Compendium.
  // Referencing its removed setter caused a ReferenceError on every tab load.
  assert.doesNotMatch(compendium, /\b(?:setShowSubmission|showSubmission|submitRuling|rulingCardId)\b/);
  assert.match(shell, /Feedback &amp; Reports/);
  assert.match(shell, /<FeedbackReportsDialog/);
});


test("Bakugan rolling probabilities remain in other galleries and the inspector", async () => {
  const [rolling, rollingStyles, collection, builder, administrator, detail, inspector] = await Promise.all([
    read("components/cards/BakuganRollingStats.tsx"),
    read("components/cards/BakuganRollingStats.module.css"),
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
  assert.doesNotMatch(inspector, /<BakuganRollingOverlay card=\{card\}/);
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


test("Compendium reference pages share compact continuous Contents navigation", async () => {
  const [navigation, navigationCss, glossary, rules, rulings, glossaryCss, rulesCss, rulingsChrome, layoutCss] = await Promise.all([
    read("components/routes/ContentsNavigation.tsx"),
    read("components/routes/ContentsNavigation.module.css"),
    read("components/routes/GlossaryScreen.tsx"),
    read("components/routes/OfficialRulebook.tsx"),
    read("components/routes/RulingsReference.tsx"),
    read("components/routes/GlossaryScreen.module.css"),
    read("components/routes/OfficialRulebook.module.css"),
    read("components/routes/ReferenceChrome.module.css"),
    read("components/routes/CompendiumScreen.module.css"),
  ]);
  for (const page of [glossary, rules, rulings]) {
    assert.match(page, /<ContentsNavigation\b/);
    assert.match(page, /label="Contents"/);
    assert.doesNotMatch(page, /<h2>Contents<\/h2>/);
  }
  assert.match(navigation, /scrollIntoView/);
  assert.match(navigation, /history\.pushState/);
  assert.match(navigation, /aria-current=/);
  assert.match(navigation, /aria-expanded=/);
  assert.match(navigationCss, /min-height:44px/);
  assert.match(navigationCss, /border-left:2px solid transparent/);
  assert.doesNotMatch(navigationCss, /checkmark|check-circle/);
  assert.match(glossary, /id: "glossary-icons", label: "Printed Icons"/);
  assert.doesNotMatch(glossary, /All terms|setCategory\(/);
  assert.doesNotMatch(rulings, /All rulings|setCategory\(/);
  assert.match(rulings, /id=\{sectionId\(name\)\}/);
  assert.match(rules, /children: chapter\.sections\.map/);
  assert.match(rules, /id: "rulebook-errata", label: "Errata"/);
  for (const css of [glossaryCss, rulesCss, rulingsChrome]) {
    assert.doesNotMatch(css, /\.contents\{position:sticky|\.rail\{position:sticky/);
  }
  assert.match(layoutCss, /\[id\^="rulings-category-"\]/);
});

test("Compendium pagination is a fixed, quiet first/previous/next/last toolbar", async () => {
  const [route, css, pager, pagerCss] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumScreen.module.css"),
    read("components/routes/CompendiumPagination.tsx"),
    read("components/routes/CompendiumPagination.module.css"),
  ]);
  assert.equal((route.match(/<CompendiumPagination /g) ?? []).length, 4);
  assert.equal((route.match(/placement="bottom"/g) ?? []).length, 2);
  assert.match(route, /\{pages > 1 && <div className=\{styles\.galleryFooter\}>/);
  assert.match(route, /\{corePages > 1 && <div className=\{styles\.galleryFooter\}>/);
  assert.match(css, /\.galleryFooter\{min-width:0;margin-top:20px\}/);
  assert.equal((route.match(/placement="bottom"/g) ?? []).length, 2);
  assert.match(pager, /placement = "top"/);
  assert.match(pager, /placement === "top" && <span className={styles.range}>/);
  assert.match(css, /\.galleryFooter\{min-width:0;margin-top:20px\}/);
  assert.equal((route.match(/<main ref=\{resultsStartRef\}/g) ?? []).length, 2);
  assert.match(route, /changeResultsPage\(next, "cards"\)/);
  assert.match(route, /changeResultsPage\(next, "cores"\)/);
  assert.match(route, /navigateCore\(\{ page: nextPage \}, \{ push: true \}\)/);
  assert.match(route, /resultsStartRef\.current\?\.scrollIntoView/);
  assert.doesNotMatch(route, /styles\.shareResults|styles\.resultsToolbar|styles\.pagination/);
  assert.match(css, /margin: var\(--space-4\) auto 0/);
  assert.match(css, /\.galleryHeader\{display:block/);
  assert.doesNotMatch(css, /\.galleryHeader \.shareResults/);
  for (const name of ["First page", "Previous page", "Next page", "Last page"]) {
    assert.match(pager, new RegExp(`aria-label="${name}"`));
  }
  assert.match(pager, /onPageChange\(1\)/);
  assert.match(pager, /onPageChange\(totalPages\)/);
  assert.match(pager, /onPageChange\(page - 1\)/);
  assert.match(pager, /onPageChange\(page \+ 1\)/);
  assert.match(pager, /aria-live="polite"/);
  assert.match(pager, /if \(totalPages <= 1\) return null/);
  assert.match(pagerCss, /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(pagerCss, /\.pageIndicator\{[^}]*min-width:76px/);
  assert.match(pagerCss, /white-space:nowrap/);
  assert.match(pagerCss, /@container \(max-width:540px\)/);
});

test("Compendium sidebar communicates visibility and animates desktop collapse", async () => {
  const [screen, layout, toolbar, toolbarCss, sidebar, sidebarCss] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumScreen.module.css"),
    read("components/routes/CompendiumToolbar.tsx"),
    read("components/routes/CompendiumToolbar.module.css"),
    read("components/routes/CompendiumSidebar.tsx"),
    read("components/routes/CompendiumSidebar.module.css"),
  ]);
  assert.match(toolbar, /const expanded = mobile \? sidebarOpen : desktopSidebarVisible/);
  assert.match(toolbar, /aria-expanded=\{expanded\}/);
  assert.match(toolbar, /aria-controls=\{COMPENDIUM_SIDEBAR_ID\}/);
  assert.match(toolbar, /expanded \? "Hide" : "Show"/);
  assert.match(toolbarCss, /\.action\[aria-expanded="true"\]/);
  assert.match(sidebar, /export const COMPENDIUM_SIDEBAR_ID = "compendium-sidebar"/);
  assert.match(sidebar, /id=\{COMPENDIUM_SIDEBAR_ID\}/);
  assert.match(sidebar, /Collapse \$\{label\} panel/);
  assert.match(sidebar, /className=\{styles\.collapseIcon\}/);
  assert.match(sidebar, /m15 18-6-6 6-6/);
  assert.match(sidebar, /className=\{styles\.closeIcon\}/);
  assert.match(sidebar, /inert=\{!desktopVisible && !open \? true : undefined\}/);
  assert.match(sidebarCss, /\.panel\[data-desktop-visible="false"\] \{/);
  assert.match(sidebarCss, /transform: translateX\(-100%\)/);
  assert.doesNotMatch(sidebarCss, /data-desktop-visible="false"\] \{ display: none/);
  assert.match(sidebarCss, /\.closeIcon \{ display: none; \}/);
  assert.match(sidebarCss, /\.closeIcon \{ display: block; \}/);
  assert.match(layout, /grid-template-columns: 0px minmax\(0, 1fr\)/);
  assert.match(layout, /column-gap: 0px/);
  assert.match(layout, /transition: grid-template-columns 240ms/);
  assert.match(layout, /prefers-reduced-motion: reduce/);
  assert.match(sidebarCss, /prefers-reduced-motion: reduce/);
  assert.match(screen, /sidebarTrigger\.current\?\.focus\(\)/);
});

test("Cards has frameless Detailed and Compact galleries with artwork-only compact tiles", async () => {
  const [route, gallery, galleryCss, toolbar] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CardsGallery.tsx"),
    read("components/routes/CardsGallery.module.css"),
    read("components/routes/CompendiumToolbar.tsx"),
  ]);
  assert.match(route, /<CardsGallery cards=\{visible\} density=\{state\.density\}/);
  assert.match(route, /onSelect=\{\(card, trigger\) => selectCard\(card, trigger\)\}/);
  assert.match(toolbar, /"Switch to detailed view"/);
  assert.match(route, /"Detailed view enabled"/);
  assert.match(gallery, /data-cards-view=\{compact \? "compact" : "detailed"\}/);
  assert.match(gallery, /!compact && <span className=\{styles\.details\} data-card-details>/);
  assert.match(gallery, /<strong className=\{styles\.name\} data-card-name title=\{card\.displayName\}>/);
  assert.match(gallery, /<span className=\{styles\.metadata\} data-card-meta>/);
  assert.match(gallery, /FACTION_SYMBOLS\[faction\]/);
  assert.match(gallery, /CARD_SET_INFO\[set\]\.name/);
  assert.match(gallery, /title=\{card\.type\}/);
  assert.match(gallery, /onClick=\{event => onSelect\(card, event\.currentTarget\)\}/);
  assert.match(gallery, /aria-pressed=\{selectedId === card\.catalogId\}/);
  assert.match(galleryCss, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 13rem\), 1fr\)\)/);
  assert.match(galleryCss, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 9rem\), 1fr\)\)/);
  assert.match(galleryCss, /\.gallery \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(galleryCss, /\.gallery\.compact \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(galleryCss, /\.name \{[^}]*white-space: nowrap/);
  assert.match(galleryCss, /\.metadata \{[^}]*flex-wrap: nowrap/);
  assert.match(galleryCss, /\.artwork::after \{[^}]*linear-gradient\(135deg/);
  assert.match(galleryCss, /\.tile:hover \.artwork::after/);
  assert.match(galleryCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(gallery, /BakuganRollingOverlay|FusionSymbol|StatusChip|card\.cost|card\.rarity/);
  assert.doesNotMatch(route, /styles\.cardArtFrame|styles\.fusionBadge|styles\.cardBadges/);
});


test("Cards, BakuCores, and Builder Team share the tuned white artwork hover", async () => {
  const [cardsCss, coresCss, builder] = await Promise.all([
    read("components/routes/CardsGallery.module.css"),
    read("components/routes/CoresGallery.module.css"),
    read("components/routes/DeckBuilderScreen.tsx"),
  ]);
  const expected = "linear-gradient(135deg, rgba(255,255,255,.20), rgba(218,237,255,.10) 43%, rgba(255,255,255,0) 100%)";
  for (const css of [cardsCss, coresCss]) {
    assert.ok(css.includes(expected));
    assert.match(css, /transition: opacity 160ms ease/);
    assert.match(css, /\.tile:hover \.artwork::after/);
  }
  assert.match(builder, /className=\{cardTileStyles\.artwork\}/);
  assert.match(builder, /className=\{coreTileStyles\.artwork\}/);
});
