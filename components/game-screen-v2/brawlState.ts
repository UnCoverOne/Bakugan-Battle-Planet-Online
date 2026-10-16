import {
  totalDamage,
  totalPower,
  type Bakugan,
  type Core,
  type Faction,
  type MatchState,
  type PendingEffect,
  type PlayerState,
  type RollOutcome,
} from "../../lib/game";
import { evaluateBakuganCharacteristics } from "../../lib/rules/modifiers";

export const BRAWL_PHASES = new Set([
  "power",
  "victor",
  "damage",
  "postDamage",
  "retract",
]);

/**
 * The preview is useful while players are comparing the active Bakugan and
 * resolving Victor triggers. The Damage step replaces that decision space with
 * the deck-flip interface, so the preview deliberately closes at that boundary.
 */
export const BRAWL_PREVIEW_PHASES = new Set([
  "power",
  "victor",
]);

export type BrawlVictorStat = "power" | "damage";

/** The stat currently used to determine the Brawl Victor. */
export function brawlVictorStat(
  match: Pick<MatchState, "victorByDamage"> | null | undefined,
): BrawlVictorStat {
  return match?.victorByDamage ? "damage" : "power";
}

export type BrawlCombatantView = {
  playerId: string;
  playerName: string;
  bakuganId: string;
  bakuganName: string;
  faction: string;
  art: string;
  cardName: string;
  power: number;
  damage: number;
  basePower: number;
  baseDamage: number;
  effects: string[];
  modifiers: string[];
  keywords: { name: "FrostStrike" | "ShadowStrike" | "DoubleStrike"; amount?: number }[];
  participating: boolean;
  rollResult: RollOutcome["result"] | null;
  rollLabel: string;
  rollNote: string;
};

function activeBakugan(match: MatchState, player: PlayerState): Bakugan | null {
  const id = match.selected[player.id];
  return player.bakugan.find((bakugan) => bakugan.id === id) ?? null;
}

function topCard(bakugan: Bakugan) {
  return bakugan.evoStack.at(-1) ?? bakugan.character;
}

function heldCores(match: MatchState, bakugan: Bakugan): Core[] {
  return bakugan.heldCoreCells
    .map((cell) => match.placements.find((placement) => placement.cell === cell)?.core)
    .filter((core): core is Core => Boolean(core));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function coreBonuses(core: Core, faction: Faction, fused: boolean) {
  const conditional = !core.conditionalFactions?.length
    || core.conditionalFactions.includes(faction);
  return {
    power: core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0) + (fused ? core.fusionBonus ?? 0 : 0),
    damage: core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0) + (fused ? core.fusionDamageBonus ?? 0 : 0),
  };
}

export function brawlRollLabel(result: RollOutcome["result"] | null | undefined) {
  switch (result) {
    case "miss-closed": return "MISS • CLOSED";
    case "open-no-core": return "OPEN • NO CORE";
    case "intended-core": return "OPEN • INTENDED CORE";
    case "overshoot": return "OPEN • OVERSHOOT";
    case "undershoot": return "OPEN • UNDERSHOOT";
    case "skew-left": return "OPEN • SKEW LEFT";
    case "skew-right": return "OPEN • SKEW RIGHT";
    case "path-intercept": return "OPEN • PATH INTERCEPT";
    default: return "ROLL PENDING";
  }
}

export function brawlIsEngaged(match: MatchState | null | undefined) {
  if (!match || !BRAWL_PREVIEW_PHASES.has(match.phase) || match.players.length < 2) return false;
  const combatants = match.players.map((player) => ({
    bakugan: activeBakugan(match, player),
    roll: match.rolls[player.id],
  }));
  return combatants.every(({ bakugan, roll }) => Boolean(bakugan && roll))
    && combatants.some(({ bakugan, roll }) => Boolean(
      bakugan?.open && roll && roll.result !== "miss-closed",
    ));
}

export function brawlCombatantView(
  match: MatchState,
  player: PlayerState,
): BrawlCombatantView | null {
  const bakugan = activeBakugan(match, player);
  if (!bakugan) return null;
  const roll = match.rolls[player.id];
  const participating = Boolean(
    bakugan.open && roll && roll.result !== "miss-closed",
  );
  const card = topCard(bakugan);
  const cores = heldCores(match, bakugan);
  const coreTotals = cores.reduce((totals, core) => {
    const bonus = coreBonuses(core, bakugan.faction, Boolean(bakugan.fused));
    return {
      power: totals.power + bonus.power,
      damage: totals.damage + bonus.damage,
    };
  }, { power: 0, damage: 0 });
  const basePower = card.bPower ?? bakugan.bPower;
  const baseDamage = card.damage ?? bakugan.damage;
  const temporaryPower = match.powerBoost[bakugan.id] ?? 0;
  const temporaryDamage = match.damageBoost[bakugan.id] ?? 0;
  const power = participating ? totalPower(match, player.id) : 0;
  const damage = participating ? totalDamage(match, player.id) : 0;
  const continuousPower = participating
    ? power - basePower - coreTotals.power - temporaryPower
    : 0;
  const continuousDamage = participating
    ? damage - baseDamage - coreTotals.damage - temporaryDamage
    : 0;
  const characteristics = evaluateBakuganCharacteristics(match, bakugan, player);
  const modifiers: string[] = [];

  if (!participating) modifiers.push("Roll result • Missed and remained closed");

  // Report each physical Core separately; its generated name can already contain
  // its numerical bonuses, so use the Core type as the label instead.
  for (const core of cores) {
    const bonus = coreBonuses(core, bakugan.faction, Boolean(bakugan.fused));
    const values = [
      bonus.power ? `${signed(bonus.power)} B` : "",
      bonus.damage ? `${signed(bonus.damage)} Damage` : "",
      core.bakuGearCostReduction ? `-${core.bakuGearCostReduction} Baku-Gear Energy` : "",
    ].filter(Boolean);
    modifiers.push(`${core.type}: ${values.join(", ") || "No stat bonus"}`);
  }

  // Source IDs in applied characteristics are card-instance IDs, not card
  // names. Resolve them from the match and combine Power and Damage for each
  // individual source, including active Character, Gear, Hero and Action cards.
  const sourceCards = match.players.flatMap((owner) => [
    ...owner.bakugan.flatMap((entry) => [
      entry.character, ...(entry.fusionCharacter ? [entry.fusionCharacter] : []),
      ...entry.evoStack, ...(entry.bakuGear ?? []),
    ]),
    ...owner.heroes, ...owner.hand, ...owner.discard,
    ...owner.deckCards, ...owner.energyZone,
  ]);
  const sourceNames = new Map(sourceCards.map((source) => [
    source.id, source.displayName || source.name,
  ]));
  const grouped = new Map<string, { name: string; power: number; damage: number }>();
  for (const modifier of characteristics.applied) {
    if (modifier.sourceCategory === "bakucore"
      || modifier.stat === "frost" || modifier.stat === "shadow" || modifier.stat === "double"
      || (modifier.stat !== "power" && modifier.stat !== "damage")) continue;
    const name = sourceNames.get(modifier.sourceId);
    if (!name) continue;
    const entry = grouped.get(modifier.sourceId) ?? { name, power: 0, damage: 0 };
    entry[modifier.stat] += modifier.amount;
    grouped.set(modifier.sourceId, entry);
  }
  for (const entry of grouped.values()) {
    const values = [
      entry.power ? `${signed(entry.power)} B` : "",
      entry.damage ? `${signed(entry.damage)} Damage` : "",
    ].filter(Boolean);
    if (values.length) modifiers.push(`${entry.name}: ${values.join(", ")}`);
  }

  // Preserve visibility of unattributed values (for example legacy temporary
  // state) without assigning them to an unrelated card.
  const attributedPower = [...grouped.values()].reduce((sum, entry) => sum + entry.power, 0);
  const attributedDamage = [...grouped.values()].reduce((sum, entry) => sum + entry.damage, 0);
  const remainingPower = power - basePower - coreTotals.power - attributedPower;
  const remainingDamage = damage - baseDamage - coreTotals.damage - attributedDamage;
  if (participating && remainingPower) modifiers.push(`Other modifier: ${signed(remainingPower)} B`);
  if (participating && remainingDamage) modifiers.push(`Other modifier: ${signed(remainingDamage)} Damage`);

  const keywords: BrawlCombatantView["keywords"] = [];
  if (characteristics.frostStrike > 0) keywords.push({ name: "FrostStrike", amount: characteristics.frostStrike });
  if (characteristics.shadowStrike) keywords.push({ name: "ShadowStrike" });
  if (characteristics.doubleStrike) keywords.push({ name: "DoubleStrike" });
  if (!modifiers.length && !keywords.length) modifiers.push("No active modifiers");

  const appliedCardSourceIds = new Set(
    characteristics.applied.map((modifier) => modifier.sourceId),
  );
  const activeHeroEffects = match.players
    .flatMap((owner) => owner.heroes)
    .filter((hero) => appliedCardSourceIds.has(hero.id) && hero.effect?.trim())
    .map((hero) => `${hero.displayName || hero.name}: ${hero.effect.trim()}`);
  const effects = [
    card.effect?.trim() ? `${card.displayName || card.name}: ${card.effect.trim()}` : "",
    ...activeHeroEffects,
  ].filter(Boolean);

  return {
    playerId: player.id,
    playerName: player.name,
    bakuganId: bakugan.id,
    bakuganName: bakugan.name,
    faction: bakugan.faction,
    art: card.art || bakugan.art,
    cardName: card.displayName || card.name,
    power,
    damage,
    basePower,
    baseDamage,
    effects: effects.length ? effects : ["No printed or continuous effects"],
    modifiers,
    keywords,
    participating,
    rollResult: roll?.result ?? null,
    rollLabel: brawlRollLabel(roll?.result),
    rollNote: roll?.note ?? "The roll result is not available.",
  };
}

export function brawlCombatants(
  match: MatchState | null | undefined,
  playerId?: string,
): readonly BrawlCombatantView[] {
  if (!match || !brawlIsEngaged(match)) return [];
  const local = match.players.find((player) => player.id === playerId) ?? match.players[0];
  const ordered = [local, ...match.players.filter((player) => player.id !== local.id)];
  return ordered
    .map((player) => brawlCombatantView(match, player))
    .filter((view): view is BrawlCombatantView => Boolean(view));
}

export function orderedBatchEffects(
  match: MatchState | null | undefined,
): readonly PendingEffect[] {
  return [...(match?.batch ?? [])].reverse();
}

export function batchTopEffect(match: MatchState | null | undefined) {
  return match?.batch.at(-1) ?? null;
}

/**
 * A resolving Reroll remains in the batch while its controller chooses a new
 * BakuCore target. Keep that modal HUD out of the way until targeting is done.
 */
export function batchHudShouldRender(match: MatchState | null | undefined) {
  return !Boolean(
    match?.pendingReroll
    && !match.pendingReroll.targetCell
  );
}

export type EffectAnimationKind = "power" | "damage" | "draw" | "energy" | "negate" | "ability";

export function effectAnimationKind(effect: PendingEffect): EffectAnimationKind {
  const text = `${effect.card.name} ${effect.card.effect}`.toLowerCase();
  if (/negate|cancel/.test(text)) return "negate";
  if (/\[b\]|b-power|bpower|power/.test(text)) return "power";
  if (/damage|double ?strike/.test(text)) return "damage";
  if (/draw|discard|hand/.test(text)) return "draw";
  if (/energy|energize|uncharg/.test(text)) return "energy";
  return "ability";
}

export function powerStepStatus(match: MatchState | null | undefined) {
  return {
    active: match?.phase === "power",
    priorityPlayerId: match?.phase === "power" ? match.priority : "",
    consecutivePasses: match?.phase === "power" ? match.passes.length : 0,
    batchCount: match?.phase === "power" ? match.batch.length : 0,
    topEffectId: match?.phase === "power" ? batchTopEffect(match)?.id ?? "" : "",
  };
}
