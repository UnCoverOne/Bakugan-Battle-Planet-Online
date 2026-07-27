import type { GameCard } from "./game";

export const COMPENDIUM_PAGE_SIZE = 24;

export const COMPENDIUM_SORTS = [
  "name-asc",
  "name-desc",
  "cost-asc",
  "cost-desc",
  "collector",
] as const;

export const COMPENDIUM_DENSITIES = ["gallery", "compact"] as const;
export const CARD_INSPECTOR_TABS = ["overview", "rules", "rulings", "related"] as const;

export type CompendiumSort = (typeof COMPENDIUM_SORTS)[number];
export type CompendiumDensity = (typeof COMPENDIUM_DENSITIES)[number];
export type CardInspectorTab = (typeof CARD_INSPECTOR_TABS)[number];

export type CompendiumState = {
  q: string;
  set: string;
  type: string;
  faction: string;
  cost: string;
  rarity: string;
  keyword: string;
  sort: CompendiumSort;
  density: CompendiumDensity;
  page: number;
  card: string;
  tab: CardInspectorTab;
};

export const DEFAULT_COMPENDIUM_STATE: CompendiumState = Object.freeze({
  q: "",
  set: "All",
  type: "All",
  faction: "All",
  cost: "All",
  rarity: "All",
  keyword: "All",
  sort: "collector",
  density: "gallery",
  page: 1,
  card: "",
  tab: "overview",
});

const oneOf = <T extends readonly string[]>(value: string | null, values: T, fallback: T[number]) =>
  value && (values as readonly string[]).includes(value) ? value as T[number] : fallback;

const choice = (value: string | null) => value?.trim() || "All";
const setCodeFor = (card: Pick<GameCard, "catalogId">) =>
  card.catalogId.startsWith("br-") ? "BR" : card.catalogId.startsWith("aa-") ? "AA" : "BB";

export function parseCompendiumState(input: URLSearchParams | string): CompendiumState {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    q: params.get("q")?.trim() ?? "",
    set: choice(params.get("set")),
    type: choice(params.get("type")),
    faction: choice(params.get("faction")),
    cost: choice(params.get("cost")),
    rarity: choice(params.get("rarity")),
    keyword: choice(params.get("keyword")),
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
  setIfChanged("q", state.q, DEFAULT_COMPENDIUM_STATE.q);
  setIfChanged("set", state.set, DEFAULT_COMPENDIUM_STATE.set);
  setIfChanged("type", state.type, DEFAULT_COMPENDIUM_STATE.type);
  setIfChanged("faction", state.faction, DEFAULT_COMPENDIUM_STATE.faction);
  setIfChanged("cost", state.cost, DEFAULT_COMPENDIUM_STATE.cost);
  setIfChanged("rarity", state.rarity, DEFAULT_COMPENDIUM_STATE.rarity);
  setIfChanged("keyword", state.keyword, DEFAULT_COMPENDIUM_STATE.keyword);
  setIfChanged("sort", state.sort, DEFAULT_COMPENDIUM_STATE.sort);
  setIfChanged("density", state.density, DEFAULT_COMPENDIUM_STATE.density);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.card) {
    params.set("card", state.card);
    setIfChanged("tab", state.tab, DEFAULT_COMPENDIUM_STATE.tab);
  }
  return params;
}

const searchableText = (card: GameCard) => [
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

const costRank = (cost: GameCard["cost"]) => cost === "X" ? Number.POSITIVE_INFINITY : cost;

export function filterAndSortCompendiumCards(
  cards: readonly GameCard[],
  state: CompendiumState,
) {
  const query = state.q.toLowerCase();
  return cards.filter((card) => (
    (!query || searchableText(card).includes(query))
    && (state.set === "All" || setCodeFor(card) === state.set)
    && (state.type === "All" || card.type === state.type)
    && (state.faction === "All" || card.factions.includes(state.faction as GameCard["faction"]))
    && (state.cost === "All" || String(card.cost) === state.cost)
    && (state.rarity === "All" || card.rarity === state.rarity)
    && (state.keyword === "All" || card.mechanics.includes(state.keyword))
  )).toSorted((left, right) => {
    if (state.sort === "name-asc") return left.displayName.localeCompare(right.displayName);
    if (state.sort === "name-desc") return right.displayName.localeCompare(left.displayName);
    if (state.sort === "cost-asc") return costRank(left.cost) - costRank(right.cost) || left.displayName.localeCompare(right.displayName);
    if (state.sort === "cost-desc") return costRank(right.cost) - costRank(left.cost) || left.displayName.localeCompare(right.displayName);
    const setOrder = { BB: 0, BR: 1, AA: 2 };
    return setOrder[setCodeFor(left)] - setOrder[setCodeFor(right)]
      || left.number - right.number
      || left.catalogId.localeCompare(right.catalogId);
  });
}

export function selectedCompendiumCard(cards: readonly GameCard[], identity: string) {
  if (!identity) return null;
  return cards.find((card) => card.catalogId === identity || card.slug === identity) ?? null;
}

export function relatedCompendiumCards(card: GameCard, cards: readonly GameCard[]) {
  const names = new Set([card.name, card.displayName, card.evolvesFrom].filter(Boolean).map((value) => value!.toLowerCase()));
  return cards.filter((candidate) => {
    if (candidate.catalogId === card.catalogId) return false;
    const candidateNames = [candidate.name, candidate.displayName, candidate.evolvesFrom]
      .filter(Boolean)
      .map((value) => value!.toLowerCase());
    return candidateNames.some((value) => names.has(value))
      || Boolean(card.evolvesFrom && candidate.displayName.toLowerCase().includes(card.evolvesFrom.toLowerCase()))
      || Boolean(candidate.evolvesFrom && card.displayName.toLowerCase().includes(candidate.evolvesFrom.toLowerCase()));
  }).slice(0, 12);
}
