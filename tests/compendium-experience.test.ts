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
import type { Core, GameCard } from "../lib/game";

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
  const state = parseCompendiumState("q=dragonoid&set=BB&type=Character&faction=Pyrus&cost=2&rarity=Rare&keyword=Victor&sort=name-desc&density=compact&page=3&card=bb-1&tab=rulings");
  assert.deepEqual(state, {
    q: "dragonoid",
    set: "BB",
    type: "Character",
    faction: "Pyrus",
    cost: "2",
    rarity: "Rare",
    keyword: "Victor",
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
    set: "BB",
    faction: "Pyrus",
    rarity: "Rare",
    keyword: "Victor",
    sort: "cost-desc" as const,
  };
  assert.deepEqual(
    filterAndSortCompendiumCards(cards, state).map((candidate) => candidate.catalogId),
    ["bb-2", "bb-1"],
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
    filterAndSortCompendiumCards(cards, { ...DEFAULT_COMPENDIUM_STATE, set: "EX" })
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

test("Compendium renders the complete gallery and reusable inspector contracts", async () => {
  const [route, css, inspector, inspectorCss, modalCss, image] = await Promise.all([
    read("components/routes/CompendiumScreen.tsx"),
    read("components/routes/CompendiumScreen.module.css"),
    read("components/cards/CardInspector.tsx"),
    read("components/cards/CardInspector.module.css"),
    read("components/cards/InspectorModal.module.css"),
    read("components/cards/ResponsiveCardImage.tsx"),
  ]);
  for (const contract of [
    "parseCompendiumState",
    "filterAndSortCompendiumCards",
    "COMPENDIUM_PAGE_SIZE",
    "FilterControls",
    "Share results",
    "Gallery",
    "Compact",
    "CardInspector",
    "useDeferredValue",
    "setSearchQuery",
    "window.setTimeout",
    "scroll: false",
    "BAKUCORES",
    "CORE_COMPENDIUM_PAGE_SIZE",
    "CORE_COMPENDIUM",
    "coreBaseStats",
    "coreSpecialEffects",
    "corePrintings",
    "Alternate printings",
    "BakuCore effects",
    "filterAndSortCompendiumCores",
    "returnFocusRef",
  ]) assert.match(route, new RegExp(contract));
  assert.match(route, /coreCollector/);
  assert.match(route, /coreStats/);
  assert.match(route, /coreAlternate/);
  assert.match(route, /core=\{selectedCore\}/);
  assert.match(route, /tab=\{coreState\.tab\}/);
  assert.doesNotMatch(route, /function CoreInspector/);
  assert.doesNotMatch(route, /reprintOf/);
  assert.doesNotMatch(css, /\.coreEffects span/);
  assert.match(route, /value=\{searchQuery\}/);
  assert.match(route, /onChange=\{\(event\) => setSearchQuery\(event\.target\.value\)\}/);
  assert.doesNotMatch(route, /onChange=\{\(event\) => navigate\(\{ q: event\.target\.value \}/);
  for (const tab of ["Overview", "Rules", "Rulings", "Related"]) assert.match(inspector, new RegExp(tab));
  assert.match(inspector, /data-ui="card-inspector"/);
  assert.match(inspector, /CoreOverview/);
  assert.match(inspector, /CoreRelated/);
  assert.match(inspector, /const isCore/);
  assert.match(inspectorCss, /relatedCoreArt/);
  assert.match(image, /<OriginalImage/);
  assert.doesNotMatch(image, /srcSet=\{/);
  assert.doesNotMatch(image, /cardArtSource\(card, "thumbnail"\)/);
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
  assert.match(route, /InspectorModal/);
  assert.doesNotMatch(css, /\.coreInspector\s*\{[^}]*position:\s*(?:sticky|relative)/s);
  assert.match(inspectorCss, /height:\s*100dvh/);
});
