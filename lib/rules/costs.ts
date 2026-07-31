import type { CardChoices, GameCard, MatchState, PlayerState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { activeFrostStrike, ruleConditionActive } from "./modifiers";
import type { CostEffect, RulesPayment } from "./model";
import { ensureRulesState } from "./state";

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

type EnergyTrackedPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };

function playerById(state: MatchState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  return player;
}

function modifierActive(state: MatchState, player: PlayerState, modifier: CostEffect) {
  return !("condition" in modifier) || ruleConditionActive(state, player, modifier.condition);
}

function choiceHasValue(choices: CardChoices, id: keyof CardChoices) {
  const selected = choices[id];
  return Array.isArray(selected) ? selected.length > 0 : selected !== undefined && selected !== false && selected !== "";
}

export function cardCostBreakdown(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
): CardCostBreakdown {
  const player = playerById(state, playerId);
  const definition = ruleDefinitionForCard(card);
  const capacity = player.energyZone.length + Math.max(0, player.energy);
  const xValue = card.cost === "X" ? Math.max(0, Math.min(capacity, choices.xValue ?? 0)) : 0;
  const printed = card.cost === "X" ? xValue : card.cost;
  let reductions = 0;
  let increases = 0;
  let freeBase = false;
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
    if (!modifierActive(state, player, modifier)) continue;
    if (modifier.kind === "cost-reduce") {
      const variableMultiplier = modifier.scale === "cards-played-this-turn"
        ? Math.max(0, player.cardsPlayedThisTurn)
        : modifier.scale === "held-bakucore"
          ? player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0)
          : 1;
      reductions += modifier.amount * variableMultiplier;
    } else if (modifier.kind === "cost-increase") increases += modifier.amount;
    else if (modifier.kind === "cost-free") freeBase = true;
    else if (modifier.kind === "cost-discard") additionalCosts.push({ kind: "discard", amount: modifier.amount, choiceId: modifier.choiceId });
    else if (modifier.kind === "cost-alternative") {
      const selected = modifier.components.some((component) => component.kind === "cost-discard" && choiceHasValue(choices, component.choiceId));
      if (selected) {
        freeBase = true;
        for (const component of modifier.components) if (component.kind === "cost-discard") {
          additionalCosts.push({ kind: "discard", amount: component.amount, choiceId: component.choiceId });
        }
      }
    }
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

export function activeTappedEnergyIds(player: EnergyTrackedPlayer, turn: number) {
  if (player.energyTapTurn !== turn || !Array.isArray(player.tappedEnergyIds)) return [];
  const legal = new Set(player.energyZone.map((card) => card.id));
  return player.tappedEnergyIds.filter((id) => legal.has(id));
}

export function availableEnergy(player: EnergyTrackedPlayer, turn: number) {
  return player.energyTapTurn === turn ? Math.max(0, Math.floor(player.energy)) : 0;
}

export function beginCardPayment(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
): RulesPayment {
  const breakdown = cardCostBreakdown(state, playerId, card, choices);
  const payment: RulesPayment = {
    id: `${state.id}:${state.version}:${card.id}:payment`,
    playerId,
    cardId: card.id,
    calculatedCost: breakdown.total,
    selectedEnergyIds: [],
    additionalCosts: breakdown.additionalCosts.map((cost) => ({
      kind: "discard",
      cardIds: Array.isArray(choices[cost.choiceId]) ? (choices[cost.choiceId] as string[]).slice(0, cost.amount) : [],
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
  for (const additional of payment.additionalCosts) {
    const ids = new Set(additional.cardIds);
    const cards = player.hand.filter((card) => ids.has(card.id));
    if (cards.length !== ids.size) throw new Error("An additional-cost card is no longer in hand.");
    player.hand = player.hand.filter((card) => !ids.has(card.id));
    player.discard.push(...cards);
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

