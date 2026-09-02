import {
  HEX_CELLS,
  activateIntrinsicReroll,
  alternateWinEffectPending,
  beginCorePlacement,
  cancelCardChoice,
  cardRerollTimingLegal,
  cloneMatch,
  discardToHandLimit,
  energizeCard,
  legalPlacementCells,
  orderTriggers,
  placeCore,
  playerCanActivateIntrinsicReroll,
  prepareCardPlay,
  passPriority,
  recordCardPlayedForTurn,
  resolveRollOutcome,
  revealedFlipCanBePlayed,
  rotationPhaseOpenCell,
  selectBakugan,
  submitCardChoice,
  totalDamage,
  totalPower,
  type Bakugan,
  type CardChoices,
  type Core,
  type GameCard,
  type MatchState,
  type PendingEffect,
  type Placement,
  type RollOutcome,
} from "./game";
import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";
import { activeTappedEnergyIds } from "./rules/costs";
import { flipDamageCard, resolveManualDamage } from "./manualDamage";
import {
  availableRollTargets,
  confirmRoll,
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  selectRollTarget,
} from "./rolling";
import { drawTurnCard, playerCanDrawTurnCard } from "./turnStart";
import {
  buildChoiceSchema,
  schemaHasLegalCompletion,
  type ChoiceField,
  type ChoiceSchema,
  type PendingCardChoice,
} from "./rules/choices";
import {
  compileCardEffect,
  estimateProgramValue,
  type RuleAction,
  type RuleProgram,
} from "./rules/effects";
import { ruleDefinitionForCard } from "./rules/catalogue";
import { canonicalEvoTargetAllowed } from "./rules/identity";
import { evaluateBakuganCharacteristics } from "./rules/modifiers";
import {
  activeCardActionEntries,
  allInstructionLeafActions,
  cardLeafActions,
  estimateRuleActionValue,
  hasNonDeferrablePreRollTiming,
  isTemporaryCombatAction,
  temporaryCombatPotential,
} from "./aiCardSemantics";
import type { GameCommand } from "./engine/types";

const PRIORITY_PHASES = new Set<MatchState["phase"]>([
  "preRoll", "power", "victor", "postDamage", "endPlay",
]);
const ROLL_FORECAST_SAMPLES = 20;

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function opponentOf(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id !== playerId);
}

function topBakuganCard(bakugan: Bakugan) {
  return bakugan.evoStack.at(-1) ?? bakugan.character;
}

function pendingEffectChoices(effect: PendingEffect) {
  const through = effect.instructionIndex ?? 0;
  const resolved = Object.entries(effect.resolvedChoices ?? {})
    .filter(([index]) => Number(index) <= through)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, choices]) => choices);
  return Object.assign({}, effect.choices, ...resolved) as CardChoices;
}

function evoTargetId(choices: CardChoices) {
  return choices.sourceBakuganId ?? choices.targetBakuganId;
}

function projectedEvoTop(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  candidate?: GameCard,
) {
  let top = candidate ?? topBakuganCard(bakugan);
  // A candidate added now resolves before every object already in the Batch.
  // Existing Evo objects then resolve newest-first, so the oldest unresolved
  // Evo for this Bakugan is the final top card and supersedes the candidate.
  for (const effect of [...match.batch].reverse()) {
    const status = (effect as PendingEffect & { status?: string }).status;
    if (
      effect.controllerId !== playerId
      || effect.card.type !== "Evo"
      || effect.negated
      || status === "negated"
      || status === "resolved"
      || evoTargetId(pendingEffectChoices(effect)) !== bakugan.id
    ) continue;
    top = effect.card;
  }
  return top;
}

function characteristicsWithProjectedTop(
  match: MatchState,
  playerId: string,
  bakuganId: string,
  top: GameCard,
) {
  const projected = cloneProjectedMatch(match);
  const owner = playerById(projected, playerId);
  const target = owner?.bakugan.find((bakugan) => bakugan.id === bakuganId);
  if (!owner || !target) return undefined;
  if (top.type === "Character") target.evoStack = [];
  else if (target.evoStack.at(-1)?.id !== top.id) target.evoStack.push(top);
  return evaluateBakuganCharacteristics(projected, target, owner);
}

function isPersistentEvoAction(action: RuleAction) {
  if (action.kind === "continuous") return true;
  if (action.kind === "modify-stat" || action.kind === "grant-keyword") {
    return action.duration === "while-source-active";
  }
  return action.kind === "cost" && action.duration === "while-source-active";
}

function evoInstructionOccursOnPlay(instruction: Parameters<typeof allInstructionLeafActions>[0]) {
  const triggers = allInstructionLeafActions(instruction).filter(
    (action): action is Extract<RuleAction, { kind: "trigger" }> => action.kind === "trigger",
  );
  return !triggers.length || triggers.some((trigger) => (
    trigger.definition.event === "CARD_PLAYED"
    && trigger.definition.relationship === "controller"
    && trigger.definition.source === "self"
  ));
}

function ongoingCardAbilityValue(match: MatchState, card: GameCard) {
  let definition;
  try {
    definition = ruleDefinitionForCard(card);
  } catch {
    return 0;
  }
  const eventWeight: Partial<Record<NonNullable<typeof definition.abilities[number]["trigger"]>["event"], number>> = {
    CARD_PLAYED: 0.65,
    BAKUGAN_SELECTED: 0.4,
    BAKUGAN_OPENED: 0.8,
    CARD_DISCARDED: 0.45,
    VICTOR_DECLARED: 0.6,
    ATTACK_CREATED: 0.7,
    DAMAGE_TAKEN: 0.45,
    HAND_EMPTIED: 0.35,
    TURN_ENDED: 0.45,
  };
  return definition.abilities.reduce((total, ability) => {
    if (ability.kind === "triggered") {
      if (!ability.trigger || (
        ability.trigger.event === "CARD_PLAYED"
        && ability.trigger.source === "self"
      )) return total;
      const payload = ability.instructions.reduce((sum, instruction) => (
        sum + allInstructionLeafActions(instruction)
          .filter((action) => action.kind !== "trigger")
          .reduce((instructionSum, action) => (
            instructionSum + estimateRuleActionValue(action, match)
          ), 0)
      ), 0);
      const conditionalWeight = ability.instructions.some(
        (instruction) => instruction.condition.kind !== "always",
      ) ? 0.7 : 1;
      const optionalWeight = ability.trigger.optional ? 0.85 : 1;
      return total + clamp(payload, -8, 12)
        * (eventWeight[ability.trigger.event] ?? 0.5)
        * conditionalWeight
        * optionalWeight;
    }
    const ongoing = ability.instructions.reduce((sum, instruction) => (
      sum + allInstructionLeafActions(instruction)
        .filter((action) => (
          isPersistentEvoAction(action)
          && action.kind !== "modify-stat"
          && action.kind !== "grant-keyword"
          && action.kind !== "continuous"
        ))
        .reduce((instructionSum, action) => (
          instructionSum + estimateRuleActionValue(action, match)
        ), 0)
    ), 0);
    return total + clamp(ongoing, -8, 12);
  }, 0);
}

/**
 * Durable utility contributed by an Evo becoming the final top card. This is
 * deliberately marginal: replaying the exact top Evo contributes no
 * persistent value, and an older unresolved Evo for the same target can make
 * a newly announced Evo transient and therefore equally valueless.
 */
export function evoMarginalValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  targetBakuganId?: string,
) {
  if (card.type !== "Evo") return 0;
  const player = playerById(match, playerId);
  const target = player?.bakugan.find((bakugan) => bakugan.id === targetBakuganId);
  if (!player || !target) return 0;
  let legal = false;
  try {
    legal = canonicalEvoTargetAllowed(ruleDefinitionForCard(card), target);
  } catch {
    return 0;
  }
  if (!legal) return 0;

  const beforeTop = projectedEvoTop(match, playerId, target);
  const afterTop = projectedEvoTop(match, playerId, target, card);
  if (afterTop.catalogId === beforeTop.catalogId) return 0;
  const before = characteristicsWithProjectedTop(
    match,
    playerId,
    target.id,
    beforeTop,
  );
  const after = characteristicsWithProjectedTop(
    match,
    playerId,
    target.id,
    afterTop,
  );
  if (!before || !after) return 0;
  const raw = (after.power - before.power) * 0.012
    + (after.damage - before.damage) * 0.9
    + (after.frostStrike - before.frostStrike) * 0.55
    + (Number(after.shadowStrike) - Number(before.shadowStrike)) * 1.2
    + (Number(after.doubleStrike) - Number(before.doubleStrike)) * 4
    + ongoingCardAbilityValue(match, afterTop)
    - ongoingCardAbilityValue(match, beforeTop);
  // A real upgrade remains relevant in future Brawls, not only this priority
  // window. The modest upgrade bonus keeps a useful low-stat evolution from
  // being rejected solely because its printed Energy cost is paid up front.
  return raw > 0 ? raw * 1.15 + 0.9 : raw * 1.1;
}

function legalEvoTargets(match: MatchState, playerId: string, card: GameCard) {
  const player = playerById(match, playerId);
  if (!player || card.type !== "Evo") return [];
  try {
    const definition = ruleDefinitionForCard(card);
    return player.bakugan.filter((bakugan) => canonicalEvoTargetAllowed(definition, bakugan));
  } catch {
    return [];
  }
}

function evoImmediatePlayValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
) {
  if (card.type !== "Evo") return 0;
  const player = playerById(match, playerId);
  if (!player) return 0;
  try {
    return activeCardActionEntries(match, playerId, card, choices, { execution: "play" })
      .filter(({ instruction }) => evoInstructionOccursOnPlay(instruction))
      .filter(({ action }) => !isPersistentEvoAction(action))
      .reduce((sum, { action }) => {
        if (action.kind === "draw") {
          return sum + Math.min(action.amount, player.deckCards.length) * 2.4;
        }
        if ((action.kind === "search" || action.kind === "reveal") && !player.deckCards.length) {
          return sum;
        }
        return sum + estimateRuleActionValue(action, match);
      }, 0);
  } catch {
    return 0;
  }
}

function bestEvoPlayBenefit(match: MatchState, playerId: string, card: GameCard) {
  return Math.max(
    0,
    ...legalEvoTargets(match, playerId, card).map((bakugan) => {
      const choices = { sourceBakuganId: bakugan.id } satisfies CardChoices;
      return evoMarginalValue(match, playerId, card, bakugan.id)
        + evoImmediatePlayValue(match, playerId, card, choices);
    }),
  );
}

function printedBakuganValue(bakugan: Bakugan) {
  const top = topBakuganCard(bakugan);
  return (top.bPower ?? bakugan.bPower) * 0.01 + (top.damage ?? bakugan.damage) * 0.9;
}

function coreValueForBakugan(core: Core, bakugan: Bakugan) {
  const conditional = !core.conditionalFactions?.length
    || core.conditionalFactions.includes(bakugan.faction);
  const power = core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0);
  const damage = core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0);
  const fusionPower = bakugan.fused ? core.fusionBonus ?? 0 : 0;
  const fusionDamage = bakugan.fused ? core.fusionDamageBonus ?? 0 : 0;
  const fusionFrost = bakugan.fused ? core.fusionFrostStrike ?? 0 : 0;
  return (power + fusionPower) * 0.01 + (damage + fusionDamage) * 0.9
    + ((core.frostStrike ?? 0) + fusionFrost) * 0.55
    + (core.bakuGearCostReduction ?? 0) * 0.35
    + (core.shadowStrike ? 1.2 : 0);
}

function averageCoreValue(core: Core, bakugan: readonly Bakugan[]) {
  if (!bakugan.length) return core.bonus * 0.01 + core.damageBonus * 0.9;
  return bakugan.reduce((sum, candidate) => sum + coreValueForBakugan(core, candidate), 0)
    / bakugan.length;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type RollForecastSample = {
  outcome: RollOutcome;
  value: number;
  power: number;
  damage: number;
};

type RollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
  samples: RollForecastSample[];
};


type MatchForecastCache = {
  rolls: Map<string, RollForecast>;
  best: Map<string, RollForecast | undefined>;
};

const forecastCacheByMatch = new WeakMap<MatchState, MatchForecastCache>();

function matchForecastCache(match: MatchState) {
  let cache = forecastCacheByMatch.get(match);
  if (!cache) {
    cache = { rolls: new Map(), best: new Map() };
    forecastCacheByMatch.set(match, cache);
  }
  return cache;
}

/**
 * Creates a rules-complete projection while copying only the branches the AI
 * mutates. All other match data stays available by reference for evaluators.
 */
function cloneProjectedMatch(match: MatchState): MatchState {
  return {
    ...match,
    players: match.players.map((player) => ({
      ...player,
      bakugan: player.bakugan.map((bakugan) => ({
        ...bakugan,
        heldCoreCells: [...bakugan.heldCoreCells],
        evoStack: [...bakugan.evoStack],
      })),
    })),
    placements: match.placements.map((placement) => ({ ...placement })),
    selected: { ...match.selected },
    targets: { ...match.targets },
    rolls: { ...match.rolls },
    passes: [...match.passes],
  };
}

function rollCharacteristicsKey(outcome: RollOutcome) {
  return JSON.stringify({
    playerId: outcome.playerId,
    bakuganId: outcome.bakuganId,
    target: outcome.target,
    resolvedTarget: outcome.resolvedTarget,
    result: outcome.result,
    cores: outcome.cores,
    doubleCore: outcome.doubleCore,
    simulationProfileId: outcome.simulationProfileId,
    attempt: outcome.attempt,
    collisionDecisions: outcome.collisionDecisions,
    rerollSequence: outcome.rerollSequence,
    rerollSource: outcome.rerollSource,
  });
}

function projectedRollCharacteristics(
  match: MatchState,
  playerId: string,
  bakuganId: string,
  outcome: RollOutcome,
) {
  if (outcome.result === "miss-closed") {
    return { power: 0, damage: 0, value: -1.25 };
  }
  const projected = cloneProjectedMatch(match);
  const player = playerById(projected, playerId);
  const bakugan = player?.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!player || !bakugan) return { power: 0, damage: 0, value: -1.25 };
  for (const placement of projected.placements) {
    if (placement.attachedTo === bakugan.id) delete placement.attachedTo;
  }
  bakugan.open = true;
  bakugan.heldCoreCells = [...outcome.cores];
  for (const cell of outcome.cores) {
    const placement = projected.placements.find((candidate) => candidate.cell === cell);
    if (placement) placement.attachedTo = bakugan.id;
  }
  projected.rolls[playerId] = outcome;
  const characteristics = evaluateBakuganCharacteristics(projected, bakugan, player);
  return {
    power: characteristics.power,
    damage: characteristics.damage,
    value: characteristics.power * 0.01
      + characteristics.damage * 0.9
      + characteristics.frostStrike * 0.55
      + (characteristics.shadowStrike ? 1.2 : 0)
      + (characteristics.doubleStrike ? characteristics.damage * 0.9 : 0),
  };
}

/**
 * Forecast through the authoritative resolver rather than duplicating roll
 * rules. Twenty stratified samples exactly represent the configured 85/90%
 * Accuracy and 5/10% Double Core profiles.
 */
function forecastRoll(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  target: Placement,
): RollForecast {
  const cache = matchForecastCache(match);
  const cacheKey = `${playerId}:${bakugan.id}:${target.cell}`;
  const cached = cache.rolls.get(cacheKey);
  if (cached) {
    return cached;
  }

  const state = {
    ...match,
    selected: { ...match.selected, [playerId]: bakugan.id },
    targets: { ...match.targets, [playerId]: target.cell },
  };
  const player = playerById(state, playerId)!;
  const primaryCounts = new Map<string, number>();
  const characteristicCache = new Map<string, { power: number; damage: number; value: number }>();
  const seed = stableHash([playerId, bakugan.id, target.cell].join(":"));
  let totalValue = 0;
  let opened = 0;
  let collected = 0;
  const samples: RollForecastSample[] = [];

  for (let sample = 0; sample < ROLL_FORECAST_SAMPLES; sample += 1) {
    const values = [
      sample * 5 + 2,
      (seed + sample * 487) % 10_000,
      sample * 5 + 2,
      (seed * 3 + sample * 3253) % 10_000,
    ];
    let cursor = 0;
    const outcome = resolveRollOutcome(
      state,
      player,
      (maximum) => values[cursor++] % maximum,
    );
    const didOpen = outcome.result !== "miss-closed";
    if (didOpen) opened += 1;
    if (outcome.cores.length) collected += 1;
    const characteristicKey = rollCharacteristicsKey(outcome);
    let characteristics = characteristicCache.get(characteristicKey);
    if (!characteristics) {
      characteristics = projectedRollCharacteristics(
        state,
        playerId,
        bakugan.id,
        outcome,
      );
      characteristicCache.set(characteristicKey, characteristics);
    }
    totalValue += characteristics.value;
    samples.push({
      outcome,
      value: characteristics.value,
      power: characteristics.power,
      damage: characteristics.damage,
    });
    const primary = outcome.cores[0];
    if (primary) primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1);
  }

  const forecast: RollForecast = {
    target,
    value: totalValue / ROLL_FORECAST_SAMPLES,
    openProbability: opened / ROLL_FORECAST_SAMPLES,
    coreProbability: collected / ROLL_FORECAST_SAMPLES,
    primaryProbability: new Map(
      [...primaryCounts].map(([cell, count]) => [cell, count / ROLL_FORECAST_SAMPLES]),
    ),
    samples,
  };
  cache.rolls.set(cacheKey, forecast);
  return forecast;
}

function forecastCollision(a: RollForecast, b: RollForecast | undefined) {
  if (!b) return 0;
  let probability = 0;
  for (const [cell, chance] of a.primaryProbability) {
    probability += chance * (b.primaryProbability.get(cell) ?? 0);
  }
  return probability;
}

function bestForecast(match: MatchState, playerId: string, bakugan: Bakugan) {
  const cache = matchForecastCache(match);
  const cacheKey = `${playerId}:${bakugan.id}`;
  if (cache.best.has(cacheKey)) return cache.best.get(cacheKey);

  const opponent = opponentOf(match, playerId);
  const opponentBakugan = opponent?.bakugan.find(
    (candidate) => candidate.id === match.selected[opponent.id],
  );
  const opponentTarget = opponent && match.targets[opponent.id]
    ? match.placements.find((placement) => placement.cell === match.targets[opponent.id])
    : undefined;
  const opponentForecast = opponent && opponentBakugan && opponentTarget
    ? forecastRoll(match, opponent.id, opponentBakugan, opponentTarget)
    : undefined;

  const best = availableRollTargets(match)
    .map((target) => {
      const forecast = forecastRoll(match, playerId, bakugan, target);
      return {
        ...forecast,
        value: forecast.value
- forecastCollision(forecast, opponentForecast) * 2.5
- (target.cell === opponentTarget?.cell ? 0.25 : 0),
      };
    })
    .sort((a, b) => b.value - a.value || b.openProbability - a.openProbability)[0];
  cache.best.set(cacheKey, best);
  return best;
}

function expectedOpenChance(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const selected = player?.bakugan.find((candidate) => candidate.id === match.selected[playerId]);
  if (!selected) return 0;
  return bestForecast(match, playerId, selected)?.openProbability ?? selected.rollAccuracy / 100;
}

const REROLL_MISS_RECOVERY_VALUE = 4.5;
const MAX_REROLL_COMPONENT_VALUE = 6;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function withoutRerollSuccessInstructions(program: RuleProgram): RuleProgram {
  return {
    ...program,
    instructions: program.instructions.filter(
      (instruction) => instruction.condition.kind !== "reroll-opened",
    ),
  };
}

function repeatableOnOpenValue(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  if (!player) return 0;
  return player.heroes.reduce((sum, hero) => {
    try {
      const program = compileCardEffect(hero);
      const instructions = program.instructions.filter((instruction) => (
        instruction.actions.some((action) => (
          action.kind === "trigger" && action.definition.event === "BAKUGAN_OPENED"
        ))
      ));
      if (!instructions.length) return sum;
      return sum + Math.max(0, estimateProgramValue(
        { ...program, instructions },
        match,
        playerId,
      ));
    } catch {
      return sum;
    }
  }, 0);
}

function rerollSuccessValue(match: MatchState, playerId: string, card: GameCard) {
  try {
    const program = compileCardEffect(card);
    const instructions = program.instructions.filter(
      (instruction) => instruction.condition.kind === "reroll-opened",
    );
    if (!instructions.length) return 0;
    return Math.max(0, estimateProgramValue(
      { ...program, instructions },
      match,
      playerId,
    ));
  } catch {
    return 0;
  }
}

/**
 * Expected optionality of a future self-Reroll on the same utility scale as
 * other card effects. Each sampled initial result is compared with the best
 * forecasted Reroll: misses use the established 4.5 recovery anchor, open
 * results use only expected improvement, and repeated on-open/reroll-success
 * effects are weighted by the Reroll's opening probability.
 */
export function estimateFutureRerollValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  const rerolls = cardLeafActions(card)
    .filter((action): action is Extract<RuleAction, { kind: "reroll" }> => (
      action.kind === "reroll" && action.target === "controller"
    ));
  if (!rerolls.length || !availableRollTargets(match).length) return 0;

  const bakugan = bestBakugan(match, playerId);
  if (!bakugan) return 0;
  const selected = bestForecast(match, playerId, bakugan);
  if (!selected) return 0;
  const initial = forecastRoll(match, playerId, bakugan, selected.target);
  const reroll = forecastRoll(match, playerId, bakugan, selected.target);
  const expectedTriggeredValue = reroll.openProbability * (
    repeatableOnOpenValue(match, playerId)
    + rerollSuccessValue(match, playerId, card)
  );
  const mandatory = rerolls.some((action) => action.mandatory);
  const total = initial.samples.reduce((sum, sample) => {
    const raw = sample.outcome.result === "miss-closed"
      ? REROLL_MISS_RECOVERY_VALUE * reroll.openProbability + expectedTriggeredValue
      : reroll.value - sample.value + expectedTriggeredValue;
    return sum + (mandatory
      ? clamp(raw, -MAX_REROLL_COMPONENT_VALUE, MAX_REROLL_COMPONENT_VALUE)
      : clamp(raw, 0, MAX_REROLL_COMPONENT_VALUE));
  }, 0);
  return total / Math.max(1, initial.samples.length);
}

function prospectiveNegateValue(program: RuleProgram, match: MatchState) {
  return program.instructions
    .flatMap(allInstructionLeafActions)
    .filter((action): action is Extract<RuleAction, { kind: "negate" }> => (
      action.kind === "negate"
    ))
    .reduce((sum, action) => {
      const futureTargetValue = action.cardType === "any" ? 3.2 : 2.6;
      // Replace today's empty-batch penalty with the value of preserving a
      // response for a plausible future priority window.
      return sum + futureTargetValue - estimateRuleActionValue(action, match);
    }, 0);
}

function evaluatedFutureCardValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  includeDeckFlipValue: boolean,
) {
  const printedCost = card.cost === "X" ? 2 : card.cost;
  if (card.type === "Evo") {
    return bestEvoPlayBenefit(match, playerId, card) - printedCost * 0.4;
  }
  try {
    const program = compileCardEffect(card);
    const evaluatedProgram = /\bReroll\b/i.test(card.effect)
      ? withoutRerollSuccessInstructions(program)
      : program;
    let value = estimateProgramValue(evaluatedProgram, match, playerId) - printedCost * 0.4;
    value += prospectiveNegateValue(evaluatedProgram, match);
    if (card.type === "Hero") value += 2.2;
    if ((card.type === "Flip" || card.type === "Flip Hero") && includeDeckFlipValue) value += 3.2;
    return value;
  } catch {
    // A forced discard must never stall because another card cannot be
    // valued. Keep the previous stable fallback for playable cards.
    return printedCost * 0.4
      + (card.type === "Hero" ? 2.2
        : (card.type === "Flip" || card.type === "Flip Hero") && includeDeckFlipValue ? 3.2 : 0);
  }
}

/**
 * A Flip only has functional value while it remains in the deck or is
 * revealed by damage. Once drawn, it cannot be played from hand, so
 * retaining it has no opportunity value for Energize or discard choices.
 */
export function handCardRetentionValue(match: MatchState, playerId: string, card: GameCard) {
  if (card.type === "Flip" || card.type === "Flip Hero") return 0;
  return evaluatedFutureCardValue(match, playerId, card, false);
}

function deckCardFutureValue(match: MatchState, playerId: string, card: GameCard) {
  return evaluatedFutureCardValue(match, playerId, card, true);
}

function actionBaseValue(action: RuleAction) {
  if (action.kind === "modify-stat") {
    return action.amount * (
      action.stat === "power" ? 0.012 : action.stat === "damage" ? 0.9 : 0.65
    );
  }
  if (action.kind === "grant-keyword") return action.keyword === "DoubleStrike" ? 4 : 2.5;
  return 0;
}

function actionTargetsEnemy(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  text: string,
) {
  if (action.kind === "modify-stat" && action.scope === "all-enemy") return true;
  const targetId = choices.targetBakuganId;
  if (targetId) {
    return Boolean(opponentOf(match, playerId)?.bakugan.some((bakugan) => bakugan.id === targetId));
  }
  return /enemy|opposing|opponent(?:'s)?|non-\[[a-z]+\]/i.test(text);
}

function bakuganOwner(match: MatchState, bakuganId: string) {
  return match.players.find((player) => player.bakugan.some((candidate) => candidate.id === bakuganId));
}

function bakuganHasShadowStrike(match: MatchState, bakuganId: string) {
  const owner = bakuganOwner(match, bakuganId);
  const bakugan = owner?.bakugan.find((candidate) => candidate.id === bakuganId);
  return Boolean(owner && bakugan
    && evaluateBakuganCharacteristics(match, bakugan, owner).shadowStrike);
}

function implicitActionTargetId(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  sourceText: string,
) {
  if (action.kind === "modify-stat" && action.targetChoiceId) {
    const selected = choices[action.targetChoiceId];
    if (typeof selected === "string") return selected;
  }
  if (choices.targetBakuganId) return choices.targetBakuganId;
  const targetPlayer = actionTargetsEnemy(match, playerId, choices, action, sourceText)
    ? opponentOf(match, playerId)
    : playerById(match, playerId);
  return targetPlayer?.bakugan.find((bakugan) => bakugan.id === match.selected[targetPlayer.id])?.id
    ?? targetPlayer?.bakugan.find((bakugan) => bakugan.open)?.id
    ?? targetPlayer?.bakugan[0]?.id;
}

function shadowStrikeBlocksReduction(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  sourceText: string,
) {
  if (action.kind !== "modify-stat" || action.amount >= 0
    || (action.stat !== "power" && action.stat !== "damage")) return false;
  const targetId = implicitActionTargetId(match, playerId, choices, action, sourceText);
  return Boolean(targetId && bakuganHasShadowStrike(match, targetId));
}

function cardHasReduciveStatEffect(card: GameCard) {
  return cardLeafActions(card).some((action) => (
    action.kind === "modify-stat"
    && action.amount < 0
    && (action.stat === "power" || action.stat === "damage")
  ));
}

function combatRelevance(
  match: MatchState,
  playerId: string,
  action: RuleAction,
  targetsEnemy: boolean,
) {
  if (action.kind !== "modify-stat" && action.kind !== "grant-keyword") return 1;
  if (action.duration === "while-source-in-play" || action.duration === "next-card") return 1;
  const stat = action.kind === "modify-stat" ? action.stat : (
    action.keyword === "DoubleStrike" || action.keyword === "FrostStrike" ? "damage" : "power"
  );
  if (match.phase === "preRoll") {
    const open = expectedOpenChance(match, playerId);
    return stat === "power" ? open : open * 0.65;
  }
  if (match.phase === "power") return stat === "power" ? 1 : 0.7;
  if (match.phase === "victor") {
    if (stat === "power") return 0;
    const relevantWinner = targetsEnemy ? opponentOf(match, playerId)?.id : playerId;
    return relevantWinner === match.brawlWinner ? 1 : 0;
  }
  return 0;
}


function heldCoreCount(match: MatchState, playerId: string) {
  return playerById(match, playerId)?.bakugan.reduce(
    (sum, bakugan) => sum + bakugan.heldCoreCells.length,
    0,
  ) ?? 0;
}

function heldCoreStrategicValue(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  if (!player) return 0;
  return player.bakugan.reduce((sum, bakugan) => (
    sum + bakugan.heldCoreCells.reduce((coreSum, cell) => {
      const placement = match.placements.find((candidate) => candidate.cell === cell);
      return coreSum + (placement
        ? Math.max(0, coreValueForBakugan(placement.core, bakugan))
        : 0);
    }, 0)
  ), 0);
}

/**
 * Preserve the expected defensive value of Domination using only remaining
 * deck composition. Hidden deck order is never inspected.
 */
function dominationFlipReserveValue(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  if (!player || !opponent || !player.deckCards.length) return 0;
  if (heldCoreCount(match, playerId) <= heldCoreCount(match, opponent.id)) return 0;
  const capacity = currentEnergyCapacity(match, playerId);
  const candidates = player.deckCards.filter((card) => (
    (card.type === "Flip" || card.type === "Flip Hero")
    && /\bDomination\b/i.test(card.effect)
    && card.cost !== "X"
    && card.cost <= capacity
  ));
  if (!candidates.length) return 0;
  const density = candidates.length / player.deckCards.length;
  return Math.min(2.5, 0.5 + density * 5 + Math.min(1, candidates.length * 0.25));
}

function rerollBrawlStateUtility(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  const roll = match.rolls[playerId];
  if (!player || !opponent || !roll) return -9;
  const opponentRoll = match.rolls[opponent.id];
  const participates = roll.result !== "miss-closed";
  const opponentParticipates = Boolean(
    opponentRoll && opponentRoll.result !== "miss-closed",
  );
  const own = match.victorByDamage
    ? totalDamage(match, playerId)
    : totalPower(match, playerId);
  const enemy = match.victorByDamage
    ? totalDamage(match, opponent.id)
    : totalPower(match, opponent.id);
  const gap = own - enemy;
  let value = !participates ? -9
    : !opponentParticipates ? 8
      : gap > 0 ? 8
        : gap === 0 ? -1
          : -8;
  value += clamp(gap / 400, -2.5, 2.5);
  value += heldCoreStrategicValue(match, playerId) * 0.25;
  value += heldCoreCount(match, playerId) * 0.35;
  value += dominationFlipReserveValue(match, playerId);
  return value;
}

function projectedControllerRerollValue(
  match: MatchState,
  playerId: string,
  mandatory: boolean,
  sourceCard?: GameCard,
) {
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  const roll = match.rolls[playerId];
  const bakugan = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  if (!player || !opponent || !roll || !bakugan || !availableRollTargets(match).length) {
    return mandatory ? -1.5 : 0;
  }
  const forecast = bestForecast(match, playerId, bakugan);
  if (!forecast?.samples.length) return mandatory ? -1.5 : 0;

  const currentUtility = rerollBrawlStateUtility(match, playerId);
  const repeatedOpenValue = Math.max(0, repeatableOnOpenValue(match, playerId));
  const sourceRerollSuccessValue = sourceCard
    ? Math.max(0, rerollSuccessValue(match, playerId, sourceCard))
    : 0;
  let totalDelta = 0;
  for (const sample of forecast.samples) {
    const projected = cloneMatch(match);
    applyProjectedRollSample(projected, playerId, sample);
    let projectedUtility = rerollBrawlStateUtility(projected, playerId);
    if (sample.outcome.result !== "miss-closed") {
      projectedUtility += repeatedOpenValue + sourceRerollSuccessValue;
    }
    totalDelta += projectedUtility - currentUtility;
  }
  return clamp(totalDelta / forecast.samples.length, -12, 12);
}

function negateTarget(match: MatchState, playerId: string, program: RuleProgram) {
  const negate = program.instructions.flatMap((instruction) => instruction.actions)
    .find((action): action is Extract<RuleAction, { kind: "negate" }> => action.kind === "negate");
  if (!negate) return undefined;
  return match.batch.filter((effect) => (
    !effect.negated && (negate.cardType === "any" || effect.card.type === negate.cardType)
  )).at(-1);
}

function negateValue(match: MatchState, playerId: string, program: RuleProgram) {
  const target = negateTarget(match, playerId, program);
  if (!target || target.controllerId === playerId) return -8;
  const targetValue = estimateProgramValue(
    compileCardEffect(target.card, target.effect ?? target.card.effect),
    match,
    target.controllerId,
    target.choices,
  );
  const cost = target.card.cost === "X" ? target.choices.xValue ?? 0 : target.card.cost;
  return 4.5 + Math.max(0, targetValue) * 0.55 + cost * 0.35;
}

function brawlCurrentlyWon(match: MatchState, playerId: string) {
  const opponent = opponentOf(match, playerId);
  const roll = match.rolls[playerId];
  const opponentRoll = opponent ? match.rolls[opponent.id] : undefined;
  if (!opponent || !roll || roll.result === "miss-closed") return false;
  if (!opponentRoll || opponentRoll.result === "miss-closed") return true;
  const own = match.victorByDamage
    ? totalDamage(match, playerId)
    : totalPower(match, playerId);
  const enemy = match.victorByDamage
    ? totalDamage(match, opponent.id)
    : totalPower(match, opponent.id);
  return own > enemy;
}

function winningBrawlResourceConservationPenalty(
  match: MatchState,
  playerId: string,
  card: GameCard,
  entries: ReturnType<typeof activeCardActionEntries>,
  printedCost: number,
) {
  if (match.phase !== "power" || card.type !== "Action" || !brawlCurrentlyWon(match, playerId)) {
    return 0;
  }
  const hasDurableOrAttackPayoff = entries.some(({ action, sourceText }) => {
    if (["move", "search", "play", "energize", "generate-energy", "recharge-energy", "copy", "negate", "prevention"].includes(action.kind)) {
      return true;
    }
    if (action.kind === "modify-stat" && action.stat === "damage") {
      return !actionTargetsEnemy(match, playerId, {}, action, sourceText)
        && action.amount > 0;
    }
    if (action.kind === "grant-keyword") {
      return !actionTargetsEnemy(match, playerId, {}, action, sourceText)
        && (action.keyword === "DoubleStrike" || action.keyword === "FrostStrike");
    }
    if (action.kind === "attack") return action.amount > 0;
    return action.kind === "continuous";
  });
  if (hasDurableOrAttackPayoff) return 0;
  return 0.45 + Math.min(1.2, Math.max(0, printedCost) * 0.25);
}

function hasEligibleAttacker(
  match: MatchState,
  playerId: string,
  action: Extract<RuleAction, { kind: "attack" }>,
) {
  const player = playerById(match, playerId);
  return Boolean(player?.bakugan.some((bakugan) => (
    bakugan.open && (!action.faction || bakugan.faction === action.faction)
  )));
}

function rechargeEnergyValue(
  match: MatchState,
  playerId: string,
  action: Extract<RuleAction, { kind: "recharge-energy" }>,
) {
  const player = playerById(match, playerId);
  if (!player) return 0;
  const uncharged = activeTappedEnergyIds(player, match.turn).length;
  const amount = action.amount === "all" ? uncharged : Math.min(uncharged, action.amount);
  return amount * 1.6;
}

function temporaryPowerChangesVictor(
  match: MatchState,
  playerId: string,
) {
  if (match.phase !== "power" || match.victorByDamage) return true;
  const opponent = opponentOf(match, playerId);
  const playerRoll = match.rolls[playerId];
  const opponentRoll = opponent ? match.rolls[opponent.id] : undefined;
  if (!opponent || !playerRoll || playerRoll.result === "miss-closed") return true;
  if (!opponentRoll || opponentRoll.result === "miss-closed") return false;
  return totalPower(match, playerId) <= totalPower(match, opponent.id);
}

function isTemporaryPowerAction(action: RuleAction) {
  return isTemporaryCombatAction(action)
    && (action.kind === "modify-stat" || action.kind === "set-stat")
    && action.stat === "power";
}

function cardValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  const program = compileCardEffect(card);
  const printedCost = card.cost === "X" ? choices.xValue ?? 0 : card.cost;
  const resolving = cloneMatch(match);
  const resolvingPlayer = playerById(resolving, playerId);
  if (resolvingPlayer) recordCardPlayedForTurn(resolvingPlayer, card, resolving.turn);
  const entries = activeCardActionEntries(
    resolving,
    playerId,
    card,
    choices,
    { execution: "play" },
  ).filter(({ instruction }) => card.type !== "Evo" || evoInstructionOccursOnPlay(instruction));
  const powerChangesVictor = temporaryPowerChangesVictor(match, playerId);
  let value = entries.reduce((sum, entry) => {
    if (card.type === "Evo" && isPersistentEvoAction(entry.action)) return sum;
    if (card.type === "Evo" && entry.action.kind === "draw") {
      return sum + Math.min(entry.action.amount, resolvingPlayer?.deckCards.length ?? 0) * 2.4;
    }
    if (
      card.type === "Evo"
      && (entry.action.kind === "search" || entry.action.kind === "reveal")
      && !resolvingPlayer?.deckCards.length
    ) return sum;
    if (
      entry.action.kind === "attack"
      && !hasEligibleAttacker(resolving, playerId, entry.action)
    ) return sum;
    if (isTemporaryPowerAction(entry.action) && !powerChangesVictor) return sum;
    if (entry.action.kind === "recharge-energy") {
      return sum + rechargeEnergyValue(resolving, playerId, entry.action);
    }
    return sum + estimateRuleActionValue(entry.action, resolving);
  }, 0) - printedCost * 0.72;
  for (const { instruction, action } of entries) {
    if (card.type === "Evo" && isPersistentEvoAction(action)) continue;
    if (isTemporaryPowerAction(action) && !powerChangesVictor) continue;
    const raw = actionBaseValue(action);
    if (raw) {
      const targetsEnemy = actionTargetsEnemy(
        match, playerId, choices, action, instruction.sourceText,
      );
      const blocked = shadowStrikeBlocksReduction(
        match,
        playerId,
        choices,
        action,
        instruction.sourceText,
      );
      const strategic = blocked ? 0 : raw * (targetsEnemy ? -1 : 1);
      value += strategic * combatRelevance(match, playerId, action, targetsEnemy) - raw;
    }
    if (action.kind === "negate") {
      value += negateValue(match, playerId, program) - (match.batch.length ? 5 : -3);
    }
    if (action.kind === "reroll" && match.phase === "power") {
      if (action.target === "controller") {
        const rerollValue = projectedControllerRerollValue(
          match,
          playerId,
          action.mandatory,
          card,
        );
        value += action.mandatory ? rerollValue : Math.max(0, rerollValue);
      } else {
        const targetId = opponentOf(match, playerId)?.id;
        const roll = targetId ? match.rolls[targetId] : undefined;
        if (roll) value += roll.result === "miss-closed" ? -1.5 : 4.5;
      }
    }
  }
  const immediateDrawAmount = entries.reduce((sum, entry) => (
    sum + (entry.action.kind === "draw" ? entry.action.amount : 0)
  ), 0);
  // Playing an Action already spends one card. Treat its first draw as
  // replacement/card selection instead of full card advantage.
  if (match.phase === "power" && card.type === "Action" && immediateDrawAmount > 0) {
    value -= Math.min(1, immediateDrawAmount) * 1.8;
  }
  value -= winningBrawlResourceConservationPenalty(
    match,
    playerId,
    card,
    entries,
    printedCost,
  );
  if (card.type === "Hero") value += 2.4 + Math.max(0, 4 - match.turn) * 0.35;
  if (card.type === "Evo") {
    value += evoMarginalValue(match, playerId, card, evoTargetId(choices));
  }
  if (card.type === "Flip" || card.type === "Flip Hero") value += match.pendingDamage > 0 ? 5 : -10;
  return value;
}

function setChoice(choices: CardChoices, field: ChoiceField, values: string[]) {
  if (
    field.id === "discardCardIds"
    || field.id === "handCardIds"
    || field.id === "targetEnergyIds"
    || field.id === "orderedCardIds"
  ) {
    Object.assign(choices, { [field.id]: values });
  } else if (field.id === "xValue") choices.xValue = Number(values[0] ?? 0);
  else if (field.id === "confirmed") choices.confirmed = values[0] !== "no";
  else Object.assign(choices, { [field.id]: values[0] });
}

function effectPolarity(card: GameCard) {
  let value = 0;
  for (const action of cardLeafActions(card)) {
    if (action.kind === "modify-stat") value += action.amount;
    else if (action.kind === "grant-keyword") value += 200;
    else if (action.kind === "move") {
      if (["destroy", "remove", "retract"].includes(action.verb)) value -= 300;
      else if (["attach", "control"].includes(action.verb)) value += 250;
    }
  }
  if (/destroy|retract|remove|discard/i.test(card.effect)) value -= 150;
  if (/attach|grant|gets? \+|have \+/i.test(card.effect)) value += 150;
  return Math.sign(value);
}

function objectUtilityForChooser(
  ownerId: string | undefined,
  chooserId: string,
  polarity: number,
  strength: number,
) {
  const ownedByChooser = ownerId === chooserId;
  if (polarity < 0) return ownedByChooser ? -strength : strength;
  if (polarity > 0) return ownedByChooser ? strength : -strength;
  return ownedByChooser ? strength * 0.25 : -strength * 0.25;
}

function sacrificedCardBenefit(card: GameCard) {
  return cardLeafActions(card)
    .filter((action) => action.kind === "modify-stat" && action.scale === "sacrificed-card")
    .reduce((sum, action) => sum + Math.abs(actionBaseValue(action)), 0);
}

function optionalEffectValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  sourceText: string,
) {
  let entries: ReturnType<typeof activeCardActionEntries>;
  try {
    const normalized = sourceText.trim().toLowerCase();
    entries = activeCardActionEntries(
      match,
      playerId,
      card,
      {},
      { execution: "all" },
    ).filter((entry) => {
      const candidate = entry.sourceText.trim().toLowerCase();
      return candidate === normalized || normalized.includes(candidate);
    });
  } catch {
    return -0.25;
  }
  if (!entries.length) return -0.25;
  let value = 0;
  for (const { action, sourceText: actionText } of entries) {
    if (action.kind === "reroll" && match.phase === "power") {
      if (action.target === "controller") {
        value += projectedControllerRerollValue(
          match,
          playerId,
          action.mandatory,
          card,
        );
      } else {
        const targetId = opponentOf(match, playerId)?.id;
        const targetRoll = targetId ? match.rolls[targetId] : undefined;
        if (targetRoll) value += targetRoll.result === "miss-closed" ? -1.5 : 4.5;
      }
      continue;
    }
    if (action.kind === "negate") {
      value += negateValue(match, playerId, compileCardEffect(card));
      continue;
    }
    if (action.kind === "recharge-energy") {
      value += rechargeEnergyValue(match, playerId, action);
      continue;
    }
    const raw = actionBaseValue(action);
    if (raw) {
      const targetsEnemy = actionTargetsEnemy(
        match,
        playerId,
        {},
        action,
        actionText,
      );
      const blocked = shadowStrikeBlocksReduction(
        match,
        playerId,
        {},
        action,
        actionText,
      );
      value += (blocked ? 0 : raw * (targetsEnemy ? -1 : 1))
        * combatRelevance(match, playerId, action, targetsEnemy);
      continue;
    }
    value += estimateRuleActionValue(action, match);
  }
  return value;
}

function optionScore(
  match: MatchState,
  controllerId: string,
  chooserId: string,
  card: GameCard,
  field: ChoiceField,
  id: string,
  sourceText = card.effect,
) {
  const controller = playerById(match, controllerId)!;
  const chooser = playerById(match, chooserId)!;
  const opponent = opponentOf(match, chooserId)!;
  const option = field.options.find((candidate) => candidate.id === id);
  const polarity = effectPolarity(card);

  if (field.kind === "bakugan") {
    const owner = match.players.find((player) => player.bakugan.some(
      (candidate) => candidate.id === id,
    ));
    const bakugan = owner?.bakugan.find((candidate) => candidate.id === id);
    if (!bakugan) return -100;
    if (
      card.type === "Evo"
      && (field.id === "sourceBakuganId" || field.label === "Choose the matching Character")
    ) {
      return evoMarginalValue(match, controllerId, card, bakugan.id);
    }
    if (owner?.id !== controllerId
      && cardHasReduciveStatEffect(card)
      && bakuganHasShadowStrike(match, bakugan.id)) return -100;
    const strength = printedBakuganValue(bakugan) + bakugan.heldCoreCells.length * 1.2;
    return objectUtilityForChooser(owner?.id, chooserId, polarity, strength);
  }
  if (field.kind === "hero") {
    const owner = match.players.find((player) => player.heroes.some((hero) => hero.id === id));
    const hero = owner?.heroes.find((candidate) => candidate.id === id);
    const strength = hero
      ? (hero.cost === "X" ? 0 : hero.cost) + Math.max(0, estimateProgramValue(
        compileCardEffect(hero), match, owner?.id ?? controllerId,
      ))
      : 0;
    return objectUtilityForChooser(owner?.id ?? option?.ownerId, chooserId, polarity, strength);
  }
  if (field.kind === "evo") {
    const owner = match.players.find((player) => player.bakugan.some(
      (bakugan) => bakugan.evoStack.some((evo) => evo.id === id),
    ));
    const evo = owner?.bakugan.flatMap((bakugan) => bakugan.evoStack)
      .find((candidate) => candidate.id === id);
    const strength = (evo?.bPower ?? 0) * 0.01 + (evo?.damage ?? 0) * 0.9;
    return objectUtilityForChooser(owner?.id ?? option?.ownerId, chooserId, polarity, strength);
  }
  if (field.kind === "energy") {
    if (/\brecharge\b/i.test(card.effect)) return option?.ownerId === chooserId ? 1.5 : -1.5;
    return option?.ownerId === chooserId ? -1 : 1;
  }
  if (field.kind === "core") {
    const placement = match.placements.find((candidate) => candidate.cell === id);
    const target = chooser.bakugan.find(
      (bakugan) => bakugan.id === match.selected[chooserId],
    ) ?? chooser.bakugan[0];
    const coreValue = placement && target ? coreValueForBakugan(placement.core, target) : 0;
    if (/attach/i.test(card.effect)) return coreValue;
    const strength = Math.abs(coreValue);
    return objectUtilityForChooser(option?.ownerId, chooserId, polarity, strength);
  }
  if (field.kind === "hand-cards") {
    const owner = match.players.find((player) => player.hand.some(
      (candidate) => candidate.id === id,
    ));
    const selected = owner?.hand.find((candidate) => candidate.id === id);
    if (!selected) return -100;
    const future = handCardRetentionValue(match, owner?.id ?? chooserId, selected);
    if (/play a card from your hand for free/i.test(card.effect)) {
      return owner?.id === chooserId ? future : -future;
    }
    if (/sacrifice/i.test(card.effect)) {
      const rerollBenefit = /\bReroll\b/i.test(card.effect)
        && match.phase === "power"
        && match.rolls[controllerId]?.result === "miss-closed"
        ? 6
        : 0;
      return sacrificedCardBenefit(card) + rerollBenefit - future;
    }
    if (/discard|shuffle .*from your hand/i.test(card.effect)) return -future;
    return future;
  }
  if (field.kind === "deck-card" || field.kind === "deck-order") {
    const selected = controller.deckCards.find((candidate) => candidate.id === id);
    return selected ? deckCardFutureValue(match, controllerId, selected) : -100;
  }
  if (field.kind === "number") {
    const amount = Number(id);
    const available = Math.max(controller.energyZone.length, controller.energy);
    if (amount > available) return -amount;
    return cardValue(match, controllerId, card, { xValue: amount }) - amount * 0.12;
  }
  if (field.kind === "mode") {
    const controllerOpponent = opponentOf(match, controllerId);
    const powerGap = totalPower(match, controllerId)
      - totalPower(match, controllerOpponent?.id ?? "");
    let controllerScore = 0;
    if (id === "power") {
      controllerScore = match.phase === "power" && powerGap < 0 ? 5
        : match.phase === "preRoll" ? 2 : 0;
    } else if (id === "damage") {
      controllerScore = match.phase === "victor" && match.brawlWinner === controllerId ? 5
        : match.phase === "power" && powerGap >= 0 ? 4
          : match.phase === "preRoll" ? 1.5 : 0;
    } else if (id === "yes") {
      controllerScore = cardValue(match, controllerId, card) > 0 ? 3 : -3;
    } else if (id === "no") {
      controllerScore = cardValue(match, controllerId, card) > 0 ? -3 : 3;
    }
    return chooserId === controllerId ? controllerScore : -controllerScore;
  }
  if (field.kind === "player") {
    const targetIsChooser = id === chooserId;
    if (polarity < 0) return targetIsChooser ? -3 : 3;
    if (polarity > 0) return targetIsChooser ? 3 : -3;
    return id === opponent.id ? 1 : 0;
  }
  if (field.kind === "confirm") {
    const marginal = optionalEffectValue(match, controllerId, card, sourceText);
    const controllerScore = id === "yes"
      ? marginal - 0.15
      : id === "no" ? 0 : -1;
    return chooserId === controllerId ? controllerScore : -controllerScore;
  }
  return 0;
}

function chooseChoicesFromSchema(
  match: MatchState,
  controllerId: string,
  card: GameCard,
  schema: ChoiceSchema,
  chooserId: string,
  sourceText = card.effect,
): CardChoices {
  const choices: CardChoices = {};
  for (const field of schema.fields.filter((candidate) => candidate.chooserId === chooserId)) {
    const scores = new Map(field.options.map((option) => [
      option.id,
      optionScore(match, controllerId, chooserId, card, field, option.id, sourceText),
    ]));
    const ranked = [...field.options].sort(
      (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0),
    );
    let count = field.minimum;
    if (field.maximum > field.minimum) {
      count = Math.max(
        field.minimum,
        Math.min(
          field.maximum,
          ranked.filter((candidate) => (scores.get(candidate.id) ?? 0) > 0).length,
        ),
      );
    }
    if (!count && ["number", "mode", "confirm"].includes(field.kind)) count = 1;
    setChoice(choices, field, ranked.slice(0, count).map((candidate) => candidate.id));
  }
  return choices;
}

export function chooseCardChoices(
  match: MatchState,
  playerId: string,
  card: GameCard,
  chooserId = playerId,
): CardChoices {
  return chooseChoicesFromSchema(
    match,
    playerId,
    card,
    buildChoiceSchema(match, playerId, card),
    chooserId,
  );
}

function allCards(match: MatchState) {
  return match.players.flatMap((player) => [
    ...player.hand,
    ...player.deckCards,
    ...player.discard,
    ...player.energyZone,
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
  ]);
}

function pendingSource(
  match: MatchState,
  pending: PendingCardChoice,
): { card: GameCard; sourceText: string } | undefined {
  const exact = pending.pendingEffectId
    ? match.batch.find((effect) => effect.id === pending.pendingEffectId)
    : undefined;
  const effects: PendingEffect[] = [
    ...(exact ? [exact] : []),
    ...match.batch.filter((effect) => effect.card.id === pending.cardId),
    ...match.triggerOrders.flatMap((request) => request.triggers)
      .filter((effect) => effect.card.id === pending.cardId),
  ];
  const effect = effects[0];
  const card = effect?.card
    ?? allCards(match).find((candidate) => candidate.id === pending.cardId)
    ?? (match.revealedFlip?.id === pending.cardId ? match.revealedFlip : undefined);
  if (!card) return undefined;
  const instruction = effect && pending.instructionIndex != null
    ? compileCardEffect(effect.card, effect.effect ?? effect.card.effect)
      .instructions[pending.instructionIndex]
    : undefined;
  return {
    card,
    sourceText: instruction?.sourceText ?? effect?.effect ?? card.effect,
  };
}

function fallbackChoiceCard(pending: PendingCardChoice): GameCard {
  return {
    id: pending.cardId,
    catalogId: pending.cardId,
    number: 0,
    name: pending.schema.sourceName,
    displayName: pending.schema.sourceName,
    faction: "Aquos",
    factions: [],
    type: "Action",
    cost: 0,
    rarity: "",
    effect: pending.kind === "forced-discard" ? "discard cards" : "",
    mechanics: [],
    bPower: null,
    damage: null,
    coreTypes: [],
    evolvesFrom: null,
    art: "",
  };
}

type EnergyGoalSource = "hand-card" | "hand-combo" | "deck" | "development";
type EnergyGoal = {
  source: EnergyGoalSource;
  score: number;
  cardIds: string[];
  targetCost: number;
};
type EnergyCardAnalysis = {
  card: GameCard;
  cost: number;
  value: number;
  playLikelihood: number;
  affordableNow: boolean;
  tacticalReserveValue: number;
};
export type OpponentEnergizePlan = {
  shouldEnergize: boolean;
  cardId?: string;
  reason: "reachable-hand-card" | "reachable-hand-combo" | "probable-deck-card"
    | "early-energy-development" | "no-energy-goal" | "no-expendable-card";
  goalSource?: EnergyGoalSource;
  goalCardIds?: string[];
  goalScore?: number;
  currentCapacity?: number;
  targetCapacity?: number;
  developmentBenefit?: number;
  skipValue?: number;
  protectedCardIds?: string[];
  candidates?: Array<{
    cardId: string;
    tier: number;
    opportunityCost: number;
    counterfactualValue?: number;
    protected: boolean;
  }>;
};

function currentEnergyCapacity(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)! as typeof match.players[number] & {
    tappedEnergyIds?: string[];
    energyTapTurn?: number;
  };
  if (player.energyTapTurn !== match.turn) return player.energyZone.length;
  const tapped = new Set(player.tappedEnergyIds ?? []);
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id)).length;
  return Math.max(0, Math.floor(player.energy)) + untapped;
}

function futurePriorityProjection(match: MatchState, playerId: string) {
  const projected = cloneProjectedMatch(match);
  projected.phase = "power";
  projected.stepLabel = "Brawl Phase • Power Step";
  projected.priority = playerId;
  projected.passes = [];
  for (const player of projected.players) {
    const selected = player.bakugan.find((bakugan) => (
      bakugan.id === projected.selected[player.id]
    )) ?? player.bakugan[0];
    if (!selected) continue;
    projected.selected[player.id] = selected.id;
    selected.open = true;
  }
  return projected;
}

function futurePlayLikelihood(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
  zone: "hand" | "deck",
) {
  if (card.type === "Character") return 0;
  if (card.type === "Flip" || card.type === "Flip Hero") return zone === "deck" ? 0.42 : 0;
  try {
    if (cardLeafActions(card).some((action) => (
      action.kind === "negate" || action.kind === "prevention"
    ))) return 0.75;
    if (!schemaHasLegalCompletion(buildChoiceSchema(match, playerId, card))) return 0;
  } catch {
    return 0.2;
  }
  if (card.type === "Evo") {
    const targetId = evoTargetId(choices);
    if (!targetId) return 0;
    const durable = evoMarginalValue(match, playerId, card, targetId);
    const immediate = evoImmediatePlayValue(match, playerId, card, choices);
    if (durable + immediate < 0.5) return 0;
  }
  if (/\b(?:Flow|Fury|Turbo|Domination|Victor)\b|\bif\b/i.test(card.effect)) return 0.65;
  return 1;
}

function analyzeEnergyCard(
  match: MatchState,
  playerId: string,
  card: GameCard,
  capacity: number,
  zone: "hand" | "deck",
): EnergyCardAnalysis {
  const planningMatch = futurePriorityProjection(match, playerId);
  let choices: CardChoices = {};
  try { choices = chooseCardChoices(planningMatch, playerId, card); } catch { choices = {}; }
  let cost = card.cost === "X" ? Math.max(1, capacity) : card.cost;
  try {
    cost = cardEnergyPaymentState(planningMatch, playerId, card, choices)?.cost ?? cost;
  } catch {
    // Keep the printed planning cost when a future conditional choice is not
    // constructible. Its reduced likelihood handles uncertainty.
  }
  return {
    card,
    cost,
    value: (zone === "hand"
      ? handCardRetentionValue(planningMatch, playerId, card)
      : deckCardFutureValue(planningMatch, playerId, card))
      + estimateFutureRerollValue(match, playerId, card),
    playLikelihood: futurePlayLikelihood(planningMatch, playerId, card, choices, zone),
    affordableNow: cost <= capacity,
    tacticalReserveValue: zone === "hand"
      ? temporaryCombatPotential(card) * 0.45
      : 0,
  };
}

function comboSynergy(a: GameCard, b: GameCard) {
  let value = a.faction === b.faction ? 0.25 : 0;
  const text = `${a.effect} ${b.effect}`;
  if (/Flow|play .*free|cost .*less|Draw|Energize/i.test(text)) value += 0.5;
  return value;
}

function handEnergyGoals(analyses: EnergyCardAnalysis[], capacity: number) {
  const goals: EnergyGoal[] = [];
  for (const analysis of analyses) {
    const shortfall = analysis.cost - capacity;
    if (
      analysis.playLikelihood <= 0
      || shortfall <= 0
      || shortfall > 2
      || analysis.value < 0.75
    ) continue;
    const reachability = shortfall === 1 ? 1 : 0.62;
    const score = Math.max(0, analysis.value) * analysis.playLikelihood * reachability;
    if (score >= 1.1) goals.push({
      source: "hand-card",
      score,
      cardIds: [analysis.card.id],
      targetCost: analysis.cost,
    });
  }

  const comboPieces = analyses.filter((analysis) => (
    analysis.playLikelihood > 0 && analysis.cost > 0 && analysis.value > 0.35
  ));
  for (let left = 0; left < comboPieces.length; left += 1) {
    for (let right = left + 1; right < comboPieces.length; right += 1) {
      const a = comboPieces[left];
      const b = comboPieces[right];
      const targetCost = a.cost + b.cost;
      const shortfall = targetCost - capacity;
      if (shortfall <= 0 || shortfall > 2) continue;
      const reachability = shortfall === 1 ? 1 : 0.62;
      const likelihood = Math.min(a.playLikelihood, b.playLikelihood);
      const score = (
        Math.max(0, a.value) + Math.max(0, b.value) + comboSynergy(a.card, b.card)
      ) * likelihood * reachability * 0.5;
      if (score >= 1.35) goals.push({
        source: "hand-combo",
        score,
        cardIds: [a.card.id, b.card.id],
        targetCost,
      });
    }
  }
  return goals;
}

function drawAtLeastOneProbability(deckSize: number, copies: number, draws: number) {
  if (deckSize <= 0 || copies <= 0 || draws <= 0) return 0;
  let miss = 1;
  const attempts = Math.min(deckSize, draws);
  for (let index = 0; index < attempts; index += 1) {
    miss *= Math.max(0, deckSize - copies - index) / Math.max(1, deckSize - index);
  }
  return 1 - miss;
}

function deckEnergyGoals(match: MatchState, playerId: string, capacity: number) {
  const player = playerById(match, playerId)!;
  const grouped = new Map<string, GameCard[]>();
  for (const card of player.deckCards) {
    const cards = grouped.get(card.catalogId) ?? [];
    cards.push(card);
    grouped.set(card.catalogId, cards);
  }
  const goals: EnergyGoal[] = [];
  for (const cards of grouped.values()) {
    const analysis = analyzeEnergyCard(match, playerId, cards[0], capacity, "deck");
    const shortfall = analysis.cost - capacity;
    if (analysis.playLikelihood <= 0 || shortfall <= 0 || shortfall > 3) continue;
    const drawHorizon = Math.min(3, shortfall + 1);
    const probability = drawAtLeastOneProbability(
      player.deckCards.length,
      cards.length,
      drawHorizon,
    );
    const reachability = shortfall === 1 ? 1 : shortfall === 2 ? 0.62 : 0.28;
    const score = probability
      * Math.max(0, analysis.value)
      * analysis.playLikelihood
      * reachability
      * 0.35;
    if (score >= 0.32) goals.push({
      source: "deck",
      score,
      cardIds: cards.map((card) => card.id),
      targetCost: analysis.cost,
    });
  }
  return goals;
}

function developmentDemandScore(analysis: EnergyCardAnalysis, capacity: number) {
  if (
    (analysis.card.type === "Flip" || analysis.card.type === "Flip Hero")
    || analysis.card.type === "Character"
    || analysis.cost <= capacity
    || analysis.cost > 3
  ) return 0;
  // A context-dependent Action still creates capacity demand even when the
  // representative Power window cannot currently construct its targets.
  const prospectiveLikelihood = Math.max(0.45, analysis.playLikelihood);
  const proximity = analysis.cost === capacity + 1 ? 1 : 0.62;
  return (0.9 + Math.max(0, analysis.value) * 0.22) * prospectiveLikelihood * proximity;
}

function developmentGoal(
  analyses: EnergyCardAnalysis[],
  capacity: number,
): EnergyGoal | undefined {
  if (capacity >= 3 || analyses.length < 2) return;
  const demand = analyses
    .map((analysis) => ({ analysis, score: developmentDemandScore(analysis, capacity) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || a.analysis.cost - b.analysis.cost
      || a.analysis.card.id.localeCompare(b.analysis.card.id)
    ));
  const hasStrandedFodder = analyses.some((analysis) => (
    (analysis.card.type === "Flip" || analysis.card.type === "Flip Hero")
    || analysis.card.type === "Character"
    || analysis.playLikelihood <= 0
  ));
  const hasDuplicate = analyses.some((analysis, index) => (
    analyses.findIndex((candidate) => candidate.card.catalogId === analysis.card.catalogId) !== index
  ));
  if (!demand.length) return;
  if (capacity === 0 && demand.length < 2 && !hasStrandedFodder) return;
  if (capacity === 2 && analyses.length < 3 && !hasStrandedFodder && !hasDuplicate) return;
  const protectedCard = demand[0].analysis;
  return {
    source: "development",
    score: 2.8 + demand.reduce((sum, candidate) => sum + candidate.score, 0),
    cardIds: [protectedCard.card.id],
    targetCost: Math.min(3, Math.max(capacity + 1, ...demand.map((candidate) => candidate.analysis.cost))),
  };
}

function energyDevelopmentBenefit(analyses: EnergyCardAnalysis[], capacity: number) {
  const nextCapacity = capacity + 1;
  const newlyAffordable = analyses.filter((analysis) => (
    analysis.cost > capacity && analysis.cost <= nextCapacity
  )).reduce((sum, analysis) => (
    sum + 1.35 + Math.max(0, analysis.value) * Math.max(0.45, analysis.playLikelihood) * 0.28
  ), 0);
  const followingTurnDemand = analyses.filter((analysis) => (
    analysis.cost > nextCapacity && analysis.cost <= Math.min(3, nextCapacity + 1)
  )).reduce((sum, analysis) => (
    sum + 0.65 + Math.max(0, analysis.value) * 0.12
  ), 0);
  return 2.4 + newlyAffordable + followingTurnDemand;
}

function energyCandidateTier(
  match: MatchState,
  playerId: string,
  analysis: EnergyCardAnalysis,
  capacity: number,
) {
  if (
    (analysis.card.type === "Flip" || analysis.card.type === "Flip Hero")
    || analysis.card.type === "Character"
    || analysis.playLikelihood <= 0
  ) return 0;
  const player = playerById(match, playerId)!;
  const copies = player.hand.filter((card) => (
    card.catalogId === analysis.card.catalogId
  )).length + player.deckCards.filter((card) => (
    card.catalogId === analysis.card.catalogId
  )).length + player.bakugan.flatMap((bakugan) => bakugan.evoStack).filter((card) => (
    card.catalogId === analysis.card.catalogId
  )).length + match.batch.filter((effect) => (
    effect.controllerId === playerId
    && effect.card.type === "Evo"
    && !effect.negated
    && effect.card.catalogId === analysis.card.catalogId
  )).length;
  if (copies > 1 || analysis.cost > capacity + 2) return 1;
  let reactive = false;
  try {
    reactive = cardLeafActions(analysis.card).some((action) => (
      action.kind === "negate" || action.kind === "prevention"
    ));
  } catch {
    // Unknown card programs remain replaceable, but never break Energize.
  }
  if (analysis.affordableNow || reactive || analysis.tacticalReserveValue > 0) return 3;
  return 2;
}

function energyOpportunityCost(
  match: MatchState,
  playerId: string,
  analysis: EnergyCardAnalysis,
  capacity: number,
) {
  const player = playerById(match, playerId)!;
  const handCopies = player.hand.filter(
    (card) => card.catalogId === analysis.card.catalogId,
  ).length;
  const deckCopies = player.deckCards.filter(
    (card) => card.catalogId === analysis.card.catalogId,
  ).length;
  const committedCopies = player.bakugan.flatMap((bakugan) => bakugan.evoStack).filter(
    (card) => card.catalogId === analysis.card.catalogId,
  ).length + match.batch.filter((effect) => (
    effect.controllerId === playerId
    && effect.card.type === "Evo"
    && !effect.negated
    && effect.card.catalogId === analysis.card.catalogId
  )).length;
  const retainedValue = Math.max(0, analysis.value) * analysis.playLikelihood;
  const immediateUrgency = analysis.affordableNow
    ? 3.5 * analysis.playLikelihood
    : 0;
  const nextTurnUrgency = !analysis.affordableNow && analysis.cost <= capacity + 1
    ? 1.4 * analysis.playLikelihood
    : 0;
  const lateGameDiscount = Math.max(0, analysis.cost - capacity - 1) * 0.9
    + analysis.cost * 0.08;
  const replaceability = Math.max(0, handCopies - 1) * 0.45
    + deckCopies * 0.55
    + committedCopies * 0.75;
  return Math.max(
    0,
    retainedValue
      + immediateUrgency
      + nextTurnUrgency
      + analysis.tacticalReserveValue
      - lateGameDiscount
      - replaceability,
  );
}

/**
 * Energize first identifies reachable demand, including intrinsic early
 * development and lower-weight deck composition odds. It then ranks every
 * non-protected card by strategic class before comparing numerical opportunity
 * cost, so a stranded Flip cannot be retained over a useful response card.
 * No exact deck order is consulted.
 */
export function planOpponentEnergize(
  match: MatchState,
  playerId: string,
): OpponentEnergizePlan {
  const player = playerById(match, playerId);
  if (!player) return { shouldEnergize: false, reason: "no-energy-goal" };
  const capacity = currentEnergyCapacity(match, playerId);
  const analyses = player.hand.map((card) => (
    analyzeEnergyCard(match, playerId, card, capacity, "hand")
  ));
  const development = developmentGoal(analyses, capacity);
  const goals = [
    ...handEnergyGoals(analyses, capacity),
    ...deckEnergyGoals(match, playerId, capacity),
    ...(development ? [development] : []),
  ].sort((a, b) => (
    (development && a.source === "development" && b.source !== "development" ? -1
      : development && b.source === "development" && a.source !== "development" ? 1
        : 0)
    || b.score - a.score
    || ({ "hand-card": 0, "hand-combo": 1, development: 2, deck: 3 }[a.source]
      - { "hand-card": 0, "hand-combo": 1, development: 2, deck: 3 }[b.source])
  ));
  const goal = goals[0];
  const developmentBenefit = goal?.source === "development"
    ? energyDevelopmentBenefit(analyses, capacity)
    : 0;
  const targetCapacity = goal?.targetCost;
  const baseCandidates = analyses.map((analysis) => ({
    analysis,
    tier: energyCandidateTier(match, playerId, analysis, capacity),
    opportunityCost: energyOpportunityCost(
      match,
      playerId,
      analysis,
      capacity,
    ),
    counterfactualValue: 0,
  }));
  for (const candidate of baseCandidates) {
    candidate.counterfactualValue = developmentBenefit - candidate.opportunityCost;
  }
  if (!goal) {
    return {
      shouldEnergize: false,
      reason: "no-energy-goal",
      currentCapacity: capacity,
      skipValue: 0,
      protectedCardIds: [],
      candidates: baseCandidates.map((candidate) => ({
        cardId: candidate.analysis.card.id,
        tier: candidate.tier,
        opportunityCost: candidate.opportunityCost,
        counterfactualValue: candidate.counterfactualValue,
        protected: false,
      })),
    };
  }

  const protectedIds = new Set(goal.source === "deck" ? [] : goal.cardIds);
  const affordable = analyses.filter((analysis) => (
    analysis.affordableNow && analysis.playLikelihood >= 0.5
  ));
  if (goal.source !== "development" && affordable.length === 1) {
    protectedIds.add(affordable[0].card.id);
  }

  const diagnostics = baseCandidates.map((candidate) => ({
    cardId: candidate.analysis.card.id,
    tier: candidate.tier,
    opportunityCost: candidate.opportunityCost,
    counterfactualValue: candidate.counterfactualValue,
    protected: protectedIds.has(candidate.analysis.card.id),
  }));
  const candidates = baseCandidates
    .filter((candidate) => !protectedIds.has(candidate.analysis.card.id))
    .sort((a, b) => (
      a.tier - b.tier
      || (goal.source === "development"
        ? b.counterfactualValue - a.counterfactualValue
        : a.opportunityCost - b.opportunityCost)
      || b.analysis.cost - a.analysis.cost
      || a.analysis.card.id.localeCompare(b.analysis.card.id)
    ));
  const candidate = candidates[0];
  const maximumOpportunityCost = goal.source === "deck"
      ? 0.9
    : goal.source === "development"
      ? developmentBenefit + 1
      : Math.max(1.5, goal.score * 0.85);
  if (!candidate || candidate.opportunityCost > maximumOpportunityCost) {
    return {
      shouldEnergize: false,
      reason: "no-expendable-card",
      goalSource: goal.source,
      goalCardIds: goal.cardIds,
      goalScore: goal.score,
      currentCapacity: capacity,
      targetCapacity,
      developmentBenefit,
      skipValue: 0,
      protectedCardIds: [...protectedIds],
      candidates: diagnostics,
    };
  }
  return {
    shouldEnergize: true,
    cardId: candidate.analysis.card.id,
    reason: goal.source === "hand-card" ? "reachable-hand-card"
      : goal.source === "hand-combo" ? "reachable-hand-combo"
        : goal.source === "development" ? "early-energy-development"
          : "probable-deck-card",
    goalSource: goal.source,
    goalCardIds: goal.cardIds,
    goalScore: goal.score,
    currentCapacity: capacity,
    targetCapacity,
    developmentBenefit,
    skipValue: 0,
    protectedCardIds: [...protectedIds],
    candidates: diagnostics,
  };
}

function normalizedName(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bakuganSynergy(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  openChance: number,
) {
  const player = playerById(match, playerId)!;
  const top = topBakuganCard(bakugan);
  let value = bakugan.rollAccuracy * 0.006 + bakugan.doubleCoreChance * 0.035;
  const evo = player.hand
    .filter((card) => card.type === "Evo"
      && card.faction === bakugan.faction
      && normalizedName(card.evolvesFrom) === normalizedName(bakugan.name))
    .sort((a, b) => (
      (b.bPower ?? 0) * 0.01 + (b.damage ?? 0) * 0.9
      - ((a.bPower ?? 0) * 0.01 + (a.damage ?? 0) * 0.9)
    ))[0];
  if (evo) {
    value += Math.max(
      0,
      (evo.bPower ?? bakugan.bPower) * 0.01
        + (evo.damage ?? bakugan.damage) * 0.9
        - ((top.bPower ?? bakugan.bPower) * 0.01 + (top.damage ?? bakugan.damage) * 0.9),
    ) * 0.45;
  }
  value += player.heroes.filter((hero) => (
    /your Bakugan|your attacks/i.test(hero.effect)
    || hero.effect.toLowerCase().includes(
      "[" + bakugan.faction.toLowerCase() + "]",
    )
    || hero.effect.toLowerCase().includes(bakugan.name.toLowerCase())
  )).length * 0.35;
  if (player.bakugan.filter((candidate) => candidate.open).length === 2) {
    const teamDamage = player.bakugan.filter((candidate) => candidate.open)
      .reduce((sum, candidate) => sum + (topBakuganCard(candidate).damage ?? candidate.damage), 0);
    value += openChance * (3.5 + teamDamage * 0.35);
  }
  return value;
}

function bestBakugan(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return player.bakugan
    .filter((bakugan) => !bakugan.open)
    .map((bakugan) => {
      const forecast = bestForecast(match, playerId, bakugan);
      const openChance = forecast?.openProbability ?? bakugan.rollAccuracy / 100;
      return {
        bakugan,
        score: (forecast?.value ?? printedBakuganValue(bakugan))
          + bakuganSynergy(match, playerId, bakugan, openChance),
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.bakugan
    ?? player.bakugan[0];
}

function bestRollTarget(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  const bakugan = player.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  ) ?? player.bakugan[0];
  return bestForecast(match, playerId, bakugan)?.target;
}

function cellSideBias(match: MatchState, playerId: string, cellId: string) {
  const cell = HEX_CELLS.find((candidate) => candidate.id === cellId);
  const playerIndex = match.players.findIndex((candidate) => candidate.id === playerId);
  if (!cell || playerIndex < 0) return 0;
  const screenY = cell.r + cell.q / 2;
  return Math.max(-1, Math.min(1, (playerIndex === 0 ? screenY : -screenY) / 4));
}

function placementAccess(match: MatchState, playerId: string, cell: string) {
  const direct = rotationPhaseOpenCell(match, playerId, cell) === cell;
  return (direct ? 1 : 0.12) + cellSideBias(match, playerId, cell) * 0.28;
}

function bestCorePlacement(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  const opponent = opponentOf(match, playerId)!;
  const used = new Set(
    match.placements
      .filter((placement) => placement.playerId === playerId)
      .map((placement) => placement.core.id),
  );
  return player.cores.filter((core) => !used.has(core.id))
    .flatMap((core) => legalPlacementCells(match).map((cell) => {
      const provisional = cloneMatch(match);
      provisional.placements.push({
        playerId,
        core,
        cell,
        order: provisional.placements.length + 1,
      });
      return {
        core,
        cell,
        score: placementAccess(provisional, playerId, cell)
          * averageCoreValue(core, player.bakugan)
          - placementAccess(provisional, opponent.id, cell)
          * averageCoreValue(core, opponent.bakugan),
      };
    }))
    .sort((a, b) => b.score - a.score
      || a.core.id.localeCompare(b.core.id)
      || a.cell.localeCompare(b.cell))[0];
}

type PreRollCombatForecast = {
  own?: RollForecast;
  opponent?: RollForecast;
};

type PreRollResponseOption = {
  cardId: string;
  cost: number;
  powerSwing: number;
  secondaryValue: number;
};

type PreRollScenario = {
  id: string;
  projected: MatchState;
  enemyOpened: boolean;
  deficit: number;
};

type PreRollScenarioSet = {
  jointCount: number;
  scenarios: PreRollScenario[];
};

type PreRollComputationCache = {
  scenarioSets: Map<string, PreRollScenarioSet>;
  responseProfiles: Map<string, PreRollResponseOption | null>;
  continuations: Map<string, number>;
};

type PreRollDecisionContext = {
  capacity: number;
  forecast: PreRollCombatForecast;
  passContinuation: number;
  openChance: number;
  existingOpenDraws: number;
  averageDeckCardValue: number;
  drawCache: Map<string, number>;
  computation: PreRollComputationCache;
};

function selectedRollForecast(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const selected = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  return selected ? bestForecast(match, playerId, selected) : undefined;
}

function preRollCombatForecast(match: MatchState, playerId: string): PreRollCombatForecast {
  const opponent = opponentOf(match, playerId);
  return {
    own: selectedRollForecast(match, playerId),
    opponent: opponent ? selectedRollForecast(match, opponent.id) : undefined,
  };
}

function repeatableOpenDrawAmount(card: GameCard) {
  try {
    return compileCardEffect(card).instructions.reduce((sum, instruction) => {
      const actions = allInstructionLeafActions(instruction);
      const opens = actions.some((action) => (
        action.kind === "trigger"
        && action.definition.event === "BAKUGAN_OPENED"
      ));
      if (!opens) return sum;
      return sum + actions.reduce((amount, action) => (
        amount + (action.kind === "draw" ? action.amount : 0)
      ), 0);
    }, 0);
  } catch {
    return 0;
  }
}

function temporaryResponseProfile(
  match: MatchState,
  playerId: string,
  card: GameCard,
): PreRollResponseOption | undefined {
  if (card.type === "Flip" || card.type === "Flip Hero" || card.type === "Character") return undefined;
  let choices: CardChoices = {};
  try { choices = chooseCardChoices(match, playerId, card); } catch { choices = {}; }
  let cost = card.cost === "X" ? Math.max(1, currentEnergyCapacity(match, playerId)) : card.cost;
  try { cost = cardEnergyPaymentState(match, playerId, card, choices)?.cost ?? cost; } catch { /* printed cost */ }
  const opponent = opponentOf(match, playerId);
  const power = {
    own: totalPower(match, playerId),
    enemy: opponent ? totalPower(match, opponent.id) : 0,
  };
  const damage = {
    own: totalDamage(match, playerId),
    enemy: opponent ? totalDamage(match, opponent.id) : 0,
  };
  let powerSwing = 0;
  let secondaryValue = 0;
  let entries: ReturnType<typeof activeCardActionEntries>;
  try {
    const resolving = cloneProjectedMatch(match);
    const resolvingPlayer = playerById(resolving, playerId);
    if (resolvingPlayer) recordCardPlayedForTurn(resolvingPlayer, card, resolving.turn);
    entries = activeCardActionEntries(
      resolving,
      playerId,
      card,
      choices,
      { execution: "play" },
    );
  } catch {
    return undefined;
  }
  for (const { action, sourceText } of entries) {
    if (!isTemporaryCombatAction(action)) continue;
    const targetsEnemy = actionTargetsEnemy(
      match,
      playerId,
      choices,
      action,
      sourceText,
    );
    const direction = targetsEnemy ? -1 : 1;
    if (action.kind === "modify-stat") {
      if (action.stat === "power") {
        powerSwing += Math.max(0, action.amount * direction);
      } else {
        secondaryValue += Math.max(0, actionBaseValue(action) * direction) * 0.35;
      }
    } else if (action.kind === "set-stat") {
      const current = action.stat === "power"
        ? (targetsEnemy ? power.enemy : power.own)
        : (targetsEnemy ? damage.enemy : damage.own);
      const beneficialDelta = (action.value - current) * direction;
      if (action.stat === "power") powerSwing += Math.max(0, beneficialDelta);
      else secondaryValue += Math.max(0, beneficialDelta * 0.9) * 0.35;
    } else if (action.kind === "set-rule") {
      secondaryValue += action.value === "damage" ? 1.25 : 0.5;
    } else if (action.kind === "grant-keyword") {
      secondaryValue += Math.max(0, actionBaseValue(action) * direction) * 0.25;
    }
  }
  if (powerSwing <= 0 && secondaryValue <= 0) return undefined;
  return { cardId: card.id, cost: Math.max(0, cost), powerSwing, secondaryValue };
}

function applyProjectedRollSample(
  projected: MatchState,
  playerId: string,
  sample: RollForecastSample,
) {
  const player = playerById(projected, playerId);
  const bakugan = player?.bakugan.find(
    (candidate) => candidate.id === sample.outcome.bakuganId,
  );
  if (!player || !bakugan) return;
  for (const placement of projected.placements) {
    if (placement.attachedTo === bakugan.id) delete placement.attachedTo;
  }
  const opened = sample.outcome.result !== "miss-closed";
  bakugan.open = opened;
  bakugan.heldCoreCells = opened ? [...sample.outcome.cores] : [];
  if (opened) {
    for (const cell of sample.outcome.cores) {
      const placement = projected.placements.find((candidate) => candidate.cell === cell);
      if (placement) placement.attachedTo = bakugan.id;
    }
  }
  projected.rolls[playerId] = sample.outcome;
}

function projectedPowerStepState(
  match: MatchState,
  playerId: string,
  own: RollForecastSample,
  enemy: RollForecastSample,
) {
  const projected = cloneProjectedMatch(match);
  const opponent = opponentOf(projected, playerId);
  applyProjectedRollSample(projected, playerId, own);
  if (opponent) applyProjectedRollSample(projected, opponent.id, enemy);
  projected.phase = "power";
  projected.stepLabel = "Power Step";
  projected.priority = playerId;
  projected.passes = [];
  return projected;
}

function preRollPlanningStateKey(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  return `${match.id}:${match.version}:${playerId}:${player?.cardsPlayedThisTurn ?? -1}`;
}

function preRollScenarioSet(
  match: MatchState,
  playerId: string,
  forecast: PreRollCombatForecast,
  computation: PreRollComputationCache,
) {
  const stateKey = preRollPlanningStateKey(match, playerId);
  const cached = computation.scenarioSets.get(stateKey);
  if (cached) return cached;
  if (!forecast.own || !forecast.opponent) {
    const empty = { jointCount: 0, scenarios: [] };
    computation.scenarioSets.set(stateKey, empty);
    return empty;
  }
  const jointCount = forecast.own.samples.length * forecast.opponent.samples.length;
  const scenarios: PreRollScenario[] = [];
  forecast.own.samples.forEach((own, ownIndex) => {
    if (own.outcome.result === "miss-closed") return;
    forecast.opponent!.samples.forEach((enemy, enemyIndex) => {
      const projected = projectedPowerStepState(match, playerId, own, enemy);
      const enemyOpened = enemy.outcome.result !== "miss-closed";
      scenarios.push({
        id: `${stateKey}:${ownIndex}:${enemyIndex}`,
        projected,
        enemyOpened,
        deficit: enemyOpened ? enemy.power - own.power : -Math.max(1, own.power),
      });
    });
  });
  const result = { jointCount, scenarios };
  computation.scenarioSets.set(stateKey, result);
  return result;
}

function cachedTemporaryResponseProfile(
  scenario: PreRollScenario,
  playerId: string,
  card: GameCard,
  computation: PreRollComputationCache,
) {
  const key = `${scenario.id}:${card.id}`;
  if (computation.responseProfiles.has(key)) {
    return computation.responseProfiles.get(key) ?? undefined;
  }
  const profile = temporaryResponseProfile(scenario.projected, playerId, card);
  computation.responseProfiles.set(key, profile ?? null);
  return profile;
}

function responseCombinations(options: readonly PreRollResponseOption[], budget: number) {
  let combinations = [{ cost: 0, powerSwing: 0, secondaryValue: 0 }];
  for (const option of options.slice(0, 10)) {
    const added = combinations
      .filter((combination) => combination.cost + option.cost <= budget)
      .map((combination) => ({
        cost: combination.cost + option.cost,
        powerSwing: combination.powerSwing + option.powerSwing,
        secondaryValue: combination.secondaryValue + option.secondaryValue,
      }));
    const unique = new Map<string, typeof combinations[number]>();
    for (const combination of [...combinations, ...added]) {
      const key = `${combination.cost}:${combination.powerSwing}:${combination.secondaryValue}`;
      if (!unique.has(key)) unique.set(key, combination);
    }
    combinations = [...unique.values()];
  }
  return combinations;
}

function expectedPowerResponseContinuation(
  match: MatchState,
  playerId: string,
  hand: readonly GameCard[],
  budget: number,
  forecast: PreRollCombatForecast,
  computation: PreRollComputationCache,
) {
  if (budget <= 0 || !forecast.own || !forecast.opponent) return 0;
  const stateKey = preRollPlanningStateKey(match, playerId);
  const continuationKey = `${stateKey}:${budget}:${hand.map((card) => card.id).join(",")}`;
  const cached = computation.continuations.get(continuationKey);
  if (cached != null) {
    return cached;
  }
  const scenarioSet = preRollScenarioSet(match, playerId, forecast, computation);
  if (!scenarioSet.jointCount) return 0;
  let total = 0;
  for (const scenario of scenarioSet.scenarios) {
    const options = hand
      .map((card) => cachedTemporaryResponseProfile(
        scenario,
        playerId,
        card,
        computation,
      ))
      .filter((option): option is PreRollResponseOption => Boolean(option))
      .filter((option) => option.cost <= budget)
      .sort((a, b) => (
        (b.powerSwing + b.secondaryValue * 100) / Math.max(1, b.cost)
        - (a.powerSwing + a.secondaryValue * 100) / Math.max(1, a.cost)
      ));
    if (!options.length) continue;
    const combinations = responseCombinations(options, budget);
    let best = 0;
    for (const combination of combinations) {
      if (combination.cost <= 0) continue;
      if (scenario.enemyOpened && scenario.deficit >= 0 && combination.powerSwing > scenario.deficit) {
        const margin = combination.powerSwing - scenario.deficit;
        best = Math.max(
best,
7.5
  + Math.min(2.25, margin / 250)
  + Math.min(1.25, combination.secondaryValue * 0.2),
        );
      } else if (scenario.enemyOpened && scenario.deficit >= 0 && combination.powerSwing > 0) {
        best = Math.max(
best,
Math.min(
  0.45,
  combination.powerSwing / Math.max(400, scenario.deficit + 400),
),
        );
      } else if (scenario.deficit < 0 && combination.secondaryValue > 0) {
        best = Math.max(best, Math.min(0.8, combination.secondaryValue * 0.2));
      }
    }
    total += best;
  }
  const result = total / scenarioSet.jointCount;
  computation.continuations.set(continuationKey, result);
  return result;
}

function averageDeckCardValue(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  if (!player?.deckCards.length) return 0;
  return player.deckCards.reduce((sum, card) => (
    sum + clamp(Math.max(0, handCardRetentionValue(match, playerId, card)), 0, 3.5)
  ), 0) / player.deckCards.length;
}

function marginalDeckDrawValue(
  match: MatchState,
  playerId: string,
  hand: readonly GameCard[],
  budget: number,
  context: PreRollDecisionContext,
) {
  const player = playerById(match, playerId);
  if (!player?.deckCards.length) return 0;
  const key = `${budget}:${hand.map((card) => card.id).sort().join(",")}`;
  const cached = context.drawCache.get(key);
  if (cached != null) return cached;
  const baseline = expectedPowerResponseContinuation(
    match,
    playerId,
    hand,
    budget,
    context.forecast,
    context.computation,
  );
  const grouped = new Map<string, GameCard[]>();
  for (const card of player.deckCards) {
    const cards = grouped.get(card.catalogId) ?? [];
    cards.push(card);
    grouped.set(card.catalogId, cards);
  }
  let weighted = 0;
  for (const cards of grouped.values()) {
    const card = cards[0];
    const tactical = Math.max(0, expectedPowerResponseContinuation(
      match,
      playerId,
      [...hand, card],
      budget,
      context.forecast,
      context.computation,
    ) - baseline);
    const retained = clamp(
      Math.max(0, handCardRetentionValue(match, playerId, card)) * 0.28,
      0,
      1.25,
    );
    weighted += (tactical + retained) * cards.length;
  }
  const expectedHandSize = hand.length + context.existingOpenDraws * context.openChance;
  const saturation = clamp((8.25 - expectedHandSize) / 3.25, 0.25, 1);
  const value = weighted / player.deckCards.length * saturation;
  context.drawCache.set(key, value);
  return value;
}

function createPreRollDecisionContext(match: MatchState, playerId: string): PreRollDecisionContext {
  const player = playerById(match, playerId)!;
  const forecast = preRollCombatForecast(match, playerId);
  const capacity = currentEnergyCapacity(match, playerId);
  const computation: PreRollComputationCache = {
    scenarioSets: new Map(),
    responseProfiles: new Map(),
    continuations: new Map(),
  };
  const context: PreRollDecisionContext = {
    capacity,
    forecast,
    passContinuation: 0,
    openChance: forecast.own?.openProbability ?? expectedOpenChance(match, playerId),
    existingOpenDraws: player.heroes.reduce((sum, hero) => (
      sum + repeatableOpenDrawAmount(hero)
    ), 0),
    averageDeckCardValue: averageDeckCardValue(match, playerId),
    drawCache: new Map(),
    computation,
  };
  context.passContinuation = expectedPowerResponseContinuation(
    match,
    playerId,
    player.hand,
    capacity,
    forecast,
    computation,
  );
  return context;
}

function deferrablePreRollCombatValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
) {
  let value = 0;
  const resolving = cloneProjectedMatch(match);
  const resolvingPlayer = playerById(resolving, playerId);
  if (resolvingPlayer) recordCardPlayedForTurn(resolvingPlayer, card, resolving.turn);
  for (const { action, sourceText } of activeCardActionEntries(
    resolving,
    playerId,
    card,
    choices,
    { execution: "play" },
  )) {
    if (!isTemporaryCombatAction(action) || hasNonDeferrablePreRollTiming(sourceText)) continue;
    const raw = actionBaseValue(action);
    if (raw) {
      const targetsEnemy = actionTargetsEnemy(
        match,
        playerId,
        choices,
        action,
        sourceText,
      );
      const strategic = raw * (targetsEnemy ? -1 : 1);
      value += Math.max(
        0,
        strategic * combatRelevance(match, playerId, action, targetsEnemy),
      );
    } else {
      value += Math.max(0, estimateRuleActionValue(action, match))
        * expectedOpenChance(match, playerId);
    }
  }
  return value;
}

function preRollCandidateScore(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
  baseScore: number,
  cost: number,
  context: PreRollDecisionContext,
) {
  const player = playerById(match, playerId)!;
  const remainingCapacity = Math.max(0, context.capacity - cost);
  const remainingHand = player.hand.filter((candidate) => candidate.id !== card.id);
  const continued = cloneProjectedMatch(match);
  const continuedPlayer = playerById(continued, playerId);
  if (continuedPlayer) recordCardPlayedForTurn(continuedPlayer, card, continued.turn);
  const continuationAfter = expectedPowerResponseContinuation(
    continued,
    playerId,
    remainingHand,
    remainingCapacity,
    context.forecast,
    context.computation,
  );
  const continuationDelta = continuationAfter - context.passContinuation;
  const deferredCombat = deferrablePreRollCombatValue(
    match,
    playerId,
    card,
    choices,
  );
  const commitmentPenalty = deferredCombat > 0
    ? Math.min(0.25, Math.max(0, handCardRetentionValue(match, playerId, card)) * 0.05)
    : 0;
  let score = baseScore
    - deferredCombat
    + continuationDelta
    - commitmentPenalty;
  const drawAmount = repeatableOpenDrawAmount(card);
  if (drawAmount > 0) {
    const saturation = 1 / (1 + context.existingOpenDraws * 0.55);
    const currentRound = context.openChance
      * marginalDeckDrawValue(
        match,
        playerId,
        remainingHand,
        remainingCapacity,
        context,
      )
      * drawAmount
      * saturation;
    const remainingClosed = Math.max(
      0,
      player.bakugan.filter((bakugan) => !bakugan.open).length - 1,
    );
    const futureOpenings = Math.min(2.5, 0.75 + remainingClosed * 0.8);
    const future = Math.min(
      3.4 * drawAmount,
      context.averageDeckCardValue * 0.55 * futureOpenings * drawAmount,
    ) * saturation;
    const handOverflow = Math.max(
      0,
      remainingHand.length
        + (context.existingOpenDraws + drawAmount) * context.openChance
        - 7,
    );
    score += Math.min(4.5 * drawAmount, currentRound + future)
      - handOverflow * 0.45;
  }
  return score;
}

function bestPlayableCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  const preRollContext = match.phase === "preRoll"
    ? createPreRollDecisionContext(match, playerId)
    : undefined;
  return player.hand
    .filter((card) => card.type !== "Flip" && card.type !== "Flip Hero" && card.type !== "Character")
    .filter((card) => cardRerollTimingLegal(match, playerId, card))
    .map((card) => {
      const choices = chooseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      const baseScore = cardValue(match, playerId, card, choices);
      const score = preRollContext && payment
        ? preRollCandidateScore(
          match,
          playerId,
          card,
          choices,
          baseScore,
          payment.cost,
          preRollContext,
        )
        : baseScore;
      return { card, choices, payment, score };
    })
    .filter((candidate) => candidate.payment && candidate.payment.kind !== "insufficient")
    .sort((a, b) => b.score - a.score)[0];
}

export function opponentAiCanAct(match: MatchState, playerId: string) {
  if (!playerById(match, playerId)) return false;
  if (match.pendingChoice?.schema.fields.some(
    (field) => field.chooserId === playerId && !match.pendingChoice?.answers[playerId],
  )) return true;
  if (match.triggerOrders.some(
    (request) => request.controllerId === playerId && !request.orderedIds,
  )) return true;
  if (match.phase === "startingPlayer" && Date.now() >= match.startingPlayerRevealedAt) return true;
  if (match.phase === "placement" && match.priority === playerId) return true;
  if (playerCanDrawTurnCard(match, playerId)) return true;
  const player = playerById(match, playerId)!;
  if (match.phase === "energize" && !player.energizedThisTurn) return true;
  if (match.phase === "selection" && !match.selected[playerId]) return true;
  if (
    (match.phase === "target" || match.phase === "reroll")
    && (playerCanSelectRollTarget(match, playerId) || playerCanConfirmRoll(match, playerId))
  ) return true;
  if (match.phase === "damage" && match.pendingLoser === playerId) return true;
  if (match.phase === "reset" && match.batch.length && match.priority === playerId) return true;
  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;
  return match.phase === "handLimit" && match.priority === playerId;
}

/** Pure tactical decision used by the Training worker. State mutation stays in the engine reducer. */
export function chooseOpponentAiCommand(input: MatchState, playerId: string): GameCommand | null {
  const player = playerById(input, playerId);
  if (!player) return null;
  const pending = input.pendingChoice;
  if (
    pending
    && pending.schema.fields.some((field) => field.chooserId === playerId)
    && !pending.answers[playerId]
  ) {
    const source = pendingSource(input, pending);
    if (!source && !["resolution", "forced-discard", "gear-replacement"].includes(pending.kind)) {
      return { type: "CANCEL_CARD_CHOICE" };
    }
    const card = source?.card ?? fallbackChoiceCard(pending);
    const choiceSourceText = source?.sourceText ?? card.effect;
    let choices: CardChoices;
    try {
      choices = chooseChoicesFromSchema(
        input,
        pending.controllerId,
        card,
        pending.schema,
        playerId,
        choiceSourceText,
      );
    } catch {
      choices = {};
      for (const field of pending.schema.fields.filter((candidate) => candidate.chooserId === playerId)) {
        const count = Math.max(field.minimum, ["number", "mode", "confirm"].includes(field.kind) ? 1 : 0);
        setChoice(choices, field, field.options.slice(0, count).map((option) => option.id));
      }
    }
    return { type: "SUBMIT_CARD_CHOICE", choices };
  }
  const triggerOrder = input.triggerOrders.find(
    (request) => request.controllerId === playerId && !request.orderedIds,
  );
  if (triggerOrder) {
    const ids = [...triggerOrder.triggers].sort((a, b) => (
      estimateProgramValue(compileCardEffect(a.card, a.effect), input, playerId, a.choices)
      - estimateProgramValue(compileCardEffect(b.card, b.effect), input, playerId, b.choices)
    )).map((trigger) => trigger.id);
    return { type: "ORDER_TRIGGERS", requestId: triggerOrder.id, orderedIds: ids };
  }
  if (input.phase === "startingPlayer" && Date.now() >= input.startingPlayerRevealedAt) {
    return { type: "BEGIN_CORE_PLACEMENT" };
  }
  if (input.phase === "placement" && input.priority === playerId) {
    const placement = bestCorePlacement(input, playerId);
    return placement ? { type: "PLACE_CORE", coreId: placement.core.id, cell: placement.cell } : null;
  }
  if (playerCanDrawTurnCard(input, playerId)) return { type: "DRAW_TURN_CARD" };
  if (input.phase === "energize" && !player.energizedThisTurn) {
    const plan = planOpponentEnergize(input, playerId);
    return { type: "ENERGIZE", cardId: plan.shouldEnergize ? plan.cardId : undefined };
  }
  if (input.phase === "selection" && !input.selected[playerId]) {
    return { type: "SELECT_BAKUGAN", bakuganId: bestBakugan(input, playerId).id };
  }
  if (input.phase === "target" || input.phase === "reroll") {
    if (playerCanSelectRollTarget(input, playerId)) {
      const target = bestRollTarget(input, playerId);
      return target ? { type: "SELECT_ROLL_TARGET", cell: target.cell } : null;
    }
    if (playerCanConfirmRoll(input, playerId)) return { type: "CONFIRM_ROLL" };
  }
  if (input.phase === "damage" && input.pendingLoser === playerId) {
    if (!input.revealedFlip) {
      return input.pendingDamage > 0 ? { type: "REVEAL_DAMAGE_FLIP" } : null;
    }
    const choices = chooseCardChoices(input, playerId, input.revealedFlip);
    const payment = cardEnergyPaymentState(input, playerId, input.revealedFlip, choices);
    const useful = cardValue(input, playerId, input.revealedFlip, choices) > 0;
    return {
      type: "PLAY_DAMAGE_FLIP",
      cardId: !alternateWinEffectPending(input)
        && revealedFlipCanBePlayed(input, playerId, input.revealedFlip)
        && payment
        && payment.kind !== "insufficient"
        && useful
        ? input.revealedFlip.id
        : undefined,
      choices,
    };
  }
  if (input.phase === "reset" && input.batch.length && input.priority === playerId) {
    return { type: "PASS_PRIORITY" };
  }
  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {
    if (alternateWinEffectPending(input)) return { type: "PASS_PRIORITY" };
    if (playerCanActivateIntrinsicReroll(input, playerId)) {
      return { type: "ACTIVATE_REROLL" };
    }
    const best = bestPlayableCard(input, playerId);
    const confidenceMargin = input.phase === "preRoll" ? 0.4 : 0.75;
    if (best && best.score > confidenceMargin) {
      const schema = buildChoiceSchema(input, playerId, best.card);
      return schema.fields.length
        ? { type: "PREPARE_CARD_PLAY", cardId: best.card.id }
        : { type: "PLAY_CARD", cardId: best.card.id, choices: best.choices };
    }
    return { type: "PASS_PRIORITY" };
  }
  if (input.phase === "handLimit" && input.priority === playerId) {
    const amount = Math.max(0, player.hand.length - 7);
    const cards = [...player.hand].sort(
      (a, b) => handCardRetentionValue(input, playerId, a)
        - handCardRetentionValue(input, playerId, b),
    ).slice(0, amount);
    return { type: "DISCARD_TO_HAND_LIMIT", cardIds: cards.map((card) => card.id) };
  }
  return null;
}

export function advanceOpponentAi(input: MatchState, playerId: string): MatchState | null {
  const command = chooseOpponentAiCommand(input, playerId);
  if (!command) return null;
  switch (command.type) {
    case "CANCEL_CARD_CHOICE": return cancelCardChoice(input, playerId);
    case "SUBMIT_CARD_CHOICE": return submitCardChoice(input, playerId, command.choices);
    case "ORDER_TRIGGERS": return orderTriggers(input, playerId, command.requestId, command.orderedIds);
    case "BEGIN_CORE_PLACEMENT": return beginCorePlacement(input);
    case "PLACE_CORE": return placeCore(input, playerId, command.coreId, command.cell);
    case "DRAW_TURN_CARD": return drawTurnCard(input, playerId);
    case "ENERGIZE": return energizeCard(input, playerId, command.cardId);
    case "SELECT_BAKUGAN": return selectBakugan(input, playerId, command.bakuganId);
    case "SELECT_ROLL_TARGET": return selectRollTarget(input, playerId, command.cell);
    case "CONFIRM_ROLL": return confirmRoll(input, playerId);
    case "REVEAL_DAMAGE_FLIP": return flipDamageCard(input, playerId);
    case "PLAY_DAMAGE_FLIP": return resolveManualDamage(input, playerId, command.cardId, command.choices);
    case "ACTIVATE_REROLL": return activateIntrinsicReroll(input, playerId);
    case "PREPARE_CARD_PLAY": return prepareCardPlay(input, playerId, command.cardId);
    case "PLAY_CARD": return playCardWithAutoEnergy(input, playerId, command.cardId, command.choices);
    case "PASS_PRIORITY": return passPriority(input, playerId);
    case "DISCARD_TO_HAND_LIMIT": return discardToHandLimit(input, playerId, command.cardIds);
    default: return null;
  }
}
