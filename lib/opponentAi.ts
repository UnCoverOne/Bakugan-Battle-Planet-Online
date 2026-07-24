import {
  HEX_CELLS,
  beginCorePlacement,
  cancelCardChoice,
  cloneMatch,
  discardToHandLimit,
  energizeCard,
  legalPlacementCells,
  orderTriggers,
  placeCore,
  prepareCardPlay,
  passPriority,
  resolveRollOutcome,
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

function futureCardValue(match: MatchState, playerId: string, card: GameCard) {
  const printedCost = card.cost === "X" ? 2 : card.cost;
  let value = estimateProgramValue(compileCardEffect(card), match, playerId) - printedCost * 0.4;
  if (card.type === "Hero") value += 2.2;
  if (card.type === "Evo") value += 2.8;
  if (card.type === "Flip") value += 3.2;
  return value;
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
    const future = futureCardValue(match, owner?.id ?? chooserId, selected);
    if (/play a card from your hand for free/i.test(card.effect)) {
      return owner?.id === chooserId ? future : -future;
    }
    if (/sacrifice/i.test(card.effect)) return sacrificedCardBenefit(card) - future;
    if (/discard|shuffle .*from your hand/i.test(card.effect)) return -future;
    return future;
  }
  if (field.kind === "deck-card" || field.kind === "deck-order") {
    const selected = controller.deckCards.find((candidate) => candidate.id === id);
    return selected ? futureCardValue(match, controllerId, selected) : -100;
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
    effect: "",
    mechanics: [],
    bPower: null,
    damage: null,
    coreTypes: [],
    evolvesFrom: null,
    art: "",
  };
}

function bestEnergyCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return [...player.hand].sort(
    (a, b) => futureCardValue(match, playerId, a) - futureCardValue(match, playerId, b),
  )[0];
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
    match.phase === "target"
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
    if (!source && pending.kind !== "resolution") {
      return cancelCardChoice(input, pending.controllerId);
    }
    const card = source
      ? { ...source.card, effect: source.sourceText }
      : fallbackChoiceCard(pending);
    return submitCardChoice(
      input,
      playerId,
      chooseChoicesFromSchema(input, pending.controllerId, card, pending.schema, playerId),
    );
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
    return energizeCard(input, playerId, bestEnergyCard(input, playerId)?.id);
  }
  if (input.phase === "selection" && !input.selected[playerId]) {
    return selectBakugan(input, playerId, bestBakugan(input, playerId).id);
  }
  if (input.phase === "target") {
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
      payment && payment.kind !== "insufficient" && useful
        ? input.revealedFlip.id
        : undefined,
      choices,
    );
  }
  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {
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
      (a, b) => futureCardValue(input, playerId, a) - futureCardValue(input, playerId, b),
    ).slice(0, amount);
    return discardToHandLimit(input, playerId, cards.map((card) => card.id));
  }
  return null;
}


