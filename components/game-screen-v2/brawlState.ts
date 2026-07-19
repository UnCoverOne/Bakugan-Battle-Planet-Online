import {
  totalDamage,
  totalPower,
  type Bakugan,
  type Core,
  type MatchState,
  type PendingEffect,
  type PlayerState,
} from "../../lib/game";

export const BRAWL_PHASES = new Set([
  "power",
  "victor",
  "damage",
  "postDamage",
  "retract",
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

function coreBonuses(core: Core, faction: string) {
  const conditional = !core.conditionalFactions?.length
    || core.conditionalFactions.includes(faction as Core["conditionalFactions"][number]);
  return {
    power: core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0),
    damage: core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0),
  };
}

export function brawlIsEngaged(match: MatchState | null | undefined) {
  if (!match || !BRAWL_PHASES.has(match.phase) || match.players.length < 2) return false;
  return match.players.every((player) => {
    const bakugan = activeBakugan(match, player);
    const roll = match.rolls[player.id];
    return Boolean(bakugan?.open && roll && roll.result !== "miss");
  });
}

export function brawlCombatantView(
  match: MatchState,
  player: PlayerState,
): BrawlCombatantView | null {
  const bakugan = activeBakugan(match, player);
  if (!bakugan) return null;
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
  const power = totalPower(match, player.id);
  const damage = totalDamage(match, player.id);
  const continuousPower = power - basePower - coreTotals.power - temporaryPower;
  const continuousDamage = damage - baseDamage - coreTotals.damage - temporaryDamage;
  const modifiers: string[] = [];

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

  const effects = [
    card.effect?.trim() ? `${card.displayName || card.name}: ${card.effect.trim()}` : "",
    ...player.heroes
      .filter((hero) => hero.effect?.trim())
      .map((hero) => `${hero.displayName || hero.name}: ${hero.effect.trim()}`),
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
