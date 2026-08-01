import type { Bakugan, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import type { ContinuousModifier, RuleAction, RuleCondition, RulesCardId } from "./model";
import { ensureRulesState } from "./state";

export type AppliedModifier = {
  id: string;
  stat: "power" | "damage" | "frost" | "shadow" | "double";
  amount: number;
  layer: ContinuousModifier["layer"];
  sourceCategory: NonNullable<ContinuousModifier["sourceCategory"]>;
  sourceId: string;
};

export type EvaluatedBakuganCharacteristics = {
  power: number;
  damage: number;
  frostStrike: number;
  shadowStrike: boolean;
  doubleStrike: boolean;
  applied: AppliedModifier[];
  prevented: AppliedModifier[];
};

const LAYER_ORDER: Record<ContinuousModifier["layer"], number> = {
  base: 0,
  set: 1,
  core: 2,
  continuous: 3,
  temporary: 4,
  protection: 5,
  final: 6,
};

function opponentOf(state: MatchState, player: PlayerState) {
  return state.players.find((candidate) => candidate.id !== player.id);
}

export function ruleConditionActive(state: MatchState, player: PlayerState, condition: RuleCondition | undefined, bakugan?: Bakugan) {
  if (!condition || condition.kind === "always") return true;
  const opponent = opponentOf(state, player);
  switch (condition.kind) {
    case "fury": return player.hand.length === 0;
    case "flow": return player.cardsPlayedThisTurn > 1;
    case "turbo": return Boolean(opponent && player.maxEnergy > opponent.maxEnergy);
    case "domination": return Boolean(opponent && player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0)
      > opponent.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0));
    case "victor": return state.brawlWinner === player.id;
    case "faction": return condition.subject === "target"
      ? bakugan?.faction === condition.faction
      : player.bakugan.some((candidate) => candidate.faction === condition.faction);
    case "cards-played": return condition.comparison === "at-least"
      ? player.cardsPlayedThisTurn >= condition.amount
      : player.cardsPlayedThisTurn > condition.amount;
    case "factions-played": return new Set(player.factionsPlayedThisTurn ?? []).size >= condition.amount;
    case "hero-count": return player.heroes.length >= condition.amount;
    case "controls-named-cards": {
      const normalize = (value: string) => value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const controlled = [
        ...player.heroes,
        ...player.bakugan.flatMap((candidate) => [candidate.character, ...candidate.evoStack]),
      ].map((card) => normalize(card.displayName || card.name));
      return condition.names.every((requiredName) => {
        const required = normalize(requiredName);
        return controlled.some((name) => name === required || name.startsWith(`${required} `));
      });
    }
    case "energy-count": return player.maxEnergy >= condition.amount;
    case "card-count": return player.heroes.filter((hero) => hero.catalogId === condition.catalogId).length >= condition.amount;
    case "core-count": {
      const held = player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
      if (condition.relationship === "at-least") return held >= (condition.amount ?? 0);
      const opposing = opponent?.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0) ?? 0;
      return held > opposing;
    }
    case "held-core-type":
      return Boolean(bakugan && bakugan.heldCoreCells.some((cell) => {
        const core = state.placements.find((placement) => placement.cell === cell)?.core;
        return Boolean(core && condition.coreTypes.includes(core.type));
      }));
    case "open-bakugan-count": {
      const open = player.bakugan.filter((bakugan) => bakugan.open).length;
      if (condition.comparison === "exactly") return open === condition.amount;
      if (condition.comparison === "at-least") return open >= condition.amount;
      if (condition.comparison === "at-most") return open <= condition.amount;
      if (condition.comparison === "more-than") return open > condition.amount;
      return open < condition.amount;
    }
    case "selection-made": return true;
    case "reroll-opened": return false;
    case "printed": return false;
  }
}

function targetMatches(state: MatchState, modifier: ContinuousModifier, bakugan: Bakugan, player: PlayerState) {
  if (modifier.targetBakuganId && modifier.targetBakuganId !== bakugan.id) return false;
  if (modifier.targetFaction && modifier.targetFaction !== bakugan.faction) return false;
  if (modifier.excludedTargetFaction && modifier.excludedTargetFaction === bakugan.faction) return false;
  if (modifier.target === "all-bakugan") return true;
  if (modifier.controllerId === player.id) return ["active-friendly", "chosen-bakugan", "all-friendly", "self"].includes(modifier.target);
  return ["active-enemy", "all-enemy"].includes(modifier.target);
}

function printedScaleMultiplier(scale: string | undefined, player: PlayerState) {
  if (!scale) return 1;
  if (scale === "other-card-played") return Math.max(0, player.cardsPlayedThisTurn - 1);
  if (/Energy card/i.test(scale)) return player.maxEnergy;
  if (/Hero card/i.test(scale)) return player.heroes.length;
  if (/BakuCore/i.test(scale)) return player.bakugan.reduce((sum, candidate) => sum + candidate.heldCoreCells.length, 0);
  return 1;
}

function printedTarget(sourceText: string, action: Extract<RuleAction, { kind: "modify-stat" | "grant-keyword" }>) {
  if (action.kind === "modify-stat" && action.scope) {
    return action.scope === "target" ? "chosen-bakugan" as const : action.scope;
  }
  if (/non-\[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i.test(sourceText)) return "all-bakugan" as const;
  if (/opposing Bakugan/i.test(sourceText)) return "all-enemy" as const;
  if (/your (?:\[[^\]]+\]\s+)?Bakugan|to your attacks|your attacks have/i.test(sourceText)) return "all-friendly" as const;
  return "chosen-bakugan" as const;
}

function printedActionModifier(
  action: RuleAction,
  sourceId: string,
  catalogId: RulesCardId,
  state: MatchState,
  player: PlayerState,
  bakugan: Bakugan,
  actionId: string,
  condition: RuleCondition,
  sourceText: string,
  intrinsicCharacteristic: boolean,
): ContinuousModifier | undefined {
  if (action.kind !== "modify-stat" && action.kind !== "grant-keyword") return undefined;
  if (!intrinsicCharacteristic && action.duration !== "while-source-active") return undefined;
  const target = printedTarget(sourceText, action);
  const faction = sourceText.match(/your \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1] as Bakugan["faction"] | undefined;
  const excludedFaction = sourceText.match(/non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1] as Bakugan["faction"] | undefined;
  const copies = sourceText.match(/if you have (\d+) of this in play/i);
  const activeCondition: RuleCondition = copies
    ? { kind: "card-count", catalogId, comparison: "at-least", amount: Number(copies[1]) }
    : condition;
  const base = {
    id: `${sourceId}:printed:${actionId}`,
    source: { kind: "card" as const, instanceId: sourceId, catalogId },
    controllerId: player.id,
    target,
    targetBakuganId: target === "chosen-bakugan" ? bakugan.id : undefined,
    targetFaction: faction,
    excludedTargetFaction: excludedFaction,
    amount: action.kind === "grant-keyword" ? action.value ?? 1 : action.amount * printedScaleMultiplier(action.scale, player),
    layer: "continuous" as const,
    duration: "while-source-active" as const,
    condition: activeCondition,
    createdTurn: state.turn,
    sourceCategory: "continuous" as const,
  };
  if (action.kind === "modify-stat") {
    if (action.stat === "frost") return { ...base, keyword: "FrostStrike" };
    return { ...base, stat: action.stat };
  }
  if (["DoubleStrike", "ShadowStrike", "FrostStrike"].includes(action.keyword)) {
    return { ...base, keyword: action.keyword as "DoubleStrike" | "ShadowStrike" | "FrostStrike" };
  }
  return undefined;
}

function activePrintedModifiers(state: MatchState, player: PlayerState, bakugan: Bakugan): ContinuousModifier[] {
  const top = bakugan.evoStack.at(-1) ?? bakugan.character;
  const sources = [top, ...player.heroes];
  return sources.flatMap((source) => {
    const definition = ruleDefinitionForCard(source);
    return definition.abilities.flatMap((ability) => {
      if (ability.kind === "triggered") return [];
      return ability.instructions.flatMap((instruction) => instruction.effects
        .map((action, index) => printedActionModifier(
          action,
          source.id,
          definition.cardId,
          state,
          player,
          bakugan,
          `${instruction.id}:${index}`,
          instruction.condition,
          instruction.sourceText,
          source === top && ["Character", "Evo"].includes(source.type),
        ))
        .filter((modifier): modifier is ContinuousModifier => Boolean(modifier)));
    });
  });
}

function sourceId(modifier: ContinuousModifier) {
  if ("instanceId" in modifier.source) return modifier.source.instanceId;
  return modifier.source.id;
}

export function evaluateBakuganCharacteristics(
  state: MatchState,
  bakugan: Bakugan,
  owner: PlayerState,
): EvaluatedBakuganCharacteristics {
  const top = bakugan.evoStack.at(-1) ?? bakugan.character;
  let power = top.bPower ?? bakugan.bPower;
  let damage = top.damage ?? bakugan.damage;
  let frostStrike = 0;
  let shadowStrike = Boolean(state.shadowStrike[bakugan.id]);
  let doubleStrike = Boolean(state.doubleStrike[bakugan.id]);
  const applied: AppliedModifier[] = [];
  const prevented: AppliedModifier[] = [];

  const coreModifiers: ContinuousModifier[] = bakugan.heldCoreCells.flatMap((cell) => {
    const core = state.placements.find((placement) => placement.cell === cell)?.core;
    if (!core) return [];
    const factionActive = !core.conditionalFactions?.length || core.conditionalFactions.includes(bakugan.faction);
    const source = { kind: "bakucore" as const, id: core.id, coreType: core.type };
    const result: ContinuousModifier[] = [
      { id: `${core.id}:power`, source, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "power", amount: core.bonus + (factionActive ? core.conditionalBonus ?? 0 : 0), layer: "core", duration: "while-source-active", createdTurn: state.turn, sourceCategory: "bakucore" },
      { id: `${core.id}:damage`, source, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "damage", amount: core.damageBonus + (factionActive ? core.conditionalDamage ?? 0 : 0), layer: "core", duration: "while-source-active", createdTurn: state.turn, sourceCategory: "bakucore" },
    ];
    if (core.frostStrike) result.push({ id: `${core.id}:frost`, source, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, keyword: "FrostStrike", amount: core.frostStrike, layer: "core", duration: "while-source-active", createdTurn: state.turn, sourceCategory: "bakucore" });
    if (core.shadowStrike) result.push({ id: `${core.id}:shadow`, source, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, keyword: "ShadowStrike", amount: 1, layer: "protection", duration: "while-source-active", createdTurn: state.turn, sourceCategory: "bakucore" });
    return result;
  });

  const temporary: ContinuousModifier[] = [
    { id: `${bakugan.id}:legacy-power`, source: { kind: "system", id: "temporary-power" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "power", amount: state.powerBoost[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-damage`, source: { kind: "system", id: "temporary-damage" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, stat: "damage", amount: state.damageBoost[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
    { id: `${bakugan.id}:legacy-frost`, source: { kind: "system", id: "temporary-frost" }, controllerId: owner.id, target: "chosen-bakugan", targetBakuganId: bakugan.id, keyword: "FrostStrike", amount: state.frostStrike[bakugan.id] ?? 0, layer: "temporary", duration: "turn", createdTurn: state.turn, sourceCategory: "temporary" },
  ];

  const storedModifiers = ensureRulesState(state).modifiers.filter((modifier) => !(
    modifier.duration === "while-source-active" && modifier.source.kind === "card"
  ));
  const modifiers = [...coreModifiers, ...activePrintedModifiers(state, owner, bakugan), ...storedModifiers, ...temporary]
    .filter((modifier) => targetMatches(state, modifier, bakugan, owner) && ruleConditionActive(state, owner, modifier.condition, bakugan))
    .sort((left, right) => LAYER_ORDER[left.layer] - LAYER_ORDER[right.layer] || left.id.localeCompare(right.id));

  // Protection is established before reductions are applied, even when the
  // protection modifier appears in a later rules layer.
  shadowStrike ||= modifiers.some((modifier) => modifier.keyword === "ShadowStrike" && modifier.amount > 0);
  doubleStrike ||= modifiers.some((modifier) => modifier.keyword === "DoubleStrike" && modifier.amount > 0);

  for (const modifier of modifiers) {
    const category = modifier.sourceCategory ?? "continuous";
    const record: AppliedModifier = {
      id: modifier.id,
      stat: modifier.keyword === "FrostStrike" ? "frost" : modifier.keyword === "ShadowStrike" ? "shadow" : modifier.keyword === "DoubleStrike" ? "double" : modifier.stat ?? "power",
      amount: modifier.amount,
      layer: modifier.layer,
      sourceCategory: category,
      sourceId: sourceId(modifier),
    };
    if (shadowStrike && modifier.amount < 0 && (modifier.stat === "power" || modifier.stat === "damage")
      && ["card", "bakucore", "temporary", "continuous"].includes(category)) {
      prevented.push(record);
      continue;
    }
    if (modifier.keyword === "FrostStrike") frostStrike += modifier.amount;
    else if (modifier.keyword === "ShadowStrike") shadowStrike ||= modifier.amount > 0;
    else if (modifier.keyword === "DoubleStrike") doubleStrike ||= modifier.amount > 0;
    else if (modifier.stat === "power") power += modifier.amount;
    else if (modifier.stat === "damage") damage += modifier.amount;
    applied.push(record);
  }

  return {
    power: Math.max(0, power),
    damage: Math.max(0, damage),
    frostStrike: Math.max(0, frostStrike),
    shadowStrike,
    doubleStrike,
    applied,
    prevented,
  };
}

export function activeFrostStrike(state: MatchState, sourceId: string) {
  for (const player of state.players) {
    const bakugan = player.bakugan.find((candidate) => candidate.id === sourceId);
    if (bakugan) return evaluateBakuganCharacteristics(state, bakugan, player).frostStrike;
  }
  return 0;
}
