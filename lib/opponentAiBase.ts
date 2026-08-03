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
  resolveRollOutcome,
  revealedFlipCanBePlayed,
  rotationPhaseOpenCell,
  selectBakugan,
  submitCardChoice,
  totalPower,
  type Bakugan,
  type CardChoices,
  type Core,
  type GameCard,
  type MatchState,
  type PendingEffect,
  type Placement,
} from "./game";
import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";
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

function printedBakuganValue(bakugan: Bakugan) {
  const top = topBakuganCard(bakugan);
  return (top.bPower ?? bakugan.bPower) * 0.01 + (top.damage ?? bakugan.damage) * 0.9;
}

function coreValueForBakugan(core: Core, bakugan: Bakugan) {
  const conditional = !core.conditionalFactions?.length
    || core.conditionalFactions.includes(bakugan.faction);
  const power = core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0);
  const damage = core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0);
  return power * 0.01 + damage * 0.9
    + (core.frostStrike ?? 0) * 0.55 + (core.shadowStrike ? 1.2 : 0);
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

type RollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
};

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
  const state = {
    ...match,
    selected: { ...match.selected, [playerId]: bakugan.id },
    targets: { ...match.targets, [playerId]: target.cell },
  };
  const player = playerById(state, playerId)!;
  const primaryCounts = new Map<string, number>();
  const seed = stableHash([playerId, bakugan.id, target.cell].join(":"));
  let totalValue = 0;
  let opened = 0;
  let collected = 0;

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
    const coreValue = outcome.cores.reduce((sum, cell) => {
      const placement = state.placements.find((candidate) => candidate.cell === cell);
      return sum + (placement ? coreValueForBakugan(placement.core, bakugan) : 0);
    }, 0);
    totalValue += (didOpen ? printedBakuganValue(bakugan) : -1.25) + coreValue;
    const primary = outcome.cores[0];
    if (primary) primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1);
  }

  return {
    target,
    value: totalValue / ROLL_FORECAST_SAMPLES,
    openProbability: opened / ROLL_FORECAST_SAMPLES,
    coreProbability: collected / ROLL_FORECAST_SAMPLES,
    primaryProbability: new Map(
      [...primaryCounts].map(([cell, count]) => [cell, count / ROLL_FORECAST_SAMPLES]),
    ),
  };
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

  return availableRollTargets(match)
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
}

function expectedOpenChance(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const selected = player?.bakugan.find((candidate) => candidate.id === match.selected[playerId]);
  if (!selected) return 0;
  return bestForecast(match, playerId, selected)?.openProbability ?? selected.rollAccuracy / 100;
}

function evaluatedFutureCardValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  includeDeckFlipValue: boolean,
) {
  const printedCost = card.cost === "X" ? 2 : card.cost;
  try {
    let value = estimateProgramValue(compileCardEffect(card), match, playerId) - printedCost * 0.4;
    if (card.type === "Hero") value += 2.2;
    if (card.type === "Evo") value += 2.8;
    if (card.type === "Flip" && includeDeckFlipValue) value += 3.2;
    return value;
  } catch {
    // A forced discard must never stall because another card cannot be
    // valued. Keep the previous stable fallback for playable cards.
    return printedCost * 0.4
      + (card.type === "Hero" ? 2.2
        : card.type === "Evo" ? 2.8
          : card.type === "Flip" && includeDeckFlipValue ? 3.2 : 0);
  }
}

/**
 * A Flip only has functional value while it remains in the deck or is
 * revealed by damage. Once drawn, it cannot be played from hand, so
 * retaining it has no opportunity value for Energize or discard choices.
 */
function handCardRetentionValue(match: MatchState, playerId: string, card: GameCard) {
  if (card.type === "Flip") return 0;
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

function cardValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  const program = compileCardEffect(card);
  const printedCost = card.cost === "X" ? choices.xValue ?? 0 : card.cost;
  let value = estimateProgramValue(program, match, playerId, choices) - printedCost * 0.72;
  for (const instruction of program.instructions) {
    for (const action of instruction.actions) {
      const raw = actionBaseValue(action);
      if (raw) {
        const targetsEnemy = actionTargetsEnemy(
          match, playerId, choices, action, instruction.sourceText,
        );
        const strategic = raw * (targetsEnemy ? -1 : 1);
        value += strategic * combatRelevance(match, playerId, action, targetsEnemy) - raw;
      }
      if (action.kind === "negate") {
        value += negateValue(match, playerId, program) - (match.batch.length ? 5 : -3);
      }
      if (action.kind === "reroll" && match.phase === "power") {
        const targetId = action.target === "opponent" ? opponentOf(match, playerId)?.id : playerId;
        const roll = targetId ? match.rolls[targetId] : undefined;
        if (roll) {
          const missedCore = roll.result === "miss-closed";
          const opponentTarget = action.target === "opponent";
          value += missedCore === !opponentTarget ? 4.5 : -1.5;
        }
      }
    }
  }
  if (card.type === "Hero") value += 2.4 + Math.max(0, 4 - match.turn) * 0.35;
  if (card.type === "Evo") value += 3.2;
  if (card.type === "Flip") value += match.pendingDamage > 0 ? 5 : -10;
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
  for (const action of compileCardEffect(card).instructions.flatMap(
    (instruction) => instruction.actions,
  )) {
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
  return compileCardEffect(card).instructions
    .flatMap((instruction) => instruction.actions)
    .filter((action) => action.kind === "modify-stat" && action.scale === "sacrificed-card")
    .reduce((sum, action) => sum + Math.abs(actionBaseValue(action)), 0);
}

function optionScore(
  match: MatchState,
  controllerId: string,
  chooserId: string,
  card: GameCard,
  field: ChoiceField,
  id: string,
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
  if (field.kind === "energy") return option?.ownerId === chooserId ? -1 : 1;
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
    const controllerScore = cardValue(match, controllerId, card);
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
): CardChoices {
  const choices: CardChoices = {};
  for (const field of schema.fields.filter((candidate) => candidate.chooserId === chooserId)) {
    const scores = new Map(field.options.map((option) => [
      option.id,
      optionScore(match, controllerId, chooserId, card, field, option.id),
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

type EnergyGoalSource = "hand-card" | "hand-combo" | "deck";
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
};
export type OpponentEnergizePlan = {
  shouldEnergize: boolean;
  cardId?: string;
  reason: "reachable-hand-card" | "reachable-hand-combo" | "probable-deck-card"
    | "no-energy-goal" | "no-expendable-card";
  goalSource?: EnergyGoalSource;
  goalCardIds?: string[];
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

function futurePlayLikelihood(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
  zone: "hand" | "deck",
) {
  if (card.type === "Character") return 0;
  if (card.type === "Flip") return zone === "deck" ? 0.42 : 0;
  try {
    if (!schemaHasLegalCompletion(buildChoiceSchema(match, playerId, card))) return 0;
  } catch {
    return 0.2;
  }
  if (card.type === "Evo" && !choices.targetBakuganId) return 0;
  if (/\bReroll\b/i.test(card.effect)) {
    return match.placements.some((placement) => !placement.attachedTo) ? 0.25 : 0;
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
  let choices: CardChoices = {};
  try { choices = chooseCardChoices(match, playerId, card); } catch { choices = {}; }
  let cost = card.cost === "X" ? Math.max(1, capacity) : card.cost;
  try {
    cost = cardEnergyPaymentState(match, playerId, card, choices)?.cost ?? cost;
  } catch {
    // Keep the printed planning cost when a conditional choice is not
    // currently constructible. Its reduced likelihood handles uncertainty.
  }
  return {
    card,
    cost,
    value: zone === "hand"
      ? handCardRetentionValue(match, playerId, card)
      : deckCardFutureValue(match, playerId, card),
    playLikelihood: futurePlayLikelihood(match, playerId, card, choices, zone),
    affordableNow: cost <= capacity,
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
  const immediateUrgency = analysis.affordableNow && analysis.playLikelihood >= 0.5 ? 3.5 : 0;
  const nextTurnUrgency = !analysis.affordableNow && analysis.cost <= capacity + 1 ? 1.4 : 0;
  const lateGameDiscount = Math.max(0, analysis.cost - capacity - 1) * 0.9
    + analysis.cost * 0.08;
  const replaceability = Math.max(0, handCopies - 1) * 0.45 + deckCopies * 0.55;
  return Math.max(0, analysis.value)
    + immediateUrgency
    + nextTurnUrgency
    - lateGameDiscount
    - replaceability;
}

/**
 * Energize is a two-stage decision: first identify reachable Energy
 * demand, including lower-weight deck composition odds, then sacrifice
 * the least urgent non-goal card. No exact deck order is consulted.
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
  const goals = [
    ...handEnergyGoals(analyses, capacity),
    ...deckEnergyGoals(match, playerId, capacity),
  ].sort((a, b) => (
    b.score - a.score
    || ({ "hand-card": 0, "hand-combo": 1, deck: 2 }[a.source]
      - { "hand-card": 0, "hand-combo": 1, deck: 2 }[b.source])
  ));
  const goal = goals[0];
  if (!goal) return { shouldEnergize: false, reason: "no-energy-goal" };

  const protectedIds = new Set(goal.source === "deck" ? [] : goal.cardIds);
  const affordable = analyses.filter((analysis) => (
    analysis.affordableNow && analysis.playLikelihood >= 0.5
  ));
  if (affordable.length === 1) protectedIds.add(affordable[0].card.id);

  const candidates = analyses
    .filter((analysis) => !protectedIds.has(analysis.card.id))
    .map((analysis) => ({
      analysis,
      opportunityCost: energyOpportunityCost(
        match,
        playerId,
        analysis,
        capacity,
      ),
    }))
    .sort((a, b) => (
      a.opportunityCost - b.opportunityCost
      || b.analysis.cost - a.analysis.cost
      || a.analysis.card.id.localeCompare(b.analysis.card.id)
    ));
  const candidate = candidates[0];
  const maximumOpportunityCost = goal.source === "deck"
    ? 0.9
    : Math.max(1.5, goal.score * 0.85);
  if (!candidate || candidate.opportunityCost > maximumOpportunityCost) {
    return {
      shouldEnergize: false,
      reason: "no-expendable-card",
      goalSource: goal.source,
      goalCardIds: goal.cardIds,
    };
  }
  return {
    shouldEnergize: true,
    cardId: candidate.analysis.card.id,
    reason: goal.source === "hand-card" ? "reachable-hand-card"
      : goal.source === "hand-combo" ? "reachable-hand-combo"
        : "probable-deck-card",
    goalSource: goal.source,
    goalCardIds: goal.cardIds,
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

function bestPlayableCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return player.hand
    .filter((card) => card.type !== "Flip" && card.type !== "Character")
    .filter((card) => cardRerollTimingLegal(match, playerId, card))
    .map((card) => {
      const program = compileCardEffect(card);
      const choices = chooseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      const temporaryCombat = program.instructions.some((instruction) => instruction.actions.some(
        (action) => (
          action.kind === "set-stat"
          || action.kind === "set-rule"
          || ((action.kind === "modify-stat" || action.kind === "grant-keyword")
            && action.duration !== "while-source-in-play"
            && action.duration !== "next-card")
        ),
      ));
      const uniquePreRollValue = program.instructions.some((instruction) => (
        /(?:before|when) (?:you )?(?:select|roll)|select a Bakugan to roll|turn a BakuCore .*face up/i.test(instruction.sourceText)
        && instruction.actions.some((action) => ![
          "modify-stat", "grant-keyword", "set-stat", "set-rule", "choice", "trigger",
        ].includes(action.kind))
      ));
      const timingLegal = match.phase !== "preRoll" || !temporaryCombat || uniquePreRollValue;
      return {
        card,
        choices,
        payment,
        score: timingLegal ? cardValue(match, playerId, card, choices) : Number.NEGATIVE_INFINITY,
      };
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
  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;
  return match.phase === "handLimit" && match.priority === playerId;
}

export function advanceOpponentAi(input: MatchState, playerId: string): MatchState | null {
  const player = playerById(input, playerId);
  if (!player) return null;
  const pending = input.pendingChoice;
  if (
    pending
    && pending.schema.fields.some((field) => field.chooserId === playerId)
    && !pending.answers[playerId]
  ) {
    const source = pendingSource(input, pending);
    if (!source && !["resolution", "forced-discard"].includes(pending.kind)) {
      return cancelCardChoice(input, pending.controllerId);
    }
    const card = source
      ? { ...source.card, effect: source.sourceText }
      : fallbackChoiceCard(pending);
    let choices: CardChoices;
    try {
      choices = chooseChoicesFromSchema(input, pending.controllerId, card, pending.schema, playerId);
    } catch {
      choices = {};
      for (const field of pending.schema.fields.filter((candidate) => candidate.chooserId === playerId)) {
        const count = Math.max(field.minimum, ["number", "mode", "confirm"].includes(field.kind) ? 1 : 0);
        setChoice(choices, field, field.options.slice(0, count).map((option) => option.id));
      }
    }
    return submitCardChoice(input, playerId, choices);
  }
  const triggerOrder = input.triggerOrders.find(
    (request) => request.controllerId === playerId && !request.orderedIds,
  );
  if (triggerOrder) {
    const ids = [...triggerOrder.triggers].sort((a, b) => (
      estimateProgramValue(compileCardEffect(a.card, a.effect), input, playerId, a.choices)
      - estimateProgramValue(compileCardEffect(b.card, b.effect), input, playerId, b.choices)
    )).map((trigger) => trigger.id);
    return orderTriggers(input, playerId, triggerOrder.id, ids);
  }
  if (input.phase === "startingPlayer" && Date.now() >= input.startingPlayerRevealedAt) {
    return beginCorePlacement(input);
  }
  if (input.phase === "placement" && input.priority === playerId) {
    const placement = bestCorePlacement(input, playerId);
    return placement ? placeCore(input, playerId, placement.core.id, placement.cell) : null;
  }
  if (playerCanDrawTurnCard(input, playerId)) return drawTurnCard(input, playerId);
  if (input.phase === "energize" && !player.energizedThisTurn) {
    const plan = planOpponentEnergize(input, playerId);
    return energizeCard(input, playerId, plan.shouldEnergize ? plan.cardId : undefined);
  }
  if (input.phase === "selection" && !input.selected[playerId]) {
    return selectBakugan(input, playerId, bestBakugan(input, playerId).id);
  }
  if (input.phase === "target" || input.phase === "reroll") {
    if (playerCanSelectRollTarget(input, playerId)) {
      const target = bestRollTarget(input, playerId);
      return target ? selectRollTarget(input, playerId, target.cell) : null;
    }
    if (playerCanConfirmRoll(input, playerId)) return confirmRoll(input, playerId);
  }
  if (input.phase === "damage" && input.pendingLoser === playerId) {
    if (!input.revealedFlip) {
      return input.pendingDamage > 0 ? flipDamageCard(input, playerId) : null;
    }
    const choices = chooseCardChoices(input, playerId, input.revealedFlip);
    const payment = cardEnergyPaymentState(input, playerId, input.revealedFlip, choices);
    const useful = cardValue(input, playerId, input.revealedFlip, choices) > 0;
    return resolveManualDamage(
      input,
      playerId,
      !alternateWinEffectPending(input)
        && revealedFlipCanBePlayed(input, playerId, input.revealedFlip)
        && payment
        && payment.kind !== "insufficient"
        && useful
        ? input.revealedFlip.id
        : undefined,
      choices,
    );
  }
  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {
    if (alternateWinEffectPending(input)) return passPriority(input, playerId);
    if (playerCanActivateIntrinsicReroll(input, playerId)) {
      return activateIntrinsicReroll(input, playerId);
    }
    const best = bestPlayableCard(input, playerId);
    if (best && best.score > 0.75) {
      const schema = buildChoiceSchema(input, playerId, best.card);
      return schema.fields.length
        ? prepareCardPlay(input, playerId, best.card.id)
        : playCardWithAutoEnergy(input, playerId, best.card.id, best.choices);
    }
    return passPriority(input, playerId);
  }
  if (input.phase === "handLimit" && input.priority === playerId) {
    const amount = Math.max(0, player.hand.length - 7);
    const cards = [...player.hand].sort(
      (a, b) => handCardRetentionValue(input, playerId, a)
        - handCardRetentionValue(input, playerId, b),
    ).slice(0, amount);
    return discardToHandLimit(input, playerId, cards.map((card) => card.id));
  }
  return null;
}
