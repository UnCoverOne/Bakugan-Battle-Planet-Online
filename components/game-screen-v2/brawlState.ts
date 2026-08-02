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

function coreBonuses(core: Core, faction: Faction) {
  const conditional = !core.conditionalFactions?.length
    || core.conditionalFactions.includes(faction);
  return {
    power: core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0),
    damage: core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0),
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
    const bonus = coreBonuses(core, bakugan.faction);
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
  const modifiers: string[] = [];

  if (!participating) {
    modifiers.push("Roll result • Missed and remained closed");
  }
  for (const core of cores) {
    const bonus = coreBonuses(core, bakugan.faction);
    const values = [
      bonus.power ? `${signed(bonus.power)} B` : "",
      bonus.damage ? `${signed(bonus.damage)} Damage` : "",
      core.frostStrike ? `+${core.frostStrike} FrostStrike` : "",
      core.shadowStrike ? "ShadowStrike" : "",
    ].filter(Boolean);
    modifiers.push(`${core.name}${values.length ? ` • ${values.join(" • ")}` : ""}`);
  }
  if (temporaryPower) modifiers.push(`Power modifier ${signed(temporaryPower)} B`);
  if (temporaryDamage) modifiers.push(`Damage modifier ${signed(temporaryDamage)}`);
  if (continuousPower) modifiers.push(`Continuous modifier ${signed(continuousPower)} B`);
  if (continuousDamage) modifiers.push(`Continuous modifier ${signed(continuousDamage)} Damage`);
  const frost = match.frostStrike[bakugan.id] ?? 0;
  if (frost) modifiers.push(`FrostStrike ${frost}`);
  if (match.doubleStrike[bakugan.id]) modifiers.push("DoubleStrike");
  if (match.shadowStrike[bakugan.id]) modifiers.push("ShadowStrike");
  if (!modifiers.length) modifiers.push("No active modifiers");

  const characteristics = evaluateBakuganCharacteristics(match, bakugan, player);
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
