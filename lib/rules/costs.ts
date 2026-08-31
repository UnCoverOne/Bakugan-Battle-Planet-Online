import type { CardChoices, GameCard, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { activeFrostStrike, ruleConditionActive } from "./modifiers";
import type { CostEffect, RulesPayment } from "./model";
import { hasActiveRulePermission } from "./permissions";
import { playerIdsForScope } from "./primitives";
import { ensureRulesState } from "./state";
import { evaluateNumberValue, type NumberValue } from "./values";

export type CardCostBreakdown = {
  printed: number;
  xValue: number;
  reductions: number;
  increases: number;
  frostStrike: number;
  empowerCost: number;
  empowerSelected: boolean;
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

type EnergyTrackedPlayer = PlayerState & {
  /** Canonical horizontal/uncharged Energy-card state. */
  unchargedEnergyIds?: string[];
  /** Cards blocked from the automatic Charge Step for the keyed turn. */
  energyRechargeLocks?: Record<string, number>;
  /** @deprecated Legacy snapshot/UI aliases. */
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

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
  const capacity = maximumPayableEnergy(state, playerId);
  const xValue = card.cost === "X" ? Math.max(0, Math.min(capacity, choices.xValue ?? 0)) : 0;
  const printed = card.cost === "X" ? xValue : card.cost;
  const empowerSelected = choices.empower === true || choices.empower === "yes" || choices.empower === "true";
  const printedEmpowerCost = card.effect.match(/\bEmpower\s*:[\s\S]*?pay(?: an additional)?\s+(\d+)\s+\[Energy\]/i)?.[1];
  let empowerCost = empowerSelected && /\bEmpower\s*:/i.test(card.effect)
    ? Number(printedEmpowerCost ?? 3)
    : 0;
  let reductions = 0;
  let increases = 0;
  let freeBase = Boolean(context.forcedFreeBase);
  const additionalCosts: CardCostBreakdown["additionalCosts"] = [];

  const cardHasMechanic = (modifier: CostEffect) => !("cardMechanic" in modifier) || !modifier.cardMechanic
    || card.mechanics.some((mechanic) => mechanic.toLowerCase() === modifier.cardMechanic!.toLowerCase());
  const selfModifiers = definition.play.costModifiers.filter((modifier) => (
    cardHasMechanic(modifier) && (!("appliesTo" in modifier) || modifier.appliesTo !== "controller")
  ));
  const controlledModifiers = player.heroes.flatMap((hero) => (
    ruleDefinitionForCard(hero).play.costModifiers.filter((modifier) => (
      cardHasMechanic(modifier)
      && ((modifier.kind === "cost-reduce" && modifier.appliesTo === "controller")
        || (modifier.kind === "cost-free" && modifier.cardMechanic))
      && (!modifier.cardType || modifier.cardType === card.type)
    ))
  ));

  reductions += Math.max(0, state.nextCardCostReduction?.[playerId] ?? 0);
  if (empowerCost > 0) {
    if (hasActiveRulePermission(state, playerId, "empower-free") || state.nextCardEmpowerFree?.[playerId]) empowerCost = 0;
    else empowerCost = Math.max(0, empowerCost - Math.max(0, state.nextCardEmpowerReduction?.[playerId] ?? 0));
  }

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

  const frostStrike = (card.type === "Flip" || card.type === "Flip Hero") && state.damageOrigin ? activeFrostStrike(state, state.damageOrigin) : 0;
  const base = freeBase ? 0 : printed;
  return {
    printed,
    xValue,
    reductions,
    increases,
    frostStrike,
    empowerCost,
    empowerSelected,
    freeBase,
    additionalCosts,
    total: Math.max(0, base - reductions + increases + frostStrike) + empowerCost,
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

const ENERGY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function energyNumber(value: string) {
  return ENERGY_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || 0);
}

function mirrorLegacyEnergyState(player: EnergyTrackedPlayer, turn: number) {
  player.tappedEnergyIds = [...(player.unchargedEnergyIds ?? [])];
  player.energyTapTurn = turn;
}

/** Upgrade legacy tap-per-turn snapshots to persistent Energy-card orientation. */
export function normalizeEnergyCardState(player: PlayerState, turn: number) {
  const tracked = player as EnergyTrackedPlayer;
  const legal = new Set(player.energyZone.map((card) => card.id));
  const canonical = Array.isArray(tracked.unchargedEnergyIds);
  const source = canonical
    ? tracked.unchargedEnergyIds!
    : tracked.energyTapTurn === turn && Array.isArray(tracked.tappedEnergyIds)
      ? tracked.tappedEnergyIds
      : [];
  if (!canonical && tracked.energyTapTurn != null && tracked.energyTapTurn !== turn) player.energy = 0;
  tracked.unchargedEnergyIds = [...new Set(source.filter((id) => legal.has(id)))];
  tracked.energyRechargeLocks = Object.fromEntries(Object.entries(tracked.energyRechargeLocks ?? {})
    .filter(([id, lockedTurn]) => legal.has(id) && Number.isFinite(lockedTurn) && lockedTurn >= turn));
  player.energy = Math.max(0, Math.floor(player.energy));
  mirrorLegacyEnergyState(tracked, turn);
  return tracked;
}

/** Canonical list of horizontal/uncharged Energy cards; legacy snapshots are read without mutation. */
export function activeUnchargedEnergyIds(player: EnergyTrackedPlayer, turn: number) {
  const legal = new Set(player.energyZone.map((card) => card.id));
  const source = Array.isArray(player.unchargedEnergyIds)
    ? player.unchargedEnergyIds
    : player.energyTapTurn === turn && Array.isArray(player.tappedEnergyIds)
      ? player.tappedEnergyIds
      : [];
  return [...new Set(source.filter((id) => legal.has(id)))];
}

/** @deprecated Compatibility alias used by existing presentation/tests. */
export function activeTappedEnergyIds(player: EnergyTrackedPlayer, turn: number) {
  return activeUnchargedEnergyIds(player, turn);
}

/** Produced but unspent Energy; this is the value shown by the Energy indicator. */
export function availableEnergy(player: EnergyTrackedPlayer) {
  return Math.max(0, Math.floor(player.energy));
}

/** Printed/continuous replacement for how much Energy one charged Energy card makes when uncharged. */
export function energyProductionValue(state: MatchState, playerId: string) {
  const player = playerById(state, playerId);
  const activeSources = [
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.evoStack.at(-1) ?? (bakugan.fused ? bakugan.fusionCharacter : undefined) ?? bakugan.character, ...(bakugan.bakuGear ?? [])]),
  ];
  let production = 1;
  for (const source of activeSources) {
    const match = source.effect.match(/Energy cards make\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\[Energy\]\s+instead of\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\[Energy\]/i);
    if (!match) continue;
    const replacement = energyNumber(match[1]);
    const replaced = energyNumber(match[2]);
    if (replaced === 1 && replacement > 0) production = replacement;
  }
  return production;
}

export function chargedEnergyCards(state: MatchState, playerId: string) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const uncharged = new Set(activeUnchargedEnergyIds(player, state.turn));
  return player.energyZone.filter((card) => !uncharged.has(card.id));
}

export function maximumPayableEnergy(state: MatchState, playerId: string) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  return availableEnergy(player) + chargedEnergyCards(state, playerId)
    .reduce((sum) => sum + energyProductionValue(state, playerId), 0);
}

export function energyPaymentPlan(state: MatchState, playerId: string, amount: number) {
  const player = playerById(state, playerId) as EnergyTrackedPlayer;
  const target = Math.max(0, Math.floor(amount));
  const current = availableEnergy(player);
  const selectedEnergyIds: string[] = [];
  let projected = current;
  for (const card of chargedEnergyCards(state, playerId)) {
    if (projected >= target) break;
    selectedEnergyIds.push(card.id);
    projected += energyProductionValue(state, playerId);
  }
  return {
    current,
    target,
    selectedEnergyIds,
    projected,
    payable: maximumPayableEnergy(state, playerId),
    sufficient: projected >= target,
  };
}

export function unchargeEnergyCards(
  state: MatchState,
  playerId: string,
  selectedIds: readonly string[],
  options: { producesEnergy?: boolean; preventChargeStepRecharge?: boolean } = {},
) {
  const player = normalizeEnergyCardState(playerById(state, playerId), state.turn);
  const uncharged = new Set(player.unchargedEnergyIds ?? []);
  const charged = new Set(player.energyZone.filter((card) => !uncharged.has(card.id)).map((card) => card.id));
  const cardIds = [...new Set(selectedIds)].filter((id) => charged.has(id));
  let produced = 0;
  for (const id of cardIds) {
    uncharged.add(id);
    if (options.producesEnergy) produced += energyProductionValue(state, playerId);
    if (options.preventChargeStepRecharge) {
      player.energyRechargeLocks = { ...(player.energyRechargeLocks ?? {}), [id]: state.turn };
    }
  }
  player.unchargedEnergyIds = [...uncharged];
  if (options.producesEnergy) player.energy += produced;
  mirrorLegacyEnergyState(player, state.turn);
  return { count: cardIds.length, produced, cardIds };
}

export function setEnergyCardChargeState(
  state: MatchState,
  playerId: string,
  cardIds: readonly string[],
  chargeState: "charged" | "uncharged",
) {
  const player = normalizeEnergyCardState(playerById(state, playerId), state.turn);
  const legal = new Set(player.energyZone.map((card) => card.id));
  const uncharged = new Set(player.unchargedEnergyIds ?? []);
  for (const id of cardIds) {
    if (!legal.has(id)) continue;
    if (chargeState === "uncharged") uncharged.add(id);
    else uncharged.delete(id);
  }
  player.unchargedEnergyIds = [...uncharged];
  mirrorLegacyEnergyState(player, state.turn);
  return player;
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

/** Charge selected uncharged Energy cards, or every legal uncharged Energy card. */
export function rechargeEnergyCards(
  state: MatchState,
  playerId: string,
  selectedIds?: readonly string[],
  options: { respectChargeStepLocks?: boolean } = {},
) {
  const player = normalizeEnergyCardState(playerById(state, playerId), state.turn);
  const requested = selectedIds ? new Set(selectedIds) : undefined;
  const locks = player.energyRechargeLocks ?? {};
  const recharged = (player.unchargedEnergyIds ?? []).filter((id) => (
    (!requested || requested.has(id))
    && (!options.respectChargeStepLocks || locks[id] !== state.turn)
  ));
  if (!recharged.length) return 0;
  const rechargedSet = new Set(recharged);
  player.unchargedEnergyIds = (player.unchargedEnergyIds ?? []).filter((id) => !rechargedSet.has(id));
  mirrorLegacyEnergyState(player, state.turn);
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

/** Declare and pay a non-card Energy cost, such as a Fusion activation. */
export function payEnergyCost(state: MatchState, playerId: string, amount: number, sourceId: string) {
  const payment: RulesPayment = {
    id: `${state.id}:${state.version}:${sourceId}:energy-payment`,
    playerId,
    cardId: sourceId,
    calculatedCost: Math.max(0, Math.floor(amount)),
    selectedEnergyIds: [],
    additionalCosts: [],
    status: "declared",
  };
  ensureRulesState(state).pendingPayment = payment;
  prepareDeclaredEnergyPayment(state, playerId, payment.calculatedCost);
  commitCardPayment(state, playerId);
  return state;
}

export function prepareDeclaredEnergyPayment(state: MatchState, playerId: string, amount: number) {
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") throw new Error("Energy can only be uncharged for a declared card payment.");
  if (payment.calculatedCost !== amount) throw new Error("The declared payment amount changed before payment completed.");
  const plan = energyPaymentPlan(state, playerId, amount);
  if (!plan.sufficient) throw new Error(`Not enough Energy. ${amount} required, ${plan.payable} available.`);
  const result = unchargeEnergyCards(state, playerId, plan.selectedEnergyIds, { producesEnergy: true });
  payment.selectedEnergyIds = [...new Set([...payment.selectedEnergyIds, ...result.cardIds])];
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
