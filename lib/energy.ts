import { cloneMatch, type GameCard, type MatchState, type PlayerState } from "./game";
import { activeTappedEnergyIds, availableEnergy } from "./rules/costs";
import { ensureRulesState } from "./rules/state";

type EnergyPlayerState = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };
export type EnergyZoneView = {
  cards: readonly GameCard[];
  tappedEnergyIds: readonly string[];
  availableEnergy: number;
};
export type EnergyZoneViews = { player: EnergyZoneView; opponent: EnergyZoneView };
const EMPTY_ENERGY_ZONE_VIEW: EnergyZoneView = { cards: [], tappedEnergyIds: [], availableEnergy: 0 };

export function energyZoneView(player: PlayerState | null | undefined, turn: number): EnergyZoneView {
  if (!player) return EMPTY_ENERGY_ZONE_VIEW;
  const tracked = player as EnergyPlayerState;
  return {
    cards: player.energyZone,
    tappedEnergyIds: activeTappedEnergyIds(tracked, turn),
    availableEnergy: availableEnergy(tracked, turn),
  };
}

export function energyZoneViews(match: MatchState | null | undefined, playerId: string | undefined): EnergyZoneViews {
  if (!match?.players.length) return { player: EMPTY_ENERGY_ZONE_VIEW, opponent: EMPTY_ENERGY_ZONE_VIEW };
  const player = match.players.find((candidate) => candidate.id === playerId) ?? match.players[0];
  return {
    player: energyZoneView(player, match.turn),
    opponent: energyZoneView(match.players.find((candidate) => candidate.id !== player.id), match.turn),
  };
}

export function energyCardCanTap(match: MatchState | null | undefined, playerId: string | undefined, cardId: string) {
  if (!match || !playerId) return false;
  const payment = ensureRulesState(match).pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") return false;
  const player = match.players.find((candidate) => candidate.id === playerId) as EnergyPlayerState | undefined;
  return Boolean(player?.energyZone.some((card) => card.id === cardId)
    && !activeTappedEnergyIds(player, match.turn).includes(cardId)
    && availableEnergy(player, match.turn) < payment.calculatedCost);
}

/**
 * Uncharge one Energy card for the currently declared payment. Energy cannot be
 * generated speculatively or outside a card/ability payment transaction.
 */
export function tapEnergyCard(input: MatchState, playerId: string, cardId: string): MatchState {
  const state = cloneMatch(input);
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") {
    throw new Error("Energy cards can only be uncharged while paying for an announced card or ability.");
  }
  const player = state.players.find((candidate) => candidate.id === playerId) as EnergyPlayerState | undefined;
  if (!player) throw new Error("Unknown player.");
  const card = player.energyZone.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("That card is not in your Energy Card zone.");
  if (player.energyTapTurn !== state.turn) {
    player.energyTapTurn = state.turn;
    player.tappedEnergyIds = [];
    player.energy = 0;
  } else player.tappedEnergyIds = activeTappedEnergyIds(player, state.turn);
  if (player.tappedEnergyIds.includes(cardId)) throw new Error("That Energy card is already uncharged.");
  if (player.energy >= payment.calculatedCost) throw new Error("The declared payment already has enough Energy.");
  player.tappedEnergyIds.push(cardId);
  payment.selectedEnergyIds.push(cardId);
  player.energy += 1;
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-energy-${state.log.length}`,
    at: Date.now(),
    kind: "game",
    message: `${player.name} uncharged an Energy card for the declared payment.`,
  });
  return state;
}
