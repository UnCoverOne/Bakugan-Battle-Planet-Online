import { cloneMatch, type GameCard, type MatchState, type PlayerState } from "./game";
import {
  activeUnchargedEnergyIds,
  availableEnergy,
  unchargeEnergyCards,
} from "./rules/costs";
import { ensureRulesState } from "./rules/state";

type EnergyPlayerState = PlayerState & {
  unchargedEnergyIds?: string[];
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};
export type EnergyZoneView = {
  cards: readonly GameCard[];
  unchargedEnergyIds: readonly string[];
  /** @deprecated Compatibility alias for existing orientation presentation. */
  tappedEnergyIds: readonly string[];
  chargedEnergyCount: number;
  availableEnergy: number;
};
export type EnergyZoneViews = { player: EnergyZoneView; opponent: EnergyZoneView };
const EMPTY_ENERGY_ZONE_VIEW: EnergyZoneView = {
  cards: [],
  unchargedEnergyIds: [],
  tappedEnergyIds: [],
  chargedEnergyCount: 0,
  availableEnergy: 0,
};

export function energyZoneView(player: PlayerState | null | undefined, turn: number): EnergyZoneView {
  if (!player) return EMPTY_ENERGY_ZONE_VIEW;
  const tracked = player as EnergyPlayerState;
  const unchargedEnergyIds = activeUnchargedEnergyIds(tracked, turn);
  return {
    cards: player.energyZone,
    unchargedEnergyIds,
    tappedEnergyIds: unchargedEnergyIds,
    chargedEnergyCount: Math.max(0, player.energyZone.length - unchargedEnergyIds.length),
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
    && !activeUnchargedEnergyIds(player, match.turn).includes(cardId)
    && availableEnergy(player, match.turn) < payment.calculatedCost);
}

/** Uncharge one Energy card for the currently declared payment. */
export function tapEnergyCard(input: MatchState, playerId: string, cardId: string): MatchState {
  const state = cloneMatch(input);
  const rules = ensureRulesState(state);
  const payment = rules.pendingPayment;
  if (!payment || payment.playerId !== playerId || payment.status !== "declared") {
    throw new Error("Energy cards can only be uncharged while paying for an announced card or ability.");
  }
  const player = state.players.find((candidate) => candidate.id === playerId) as EnergyPlayerState | undefined;
  if (!player) throw new Error("Unknown player.");
  if (!player.energyZone.some((candidate) => candidate.id === cardId)) throw new Error("That card is not in your Energy Card zone.");
  if (activeUnchargedEnergyIds(player, state.turn).includes(cardId)) throw new Error("That Energy card is already uncharged.");
  if (availableEnergy(player, state.turn) >= payment.calculatedCost) throw new Error("The declared payment already has enough Energy.");
  const result = unchargeEnergyCards(state, playerId, [cardId], { producesEnergy: true });
  if (!result.count) throw new Error("That Energy card cannot be uncharged.");
  payment.selectedEnergyIds = [...new Set([...payment.selectedEnergyIds, ...result.cardIds])];
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-energy-${state.log.length}`,
    at: Date.now(),
    kind: "game",
    message: `${player.name} uncharged an Energy card for the declared payment.`,
  });
  return state;
}
