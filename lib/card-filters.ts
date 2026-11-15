import { CARD_SET_INFO, cardSetCode } from "./content/catalogue";
import type { Core, GameCard } from "./game";

export const CARD_FILTER_FACETS = [
  "type",
  "set",
  "faction",
  "cost",
  "rarity",
  "coreType",
  "bPower",
  "damage",
  "keyword",
] as const;

export type CardFilterFacet = (typeof CARD_FILTER_FACETS)[number];

export type CardFilterState = {
  type: string[];
  set: string[];
  faction: string[];
  cost: string[];
  rarity: string[];
  coreType: string[];
  bPower: string[];
  damage: string[];
  keyword: string[];
};

export type CardFilterOption = {
  value: string;
  label: string;
  icon?: string;
};

export type CardFilterOptionCatalogue = Record<CardFilterFacet, readonly CardFilterOption[]>;

export const CARD_FILTER_LABELS: Record<CardFilterFacet, string> = {
  type: "Card type",
  set: "Set",
  faction: "Faction",
  cost: "Energy cost",
  rarity: "Rarity",
  coreType: "BakuCores",
  bPower: "B Power",
  damage: "Damage",
  keyword: "Keyword",
};

export const FACTIONS = ["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"] as const;
export const CARD_TYPES = ["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo", "Character"] as const;
export const CORE_TYPES = ["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"] as const;

export const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

export const HIDDEN_KEYWORD_FILTERS = new Set([
  "Alternate Win",
  "B-Power",
  "Baku-Gear",
  "BakuCore",
  "Control",
  "Copy",
  "Damage",
  "Destroy",
  "Energy",
  "Free play",
  "Fusion",
  "Retract",
  "Return",
  "Search",
  "Static",
  "Stop",
  "Triggered",
]);

export const CARD_TYPE_OPTIONS: readonly CardFilterOption[] = CARD_TYPES
  .map((value) => ({ value, label: value }))
  .toSorted((left, right) => left.label.localeCompare(right.label));
export const FACTION_OPTIONS: readonly CardFilterOption[] = FACTIONS.map((value) => ({
  value,
  label: value,
  icon: FACTION_SYMBOLS[value],
}));
export const COST_OPTIONS: readonly CardFilterOption[] = [
  ...Array.from({ length: 11 }, (_, value) => ({ value: String(value), label: String(value) })),
  { value: "X", label: "X" },
];
export const CORE_TYPE_OPTIONS: readonly CardFilterOption[] = CORE_TYPES.map((value) => ({ value, label: value }));
export const SET_OPTIONS: readonly CardFilterOption[] = Object.values(CARD_SET_INFO)
  .map((set) => ({ value: set.code, label: set.name }));
export const CORE_SET_OPTIONS: readonly CardFilterOption[] = [
  { value: "Battle Brawlers", label: "Battle Brawlers" },
  { value: "Armored Alliance", label: "Armored Alliance" },
];

const setNameByCode = new Map(Object.values(CARD_SET_INFO).map((set) => [set.code, set.name]));

export function createEmptyCardFilters(
  initial: Partial<Record<CardFilterFacet, readonly string[]>> = {},
): CardFilterState {
  return {
    type: [...(initial.type ?? [])],
    set: [...(initial.set ?? [])],
    faction: [...(initial.faction ?? [])],
    cost: [...(initial.cost ?? [])],
    rarity: [...(initial.rarity ?? [])],
    coreType: [...(initial.coreType ?? [])],
    bPower: [...(initial.bPower ?? [])],
    damage: [...(initial.damage ?? [])],
    keyword: [...(initial.keyword ?? [])],
  };
}

export function createCardFilterOptionCatalogue(cards: readonly GameCard[]): CardFilterOptionCatalogue {
  return {
    type: CARD_TYPE_OPTIONS,
    set: SET_OPTIONS,
    faction: FACTION_OPTIONS,
    cost: COST_OPTIONS,
    rarity: [...new Set(cards.map((card) => card.rarity))]
      .filter(Boolean)
      .toSorted()
      .map((value) => ({ value, label: value })),
    coreType: CORE_TYPE_OPTIONS,
    bPower: [...new Set(cards.filter((card) => card.type === "Character" || card.type === "Evo")
      .map((card) => card.bPower).filter((value): value is number => value !== null))]
      .sort((a, b) => a - b).map((value) => ({ value: String(value), label: String(value) })),
    damage: [...new Set(cards.filter((card) => card.type === "Character" || card.type === "Evo")
      .map((card) => card.damage).filter((value): value is number => value !== null))]
      .sort((a, b) => a - b).map((value) => ({ value: String(value), label: String(value) })),
    keyword: [...new Set(cards.flatMap((card) => card.mechanics))]
      .filter((value) => value && !HIDDEN_KEYWORD_FILTERS.has(value))
      .toSorted()
      .map((value) => ({ value, label: value })),
  };
}

export function restrictCardFilters(
  filters: CardFilterState,
  facets: readonly CardFilterFacet[],
): CardFilterState {
  const visible = new Set(facets);
  return {
    type: visible.has("type") ? [...filters.type] : [],
    set: visible.has("set") ? [...filters.set] : [],
    faction: visible.has("faction") ? [...filters.faction] : [],
    cost: visible.has("cost") ? [...filters.cost] : [],
    rarity: visible.has("rarity") ? [...filters.rarity] : [],
    coreType: visible.has("coreType") ? [...filters.coreType] : [],
    bPower: visible.has("bPower") ? [...filters.bPower] : [],
    damage: visible.has("damage") ? [...filters.damage] : [],
    keyword: visible.has("keyword") ? [...filters.keyword] : [],
  };
}

export function clearCardFilterFacets(
  filters: CardFilterState,
  facets: readonly CardFilterFacet[],
): CardFilterState {
  const cleared = new Set(facets);
  return {
    type: cleared.has("type") ? [] : [...filters.type],
    set: cleared.has("set") ? [] : [...filters.set],
    faction: cleared.has("faction") ? [] : [...filters.faction],
    cost: cleared.has("cost") ? [] : [...filters.cost],
    rarity: cleared.has("rarity") ? [] : [...filters.rarity],
    coreType: cleared.has("coreType") ? [] : [...filters.coreType],
    bPower: cleared.has("bPower") ? [] : [...filters.bPower],
    damage: cleared.has("damage") ? [] : [...filters.damage],
    keyword: cleared.has("keyword") ? [] : [...filters.keyword],
  };
}

export function activeCardFilterCount(
  filters: CardFilterState,
  facets: readonly CardFilterFacet[] = CARD_FILTER_FACETS,
) {
  return facets.reduce((total, facet) => total + filters[facet].length, 0);
}

export function cardMatchesFilters(card: GameCard, filters: CardFilterState) {
  const explicitlyIncludesCharacter = filters.type.includes("Character");
  const explicitlyIncludesNonCharacter = filters.type.some((type) => type !== "Character");
  const mixesCharacterAndNonCharacter = explicitlyIncludesCharacter && explicitlyIncludesNonCharacter;
  const isCharacter = card.type === "Character";

  const coreTypeMatches = filters.coreType.length === 0
    || (isCharacter
      ? card.coreTypes.some((coreType) => filters.coreType.includes(coreType))
      : mixesCharacterAndNonCharacter);
  const costMatches = filters.cost.length === 0
    || (isCharacter
      ? explicitlyIncludesCharacter
      : filters.cost.includes(String(card.cost)));
  const statsCard = isCharacter || card.type === "Evo";
  const bPowerMatches = filters.bPower.length === 0 || (!statsCard && mixesCharacterAndNonCharacter) || (card.bPower !== null && filters.bPower.includes(String(card.bPower)));
  const damageMatches = filters.damage.length === 0 || (!statsCard && mixesCharacterAndNonCharacter) || (card.damage !== null && filters.damage.includes(String(card.damage)));
  const rarityMatches = filters.rarity.length === 0
    || (isCharacter
      ? explicitlyIncludesCharacter
      : filters.rarity.includes(card.rarity));

  return (
    (filters.set.length === 0 || filters.set.includes(cardSetCode(card)))
    && (filters.type.length === 0 || filters.type.includes(card.type))
    && coreTypeMatches
    && bPowerMatches
    && damageMatches
    && (filters.faction.length === 0 || card.factions.some((faction) => filters.faction.includes(faction)))
    && costMatches
    && rarityMatches
    && (filters.keyword.length === 0 || card.mechanics.some((mechanic) => filters.keyword.includes(mechanic)))
  );
}

export function coreMatchesFilters(core: Core, filters: CardFilterState) {
  const printingSets = new Set([
    core.set ?? "Battle Brawlers",
    ...(core.printings ?? []).map((printing) => printing.set),
  ]);
  const setMatches = filters.set.length === 0 || filters.set.some((selected) => (
    printingSets.has(selected)
    || printingSets.has(setNameByCode.get(selected) ?? "")
  ));
  return setMatches
    && (filters.coreType.length === 0 || filters.coreType.includes(core.type));
}
