"use client";
import type { ReactNode } from "react";
import type { CompendiumState, CoreCompendiumState } from "../../lib/compendium";
import { CORE_COMPENDIUM } from "../../lib/data";
import { CompendiumFieldPicker } from "./CompendiumFieldPicker";
import { CARD_FILTER_LABELS, CORE_SET_OPTIONS, CORE_TYPE_OPTIONS, FACTION_OPTIONS, type CardFilterFacet, type CardFilterOptionCatalogue, type CardFilterOption as FilterOption } from "../../lib/card-filters";
import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "../../lib/catalogue-sorting";
import { CORE_EFFECT_OPTIONS } from "../../lib/core-preview";

const CORE_SORT_OPTIONS: FilterOption[] = Object.entries(CORE_SORT_LABELS)
  .map(([value, label]) => ({ value, label }));
const FUSION_OPTIONS: FilterOption[] = [{ value: "fused", label: "Fused side only" }];

type FilterKey = CardFilterFacet;

export function FilterControls({
  state, filterOptions, onChange, onFusionChange, onSortChange, sortControl,
}: {
  sortControl?: ReactNode;
  state: CompendiumState;
  filterOptions: CardFilterOptionCatalogue;
  onChange: (key: FilterKey, values: string[]) => void;
  onFusionChange: (enabled: boolean) => void;
  onSortChange: (sort: CompendiumState["sort"]) => void;
}) {
  const characterOnly = state.type.length === 1 && state.type[0] === "Character";
  const hasCharacter = state.type.includes("Character");
  const hasStats = hasCharacter || state.type.includes("Evo");
  const sorts = Object.entries(SORT_LABELS).filter(([value]) =>
    (characterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS).has(value as CompendiumState["sort"]));
  const selectedSort = sorts.some(([value]) => value === state.sort) ? state.sort : "collector";
  const fields: CardFilterFacet[] = [
    ...(characterOnly ? ["coreType" as const] : []),
    ...(hasStats ? ["bPower" as const, "damage" as const] : []),
    "faction", "set",
    ...(!characterOnly ? ["rarity" as const, "cost" as const] : []),
    "keyword",
  ];
  const info: Partial<Record<CardFilterFacet, string>> = {
    type: "Card Type determines the available sorting options and conditional filters.",
    coreType: "Available only when Character is the sole selected card type.",
    bPower: "Available when Character and/or Evo cards are selected.",
    damage: "Available when Character and/or Evo cards are selected.",
    rarity: "Not available when only Character cards are selected.",
    cost: "Not available when only Character cards are selected.",
  };
  const label: Partial<Record<CardFilterFacet, string>> = {
    type: "Card Type", coreType: "BakuCores", bPower: "B Power", cost: "Cost",
  };
  const picker = (facet: CardFilterFacet) => (
    <CompendiumFieldPicker key={facet} label={label[facet] ?? CARD_FILTER_LABELS[facet]} values={state[facet]} options={filterOptions[facet]}
      searchable={["set", "bPower", "damage", "keyword"].includes(facet)}
      info={info[facet]} onChange={(values) => onChange(facet, values)} />
  );
  return <>
    {picker("type")}
    {characterOnly && <CompendiumFieldPicker label="Fusions" values={state.fusionOnly ? ["fused"] : []}
      options={FUSION_OPTIONS} mode="single"
      info="Show only Fusion Bakugan on the fused face of their Character Cards."
      onChange={(values) => onFusionChange(values.includes("fused"))} />}
    {sortControl ?? <CompendiumFieldPicker label="Sort By" values={[selectedSort]} mode="single" clearable={false}
      options={sorts.map(([value, label]) => ({ value, label }))}
      onChange={(values) => { if (values[0]) onSortChange(values[0] as CompendiumState["sort"]); }} />}
    {fields.map(picker)}
  </>;
}

const CORE_POWER_OPTIONS: FilterOption[] = [...new Set(CORE_COMPENDIUM.map((core) => core.bonus))]
  .sort((a, b) => a - b).map((value) => ({ value: String(value), label: String(value) }));
const CORE_DAMAGE_OPTIONS: FilterOption[] = [...new Set(CORE_COMPENDIUM.map((core) => core.damageBonus))]
  .sort((a, b) => a - b).map((value) => ({ value: String(value), label: String(value) }));

export function CoreFilterControls({
  state, onChange, onSortChange, sortControl,
}: {
  sortControl?: ReactNode;
  state: CoreCompendiumState;
  onChange: (patch: Partial<CoreCompendiumState>) => void;
  onSortChange: (sort: CoreCompendiumState["sort"]) => void;
}) {
  return <>
    <CompendiumFieldPicker label="Core Type" values={state.type} options={CORE_TYPE_OPTIONS}
      onChange={(type) => onChange({ type })} />
    {sortControl ?? <CompendiumFieldPicker label="Sort By" values={[state.sort]} options={CORE_SORT_OPTIONS}
      mode="single" clearable={false}
      onChange={(values) => { if (values[0]) onSortChange(values[0] as CoreCompendiumState["sort"]); }} />}
    <CompendiumFieldPicker label="Set" values={state.set} options={CORE_SET_OPTIONS}
      onChange={(set) => onChange({ set })} />
    <CompendiumFieldPicker label="Effects" values={state.effects} options={CORE_EFFECT_OPTIONS}
      searchable info="Match any selected effect type. All Core effects have equal weight."
      onChange={(effects) => onChange({ effects })} />
    <CompendiumFieldPicker label="B Power" values={state.bonus} options={CORE_POWER_OPTIONS}
      searchable info="Filter the printed base B-Power value, independent of conditional or Fusion bonuses."
      onChange={(bonus) => onChange({ bonus })} />
    <CompendiumFieldPicker label="Damage" values={state.damage} options={CORE_DAMAGE_OPTIONS}
      searchable info="Filter the printed base Damage value, independent of conditional or Fusion bonuses."
      onChange={(damage) => onChange({ damage })} />
    <CompendiumFieldPicker label="Conditional Factions" values={state.faction} options={FACTION_OPTIONS}
      info="Find BakuCores with a bonus that applies to any selected faction."
      onChange={(faction) => onChange({ faction })} />
  </>;
}
