import type { CardChoices, GameCard, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { activeFrostStrike, ruleConditionActive } from "./modifiers";
import type { CostEffect, RulesPayment } from "./model";
import { playerIdsForScope } from "./primitives";
import { ensureRulesState } from "./state";
import { evaluateNumberValue, type NumberValue } from "./values";

export type CardCostBreakdown = {
  printed: number;
  xValue: number;
  reductions: number;
  increases: number;
  frostStrike: number;
  freeBase: boolean;
  additionalCosts: Array<{ kind: "discard"; amount: number; choiceId: keyof CardChoices }>;
  total: number;
};

export type CardCostContext = {
  /** External “play ... for free” effects set the base to zero before all modifiers. */
  forcedFreeBase?: boolean;
  selectedAlternativeId?: string;
  /** Captured announce/pay values from the shared card-play transaction. */
  capturedValues?: Record<string, number>;
};

export type CardPaymentMode = {
  id: string;
  label: string;
  freeBase: boolean;
  energyCost: number;
  additionalCosts: CardCostBreakdown["additionalCosts"];
  legal: boolean;
  reason?: string;
};

type EnergyTrackedPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };

function playerById(state: MatchState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  return player;
}

function modifierActive(state: MatchState, player: PlayerState, modifier: CostEffect, choices: CardChoices = {}) {
  return !("condition" in modifier) || ruleConditionActive(state, player, modifier.condition, undefined, choices);
}

function choiceHasValue(choices: CardChoices, id: keyof CardChoices) {
  const selected = choices[id];
  return Array.isArray(selected) ? selected.length > 0 : selected !== undefined && selected !== false && selected !== "";
}

function costValue(state: MatchState, playerId: string, value: NumberValue, choices: CardChoices = {}, capturedValues?: Record<string, number>) {
  return evaluateNumberValue(state, value, {
    controllerId: playerId,
    chosenPlayerId: choices.targetPlayerId,
    choices,
    moment: "pay",
    capturedValues,
  });
}

export function cardCostBreakdown(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: CardCostContext = {},
): CardCostBreakdown {
  const player = playerById(state, playerId);
  const definition = ruleDefinitionForCard(card);
  const capacity = player.energyZone.length + Math.max(0, player.energy);
  const xValue = card.cost === "X" ? Math.max(0, Math.min(capacity, choices.xValue ?? 0)) : 0;
  const printed = card.cost === "X" ? xValue : card.cost;
  let reductions = 0;
  let increases = 0;
  let freeBase = Boolean(context.forcedFreeBase);
  const additionalCosts: CardCostBreakdown["additionalCosts"] = [];

  const selfModifiers = definition.play.costModifiers.filter((modifier) => (
    !("appliesTo" in modifier) || modifier.appliesTo !== "controller"
  ));
  const controlledModifiers = player.heroes.flatMap((hero) => (
    ruleDefinitionForCard(hero).play.costModifiers.filter((modifier) => (
      modifier.kind === "cost-reduce"
      && modifier.appliesTo === "controller"
      && (!modifier.cardType || modifier.cardType === card.type)
    ))
  ));

  reductions += Math.max(0, state.nextCardCostReduction?.[playerId] ?? 0);

  for (const modifier of [...selfModifiers, ...controlledModifiers]) {
    if (!modifierActive(state, player, modifier, choices)) continue;
    if (modifier.kind === "cost-reduce") {
      reductions += costValue(state, playerId, modifier.amount, choices, context.capturedValues);
    } else if (modifier.kind === "cost-increase") increases += costValue(state, playerId, modifier.amount, choices, context.capturedValues);
    else if (modifier.kind === "cost-free") {
      if (!modifier.cardType || modifier.cardType === card.type) freeBase = true;
    } else if (modifier.kind === "cost-discard") {
      additionalCosts.push({ kind: "discard", amount: Math.max(0, Math.floor(costValue(state, playerId, modifier.amount, choices, context.capturedValues))), choiceId: modifier.choiceId });
    } else if (modifier.kind === "cost-alternative") {
      const legacySelected = modifier.components.some((component) => (
        component.kind === "cost-discard" && choiceHasValue(choices, component.choiceId)
      ));
      const selected = context.selectedAlternativeId === modifier.id
        || choices.paymentMode === modifier.id
        || (!choices.paymentMode && legacySelected);
      if (!selected) continue;
      if (modifier.setsBaseFree) freeBase = true;
      for (const component of modifier.components) if (component.kind === "cost-discard") {
        additionalCosts.push({ kind: "discard", amount: Math.max(0, Math.floor(costValue(state, playerId, component.amount, choices, context.capturedValues))), choiceId: component.choiceId });
      }
    }
  }

  const rules = ensureRulesState(state);
  for (const modifier of rules.costModifiers) {
    if (modifier.duration === "turn" && modifier.createdTurn !== state.turn) continue;
    if (modifier.cardType && modifier.cardType !== card.type) continue;
    const recipients = playerIdsForScope(state, modifier.playerScope, { controllerId: modifier.controllerId });
    if (!recipients.includes(playerId)) continue;
    if (modifier.kind === "free") freeBase = true;
    else if (modifier.kind === "reduce") reductions += costValue(state, playerId, modifier.amount, modifier.choices ?? choices, modifier.valueSnapshots);
    else increases += costValue(state, playerId, modifier.amount, modifier.choices ?? choices, modifier.valueSnapshots);
  }

  const frostStrike = card.type === "Flip" && state.damageOrigin ? activeFrostStrike(state, state.damageOrigin) : 0;
  const base = freeBase ? 0 : printed;
  return {
    printed,
    xValue,
    reductions,
    increases,
    frostStrike,
    freeBase,
    additionalCosts,
    total: Math.max(0, base - reductions + increases + frostStrike),
  };
}

function selectedIds(choices: CardChoices, choiceId: keyof CardChoices) {
  const value = choices[choiceId];
  return Array.isArray(value) ? value.map(String) : [];
}

function paymentLegality(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
  breakdown: CardCostBreakdown,
) {
  const player = playerById(state, playerId);
  const reasons: string[] = [];
  for (const additional of breakdown.additionalCosts) {
    const ids = selectedIds(choices, additional.choiceId);
    const available = player.hand.filter((candidate) => candidate.id !== card.id).length;
    if (ids.length) {
      const unique = new Set(ids);
      const present = player.hand.filter((candidate) => unique.has(candidate.id) && candidate.id !== card.id).length;
      if (unique.size !== additional.amount || present !== additional.amount) {
        reasons.push(`Choose exactly ${additional.amount} legal card${additional.amount === 1 ? "" : "s"} to discard.`);
      }
    } else if (available < additional.amount) {
      reasons.push(`${additional.amount} discardable card${additional.amount === 1 ? " is" : "s are"} required, but only ${available} available.`);
    }
  }
  const payable = maximumPayableEnergy(state, playerId);
  if (payable < breakdown.total) {
    reasons.push(`Not enough Energy: ${breakdown.total} required after modifiers, ${payable} available.`);
  }
  return { legal: reasons.length === 0, reason: reasons.join(" ") || undefined };
}

export function cardPaymentModes(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: Pick<CardCostContext, "forcedFreeBase" | "capturedValues"> = {},
): CardPaymentMode[] {
  const player = playerById(state, playerId);
  const definition = ruleDefinitionForCard(card);
  if (context.forcedFreeBase) {
    const breakdown = cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true, capturedValues: context.capturedValues });
    const legality = paymentLegality(state, playerId, card, choices, breakdown);
    return [{
      id: "forced-free",
      label: "Play for free",
      freeBase: true,
      energyCost: breakdown.total,
      additionalCosts: breakdown.additionalCosts,
      ...legality,
    }];
  }

  const modes: CardPaymentMode[] = [];
  const normal = cardCostBreakdown(state, playerId, card, { ...choices, paymentMode: "normal" }, { capturedValues: context.capturedValues });
  modes.push({
    id: "normal",
    label: "Pay normal Energy cost",
    freeBase: normal.freeBase,
    energyCost: normal.total,
    additionalCosts: normal.additionalCosts,
    ...paymentLegality(state, playerId, card, choices, normal),
  });

  for (const alternative of definition.play.costModifiers.filter((modifier): modifier is Extract<CostEffect, { kind: "cost-alternative" }> => (
    modifier.kind === "cost-alternative" && modifierActive(state, player, modifier, choices)
  ))) {
    const alternativeChoices = { ...choices, paymentMode: alternative.id };
    const breakdown = cardCostBreakdown(state, playerId, card, alternativeChoices, { selectedAlternativeId: alternative.id, capturedValues: context.capturedValues });
    const legality = paymentLegality(state, playerId, card, choices, breakdown);
    modes.push({
      id: alternative.id,
      label: alternative.label,
      freeBase: breakdown.freeBase,
      energyCost: breakdown.total,
      additionalCosts: breakdown.additionalCosts,
      ...legality,
    });
  }
  return modes;
}

export function activeTappedEnergyIds(player: EnergyTrackedPlayer, turn: number) {
  if (player.energyTapTurn !== turn || !Array.isArray(player.tappedEnergyIds)) return [];
  const legal = new Set(player.energyZone.map((card) => card.id));
  return player.tappedEnergyIds.filter((id) => legal.has(id));
}

export function availableEnergy(player: EnergyTrackedPlayer, turn: number) {
  return player.energyTapTurn === turn ? Math.max(0, Math.floor(player.energy)) : 0;
}

/** Maximum Energy that can be paid now, including currently untapped Energy cards. */
export function maximumPayableEnergy(state: MatchState, playerId: string) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const tapped = new Set(activeTappedEnergyIds(player, state.turn));
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id)).length;
  return availableEnergy(player, state.turn) + untapped;
}

/**
 * Recalculate the payable Energy after an effect sets a card's Energy cost to
 * free. Rule 1.15.2 starts free at 0, then normal reductions/increases (including
 * FrostStrike for a Flip) still apply.
 */
export function cardCostAfterFreeBase(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  return cardCostBreakdown(state, playerId, card, choices, { forcedFreeBase: true }).total;
}

/** Charge selected uncharged Energy cards, or every uncharged Energy card when no selection is supplied. */
export function rechargeEnergyCards(
  state: MatchState,
  playerId: string,
  selectedIds?: readonly string[],
) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const tapped = activeTappedEnergyIds(player, state.turn);
  const requested = selectedIds ? new Set(selectedIds) : undefined;
  const recharged = tapped.filter((id) => !requested || requested.has(id));
  if (!recharged.length) return 0;
  const rechargedSet = new Set(recharged);
  player.energyTapTurn = state.turn;
  player.tappedEnergyIds = tapped.filter((id) => !rechargedSet.has(id));
  return recharged.length;
}

export function beginCardPayment(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
  context: CardCostContext = {},
): RulesPayment {
  const breakdown = cardCostBreakdown(state, playerId, card, choices, context);
  const payment: RulesPayment = {
    id: `${state.id}:${state.version}:${card.id}:payment`,
    playerId,
    cardId: card.id,
    calculatedCost: breakdown.total,
    selectedEnergyIds: [],
    additionalCosts: breakdown.additionalCosts.map((cost) => ({
      kind: "discard",
      amount: cost.amount,
      cardIds: selectedIds(choices, cost.choiceId).slice(0, cost.amount),
    })),
    status: "declared",
  };
  ensureRulesState(state).pendingPayment = payment;
  return payment;
}

export function prepareDeclaredEnergyPayment(state: MatchState, playerId: string, amount: number) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") throw new Error("Energy can only be uncharged for a declared card payment.");
  if (payment.calculatedCost !== amount) throw new Error("The declared payment amount changed before payment completed.");
  if (player.energyTapTurn !== state.turn) {
    player.energyTapTurn = state.turn;
    player.tappedEnergyIds = [];
    player.energy = 0;
  } else player.tappedEnergyIds = activeTappedEnergyIds(player, state.turn);
  const current = availableEnergy(player, state.turn);
  const required = Math.max(0, amount - current);
  const tapped = new Set(player.tappedEnergyIds);
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id));
  if (untapped.length < required) throw new Error(`Not enough Energy. ${amount} required, ${current + untapped.length} available.`);
  const selected = untapped.slice(0, required);
  player.tappedEnergyIds.push(...selected.map((card) => card.id));
  player.energy = current + selected.length;
  payment.selectedEnergyIds = selected.map((card) => card.id);
  return state;
}

export function commitCardPayment(state: MatchState, playerId: string) {
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") throw new Error("There is no declared card payment to commit.");
  const player = playerById(state, playerId);
  if (player.energy < payment.calculatedCost) throw new Error("The declared Energy cost has not been generated.");

  const planned = payment.additionalCosts.map((additional) => {
    if (additional.cardIds.length !== additional.amount || new Set(additional.cardIds).size !== additional.amount) {
      throw new Error(`This payment requires exactly ${additional.amount} discard${additional.amount === 1 ? "" : "s"}.`);
    }
    const ids = new Set(additional.cardIds);
    const cards = player.hand.filter((card) => ids.has(card.id));
    if (cards.length !== additional.amount) throw new Error("An additional-cost card is no longer in hand.");
    return { ids, cards };
  });

  for (const additional of planned) {
    player.hand = player.hand.filter((card) => !additional.ids.has(card.id));
    player.discard.push(...additional.cards);
  }
  player.energy -= payment.calculatedCost;
  payment.status = "paid";
  rules.pendingPayment = undefined;
  return state;
}

export function cancelCardPayment(state: MatchState, playerId: string) {
  const rules = ensureRulesState(state);
  if (rules.pendingPayment?.playerId === playerId) {
    rules.pendingPayment.status = "cancelled";
    rules.pendingPayment = undefined;
  }
  return state;
}
