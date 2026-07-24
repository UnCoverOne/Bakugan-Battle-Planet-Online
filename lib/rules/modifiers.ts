import type { Bakugan, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import type { ContinuousModifier, RuleCondition } from "./model";
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

export function ruleConditionActive(state: MatchState, player: PlayerState, condition: RuleCondition | undefined) {
  if (!condition || condition.kind === "always") return true;
  const opponent = opponentOf(state, player);
  switch (condition.kind) {
    case "fury": return player.hand.length === 0;
    case "flow": return player.cardsPlayedThisTurn > 1;
    case "turbo": return Boolean(opponent && player.maxEnergy > opponent.maxEnergy);
    case "domination": return Boolean(opponent && player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0)
      > opponent.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0));
    case "victor": return state.brawlWinner === player.id;
    case "faction": return player.bakugan.some((bakugan) => bakugan.faction === condition.faction);
    case "cards-played": return condition.comparison === "at-least"
      ? player.cardsPlayedThisTurn >= condition.amount
      : player.cardsPlayedThisTurn > condition.amount;
    case "hero-count": return player.heroes.length >= condition.amount;
    case "core-count": {
      const held = player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
      if (condition.relationship === "at-least") return held >= (condition.amount ?? 0);
      const opposing = opponent?.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0) ?? 0;
      return held > opposing;
    }
    case "selection-made": return true;
    case "printed": return false;
  }
}

function targetMatches(state: MatchState, modifier: ContinuousModifier, bakugan: Bakugan, player: PlayerState) {
  if (modifier.targetBakuganId && modifier.targetBakuganId !== bakugan.id) return false;
  if (modifier.controllerId === player.id) return ["active-friendly", "chosen-bakugan", "all-friendly", "self"].includes(modifier.target);
  return ["active-enemy", "all-enemy"].includes(modifier.target);
}

function activePrintedModifiers(state: MatchState, player: PlayerState, bakugan: Bakugan): ContinuousModifier[] {
  const top = bakugan.evoStack.at(-1) ?? bakugan.character;
  const sources = [top, ...player.heroes];
  return sources.flatMap((source) => ruleDefinitionForCard(source).abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .filter((effect): effect is Extract<typeof effect, { kind: "continuous" }> => effect.kind === "continuous")
    .map((effect) => ({
      ...structuredClone(effect.modifier),
      id: `${source.id}:${effect.modifier.id}`,
      source: { kind: "card" as const, instanceId: source.id, catalogId: ruleDefinitionForCard(source).cardId },
      controllerId: player.id,
      createdTurn: state.turn,
      sourceCategory: "continuous" as const,
    })));
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

  const modifiers = [...coreModifiers, ...activePrintedModifiers(state, owner, bakugan), ...ensureRulesState(state).modifiers, ...temporary]
    .filter((modifier) => targetMatches(state, modifier, bakugan, owner) && ruleConditionActive(state, owner, modifier.condition))
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
