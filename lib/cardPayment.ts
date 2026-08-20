import {
  cloneMatch,
  playCard,
  type CardChoices,
  type GameCard,
  type MatchState,
  type PlayerState,
} from "./game";
import { hasPendingDraws } from "./drawQueue";
import { legalEvoTargets } from "./evo";
import { activeTappedEnergyIds, availableEnergy, cardCostBreakdown, prepareDeclaredEnergyPayment } from "./rules/costs";

type EnergyTrackedPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };
export type CardEnergyPaymentKind = "ready" | "auto-tap" | "insufficient";
export type CardEnergyPaymentState = {
  kind: CardEnergyPaymentKind;
  cost: number;
  availableEnergy: number;
  untappedEnergy: number;
  totalEnergy: number;
  shortfall: number;
  autoTapCardIds: readonly string[];
};

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

export function effectiveCardEnergyCost(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  return cardCostBreakdown(state, playerId, card, choices).total;
}

export function cardEnergyPaymentState(
  state: MatchState | null | undefined,
  playerId: string | undefined,
  card: GameCard | null | undefined,
  choices: CardChoices = {},
): CardEnergyPaymentState | null {
  if (!state || !playerId || !card) return null;
  const player = playerById(state, playerId) as EnergyTrackedPlayer | undefined;
  if (!player) return null;
  const cost = effectiveCardEnergyCost(state, playerId, card, choices);
  const current = availableEnergy(player, state.turn);
  const tapped = new Set(activeTappedEnergyIds(player, state.turn));
  const untapped = player.energyZone.filter((energyCard) => !tapped.has(energyCard.id));
  const shortfall = Math.max(0, cost - current);
  const totalEnergy = current + untapped.length;
  const kind: CardEnergyPaymentKind = cost <= current ? "ready" : cost <= totalEnergy ? "auto-tap" : "insufficient";
  return {
    kind,
    cost,
    availableEnergy: current,
    untappedEnergy: untapped.length,
    totalEnergy,
    shortfall,
    autoTapCardIds: kind === "auto-tap" ? untapped.slice(0, shortfall).map((energyCard) => energyCard.id) : [],
  };
}

/** Generate Energy only for an already-declared payment transaction. */
export function prepareEnergyPayment(input: MatchState, playerId: string, amount: number) {
  const state = cloneMatch(input);
  return prepareDeclaredEnergyPayment(state, playerId, amount);
}


export function playCardWithAutoEnergy(
  input: MatchState,
  playerId: string,
  cardId: string,
  choices: CardChoices = {},
) {
  if (hasPendingDraws(input)) throw new Error("Complete every pending Draw action before playing another card.");
  const player = playerById(input, playerId);
  const card = player?.hand.find((candidate) => candidate.id === cardId);
  if (card?.type === "Evo") {
    const target = legalEvoTargets(input, playerId, card).find((candidate) => candidate.id === choices.targetBakuganId);
    if (!target) throw new Error("Select the Character identity listed by this Evo card.");
    choices = { ...choices, targetBakuganId: target.id };
  }
  return playCard(input, playerId, cardId, choices);
}
