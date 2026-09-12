import { CARD_SET_CODES, cardSetCode } from "./content/catalogue";
import type { Core, GameCard } from "./game";

export const COMPENDIUM_PAGE_SIZE = 24;

export const COMPENDIUM_SORTS = [
  "name-asc",
  "name-desc",
  "cost-asc",
  "cost-desc",
  "bpower-desc",
  "damage-desc",
  "collector",
] as const;

export const COMPENDIUM_DENSITIES = ["gallery", "compact"] as const;
export const CARD_INSPECTOR_TABS = ["overview", "rules", "rulings", "related"] as const;

export type CompendiumSort = (typeof COMPENDIUM_SORTS)[number];
export type CompendiumDensity = (typeof COMPENDIUM_DENSITIES)[number];
export type CardInspectorTab = (typeof CARD_INSPECTOR_TABS)[number];

export type CompendiumState = {
  q: string;
  set: string[];
  type: string[];
  coreType: string[];
  faction: string[];
  cost: string[];
  rarity: string[];
  keyword: string[];
  sort: CompendiumSort;
  density: CompendiumDensity;
  page: number;
  card: string;
  tab: CardInspectorTab;
};

export const DEFAULT_COMPENDIUM_STATE: CompendiumState = Object.freeze({
  q: "",
  set: [],
  type: [],
  coreType: [],
  faction: [],
  cost: [],
  rarity: [],
  keyword: [],
  sort: "collector",
  density: "gallery",
  page: 1,
  card: "",
  tab: "overview",
});

const oneOf = <T extends readonly string[]>(value: string | null, values: T, fallback: T[number]) =>
  value && (values as readonly string[]).includes(value) ? value as T[number] : fallback;

const choices = (params: URLSearchParams, key: string) => (
  [...new Set(params.getAll(key).map((value) => value.trim()).filter((value) => value && value !== "All"))]
);
const choice = (value: string | null) => value?.trim() || "All";
const setCodeFor = (card: Pick<GameCard, "catalogId">) => cardSetCode(card);
const SET_ORDER = new Map(CARD_SET_CODES.map((code, index) => [code, index]));

export function parseCompendiumState(input: URLSearchParams | string): CompendiumState {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    q: params.get("q") ?? "",
    set: choices(params, "set"),
    type: choices(params, "type"),
    coreType: choices(params, "coreType"),
    faction: choices(params, "faction"),
    cost: choices(params, "cost"),
    rarity: choices(params, "rarity"),
    keyword: choices(params, "keyword"),
    sort: oneOf(params.get("sort"), COMPENDIUM_SORTS, DEFAULT_COMPENDIUM_STATE.sort),
    density: oneOf(params.get("density"), COMPENDIUM_DENSITIES, DEFAULT_COMPENDIUM_STATE.density),
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    card: params.get("card")?.trim() ?? "",
    tab: oneOf(params.get("tab"), CARD_INSPECTOR_TABS, DEFAULT_COMPENDIUM_STATE.tab),
  };
}


export function compendiumSearchParams(state: CompendiumState) {
  const params = new URLSearchParams();
  const setIfChanged = (key: string, value: string, fallback: string) => {
    if (value && value !== fallback) params.set(key, value);
  };
  const appendChoices = (key: string, values: readonly string[]) => {
    for (const value of values) if (value) params.append(key, value);
  };
  setIfChanged("q", state.q, DEFAULT_COMPENDIUM_STATE.q);
  appendChoices("set", state.set);
  appendChoices("type", state.type);
  appendChoices("coreType", state.coreType);
  appendChoices("faction", state.faction);
  appendChoices("cost", state.cost);
  appendChoices("rarity", state.rarity);
  appendChoices("keyword", state.keyword);
  setIfChanged("sort", state.sort, DEFAULT_COMPENDIUM_STATE.sort);
  setIfChanged("density", state.density, DEFAULT_COMPENDIUM_STATE.density);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.card) {
    params.set("card", state.card);
    setIfChanged("tab", state.tab, DEFAULT_COMPENDIUM_STATE.tab);
  }
  return params;
}

const cardSearchTextCache = new WeakMap<GameCard, string>();

const searchableText = (card: GameCard) => {
  const cached = cardSearchTextCache.get(card);
  if (cached !== undefined) return cached;

  const value = [
    card.displayName,
    card.name,
    card.effect,
    card.catalogId,
    card.type,
    card.rarity,
    card.factions.join(" "),
    card.mechanics.join(" "),
    card.coreTypes.join(" "),
    card.evolvesFrom ?? "",
    setCodeFor(card),
  ].join(" ").toLowerCase();
  cardSearchTextCache.set(card, value);
  return value;
};

const costRank = (cost: GameCard["cost"]) => cost === "X" ? Number.POSITIVE_INFINITY : cost;
const statRank = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;

export function filterAndSortCompendiumCards(
  cards: readonly GameCard[],
  state: CompendiumState,
) {
  const query = state.q.trim().toLowerCase();
  const explicitlyIncludesCharacter = state.type.includes("Character");
  const explicitlyIncludesNonCharacter = state.type.some((type) => type !== "Character");
  const mixesCharacterAndNonCharacter = explicitlyIncludesCharacter && explicitlyIncludesNonCharacter;
  return cards.filter((card) => {
    const isCharacter = card.type === "Character";
    const coreTypeMatches = state.coreType.length === 0
      || (isCharacter
        ? card.coreTypes.some((coreType) => state.coreType.includes(coreType))
        : mixesCharacterAndNonCharacter);
    const costMatches = state.cost.length === 0
      || (isCharacter
        ? explicitlyIncludesCharacter
        : state.cost.includes(String(card.cost)));
    const rarityMatches = state.rarity.length === 0
      || (isCharacter
        ? explicitlyIncludesCharacter
        : state.rarity.includes(card.rarity));

    return (
      // The unfused face is the single Compendium representative. The reverse
      // face remains available to the shared inspector and gameplay systems.
      card.fusionFace !== "b"
      && (state.set.length === 0 || state.set.includes(setCodeFor(card)))
      && (state.type.length === 0 || state.type.includes(card.type))
      && coreTypeMatches
      && (state.faction.length === 0 || card.factions.some((faction) => state.faction.includes(faction)))
      && costMatches
      && rarityMatches
      && (state.keyword.length === 0 || card.mechanics.some((mechanic) => state.keyword.includes(mechanic)))
      && (!query || searchableText(card).includes(query))
    );
  }).toSorted((left, right) => {
    if (state.sort === "name-asc") return left.displayName.localeCompare(right.displayName);
    if (state.sort === "name-desc") return right.displayName.localeCompare(left.displayName);
    if (state.sort === "cost-asc") return costRank(left.cost) - costRank(right.cost) || left.displayName.localeCompare(right.displayName);
    if (state.sort === "cost-desc") return costRank(right.cost) - costRank(left.cost) || left.displayName.localeCompare(right.displayName);
    if (state.sort === "bpower-desc") return statRank(right.bPower) - statRank(left.bPower) || left.displayName.localeCompare(right.displayName);
    if (state.sort === "damage-desc") return statRank(right.damage) - statRank(left.damage) || left.displayName.localeCompare(right.displayName);
    return (SET_ORDER.get(setCodeFor(left)) ?? Number.MAX_SAFE_INTEGER)
      - (SET_ORDER.get(setCodeFor(right)) ?? Number.MAX_SAFE_INTEGER)
      || left.number - right.number
      || left.catalogId.localeCompare(right.catalogId);
  });
}

export function selectedCompendiumCard(cards: readonly GameCard[], identity: string) {
  if (!identity) return null;
  const selected = cards.find((card) => card.catalogId === identity || card.slug === identity) ?? null;
  if (!selected?.fusionPairId || selected.fusionFace !== "b") return selected;
  return cards.find((card) => card.fusionPairId === selected.fusionPairId && card.fusionFace === "a") ?? selected;
}

export function relatedCompendiumCards(card: GameCard, cards: readonly GameCard[]) {
  const names = new Set([card.name, card.displayName, card.evolvesFrom].filter(Boolean).map((value) => value!.toLowerCase()));
  return cards.filter((candidate) => {
    if (candidate.catalogId === card.catalogId) return false;
    if (candidate.fusionPairId && candidate.fusionPairId === card.fusionPairId) return false;
    const candidateNames = [candidate.name, candidate.displayName, candidate.evolvesFrom]
      .filter(Boolean)
      .map((value) => value!.toLowerCase());
    return candidateNames.some((value) => names.has(value))
      || Boolean(card.evolvesFrom && candidate.displayName.toLowerCase().includes(card.evolvesFrom.toLowerCase()))
      || Boolean(candidate.evolvesFrom && card.displayName.toLowerCase().includes(candidate.evolvesFrom.toLowerCase()));
  }).slice(0, 12);
}

export const CORE_COMPENDIUM_PAGE_SIZE = 24;
export const CORE_COMPENDIUM_SORTS = ["collector", "type", "bonus", "damage"] as const;
export const CORE_COMPENDIUM_DENSITIES = ["gallery", "compact"] as const;

export type CoreCompendiumSort = (typeof CORE_COMPENDIUM_SORTS)[number];
export type CoreCompendiumDensity = (typeof CORE_COMPENDIUM_DENSITIES)[number];
export type CoreCompendiumState = {
  q: string;
  set: string;
  type: string;
  sort: CoreCompendiumSort;
  density: CoreCompendiumDensity;
  page: number;
  core: string;
  tab: CardInspectorTab;
};

export const DEFAULT_CORE_COMPENDIUM_STATE: CoreCompendiumState = Object.freeze({
  q: "",
  set: "All",
  type: "All",
  sort: "collector",
  density: "gallery",
  page: 1,
  core: "",
  tab: "overview",
});

export function parseCoreCompendiumState(input: URLSearchParams | string): CoreCompendiumState {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const requestedPage = Number.parseInt(params.get("corePage") ?? "1", 10);
  return {
    q: params.get("q") ?? "",
    set: choice(params.get("coreSet")),
    type: choice(params.get("coreType")),
    sort: oneOf(params.get("coreSort"), CORE_COMPENDIUM_SORTS, DEFAULT_CORE_COMPENDIUM_STATE.sort),
    density: oneOf(params.get("coreDensity"), CORE_COMPENDIUM_DENSITIES, DEFAULT_CORE_COMPENDIUM_STATE.density),
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    core: params.get("core")?.trim() ?? "",
    tab: oneOf(params.get("tab"), CARD_INSPECTOR_TABS, DEFAULT_CORE_COMPENDIUM_STATE.tab),
  };
}

export function coreCompendiumSearchParams(state: CoreCompendiumState) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.set !== DEFAULT_CORE_COMPENDIUM_STATE.set) params.set("coreSet", state.set);
  if (state.type !== DEFAULT_CORE_COMPENDIUM_STATE.type) params.set("coreType", state.type);
  if (state.sort !== DEFAULT_CORE_COMPENDIUM_STATE.sort) params.set("coreSort", state.sort);
  if (state.density !== DEFAULT_CORE_COMPENDIUM_STATE.density) params.set("coreDensity", state.density);
  if (state.page > 1) params.set("corePage", String(state.page));
  if (state.core) {
    params.set("core", state.core);
    if (state.tab !== DEFAULT_CORE_COMPENDIUM_STATE.tab) params.set("tab", state.tab);
  }
  return params;
}

const coreSearchTextCache = new WeakMap<Core, string>();

const coreSearchableText = (core: Core) => {
  const cached = coreSearchTextCache.get(core);
  if (cached !== undefined) return cached;

  const value = [
    core.name,
    core.catalogId ?? core.id,
    core.set ?? "Battle Brawlers",
    core.type,
    core.number,
    core.bonus,
    core.damageBonus,
    core.frostStrike ? "FrostStrike" : "",
    core.shadowStrike ? "ShadowStrike" : "",
    core.bakuGearCostReduction ? "Baku-Gear" : "",
    core.fusionBonus ? "Fusion" : "",
    core.fusionDamageBonus ? "Fusion" : "",
    ...(core.printings ?? []).flatMap((printing) => [
      printing.set,
      printing.number,
      "alternate printing",
      "reprint",
    ]),
  ].join(" ").toLowerCase();
  coreSearchTextCache.set(core, value);
  return value;
};

const coreMatchesSet = (core: Core, set: string) =>
  set === "All"
  || (core.set ?? "Battle Brawlers") === set
  || core.printings?.some((printing) => printing.set === set) === true;

const coreNumberForSet = (core: Core, set: string) =>
  core.printings?.find((printing) => printing.set === set)?.number ?? core.number;

const coreSetRank = (core: Core, set: string) =>
  (core.printings?.some((printing) => printing.set === set) || (core.set ?? "Battle Brawlers") === set) ? 0 : 1;

export function filterAndSortCompendiumCores(cores: readonly Core[], state: CoreCompendiumState) {
  const query = state.q.trim().toLowerCase();
  return cores.filter((core) => (
    coreMatchesSet(core, state.set)
    && (state.type === "All" || core.type === state.type)
    && (!query || coreSearchableText(core).includes(query))
  )).toSorted((left, right) => {
    if (state.sort === "type") return left.type.localeCompare(right.type) || coreNumberForSet(left, state.set) - coreNumberForSet(right, state.set);
    if (state.sort === "bonus") return right.bonus - left.bonus || left.damageBonus - right.damageBonus || coreNumberForSet(left, state.set) - coreNumberForSet(right, state.set);
    if (state.sort === "damage") return right.damageBonus - left.damageBonus || left.bonus - right.bonus || coreNumberForSet(left, state.set) - coreNumberForSet(right, state.set);
    return coreSetRank(left, state.set) - coreSetRank(right, state.set)
      || coreNumberForSet(left, state.set) - coreNumberForSet(right, state.set)
      || left.id.localeCompare(right.id);
  });
}

export function selectedCompendiumCore(cores: readonly Core[], identity: string) {
  if (!identity) return null;
  return cores.find((core) => core.id === identity || core.catalogId === identity) ?? null;
}
