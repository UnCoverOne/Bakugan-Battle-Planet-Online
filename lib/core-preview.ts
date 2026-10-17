import type { Core } from "./game";

const signedCoreValue = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export const coreBaseStats = (core: Core) => [
  core.bonus !== 0 ? `${signedCoreValue(core.bonus)} B` : "",
  core.damageBonus !== 0 ? `${signedCoreValue(core.damageBonus)} D` : "",
].filter(Boolean);

export const coreSpecialEffects = (core: Core) => [
  core.bakuGearCostReduction ? `Baku-Gear −${core.bakuGearCostReduction} Energy` : "",
  core.frostStrike ? `+${core.frostStrike} FrostStrike` : "",
  core.shadowStrike ? "ShadowStrike" : "",
  core.fusionBonus ? `Fusion ${signedCoreValue(core.fusionBonus)} B` : "",
  core.fusionDamageBonus ? `Fusion ${signedCoreValue(core.fusionDamageBonus)} D` : "",
  core.fusionFrostStrike ? `Fusion +${core.fusionFrostStrike} FrostStrike` : "",
  core.conditionalFactions?.length && (core.conditionalBonus || core.conditionalDamage)
    ? `${core.conditionalFactions.join(" / ")}: ${signedCoreValue(core.conditionalBonus || core.conditionalDamage || 0)} ${core.conditionalBonus ? "B" : "D"}`
    : "",
].filter(Boolean);

export const corePreviewStats = (core: Core) => [...coreBaseStats(core), ...coreSpecialEffects(core)];

export const coreForSet = (core: Core, set: string): Core => {
  const printing = core.printings?.find((candidate) => candidate.set === set);
  return printing
    ? { ...core, set: printing.set, number: printing.number, art: printing.art, hasProvidedScan: true }
    : core;
};
