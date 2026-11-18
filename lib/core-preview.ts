import type { Core } from "./game";

export const CORE_EFFECT_OPTIONS = [
  { value: "power", label: "B Power" },
  { value: "damage", label: "Damage" },
  { value: "gear", label: "Baku-Gear cost reduction" },
  { value: "frost", label: "FrostStrike" },
  { value: "shadow", label: "ShadowStrike" },
  { value: "fusion-power", label: "Fusion B Power" },
  { value: "fusion-damage", label: "Fusion Damage" },
  { value: "fusion-frost", label: "Fusion FrostStrike" },
  { value: "conditional-power", label: "Conditional B Power" },
  { value: "conditional-damage", label: "Conditional Damage" },
] as const;

export type CoreEffectKind = (typeof CORE_EFFECT_OPTIONS)[number]["value"];
export type CoreEffect = {
  kind: CoreEffectKind;
  /** Complete wording for screen readers and hover tooltips. */
  label: string;
  /** Signed value shown beside the corresponding game symbol. */
  value?: string;
  /** Any listed faction qualifies; the icon sequence is part of the same tag. */
  factions?: readonly string[];
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

/** One equal-weight tag per actual nonzero BakuCore effect, in a stable order. */
export function coreEffects(core: Core): CoreEffect[] {
  const effects: CoreEffect[] = [];
  if (core.bonus) effects.push({ kind: "power", value: signed(core.bonus), label: `${signed(core.bonus)} B Power` });
  if (core.damageBonus) effects.push({ kind: "damage", value: signed(core.damageBonus), label: `${signed(core.damageBonus)} Damage` });
  if (core.bakuGearCostReduction) effects.push({
    kind: "gear", value: `−${core.bakuGearCostReduction}`,
    label: `Baku-Gear costs ${core.bakuGearCostReduction} less Energy`,
  });
  if (core.frostStrike) effects.push({ kind: "frost", value: `+${core.frostStrike}`, label: `+${core.frostStrike} FrostStrike` });
  if (core.shadowStrike) effects.push({ kind: "shadow", label: "ShadowStrike" });
  if (core.fusionBonus) effects.push({ kind: "fusion-power", value: signed(core.fusionBonus), label: `While fused: ${signed(core.fusionBonus)} B Power` });
  if (core.fusionDamageBonus) effects.push({ kind: "fusion-damage", value: signed(core.fusionDamageBonus), label: `While fused: ${signed(core.fusionDamageBonus)} Damage` });
  if (core.fusionFrostStrike) effects.push({ kind: "fusion-frost", value: `+${core.fusionFrostStrike}`, label: `While fused: +${core.fusionFrostStrike} FrostStrike` });
  if (core.conditionalFactions?.length) {
    const condition = core.conditionalFactions.join(" or ");
    if (core.conditionalBonus) effects.push({
      kind: "conditional-power", factions: core.conditionalFactions, value: signed(core.conditionalBonus),
      label: `If the Bakugan is ${condition}: ${signed(core.conditionalBonus)} B Power`,
    });
    if (core.conditionalDamage) effects.push({
      kind: "conditional-damage", factions: core.conditionalFactions, value: signed(core.conditionalDamage),
      label: `If the Bakugan is ${condition}: ${signed(core.conditionalDamage)} Damage`,
    });
  }
  return effects;
}

/** Resolve the correct physical printing without creating another playable Core. */
export const coreForSet = (core: Core, selection: readonly string[] | string = []): Core => {
  // The Deck Builder uses one set selection; the Compendium supports several.
  const sets = typeof selection === "string" ? (selection === "All" ? [] : [selection]) : selection;
  if (!sets.length || (core.set && sets.includes(core.set))) return core;
  const printing = core.printings?.find((candidate) => sets.includes(candidate.set));
  return printing
    ? { ...core, set: printing.set, number: printing.number, art: printing.art }
    : core;
};

/** Legacy text presentation remains in active use by the Deck Builder. */
export const corePreviewStats = (core: Core): string[] => coreEffects(core).map((effect) => {
  const value = effect.value ?? "";
  switch (effect.kind) {
    case "power": return `${value} B`;
    case "damage": return `${value} D`;
    case "gear": return `Baku-Gear ${value} Energy`;
    case "frost": return `${value} FrostStrike`;
    case "shadow": return "ShadowStrike";
    case "fusion-power": return `Fusion ${value} B`;
    case "fusion-damage": return `Fusion ${value} D`;
    case "fusion-frost": return `Fusion ${value} FrostStrike`;
    case "conditional-power": return `${effect.factions?.join(" / ")}: ${value} B`;
    case "conditional-damage": return `${effect.factions?.join(" / ")}: ${value} D`;
  }
});
