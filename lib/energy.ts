import {
  cloneMatch,
  type GameCard,
  type MatchState,
  type PlayerState,
} from "./game";

type EnergyPlayerState = PlayerState & {
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

export type EnergyZoneView = {
  cards: readonly GameCard[];
  tappedEnergyIds: readonly string[];
  availableEnergy: number;
  maxEnergy: number;
};

export type EnergyZoneViews = {
  player: EnergyZoneView;
  opponent: EnergyZoneView;
};

const EMPTY_ENERGY_ZONE_VIEW: EnergyZoneView = {
  cards: [],
  tappedEnergyIds: [],
  availableEnergy: 0,
  maxEnergy: 0,
};

const BLOCKED_TAP_PHASES = new Set<MatchState["phase"]>([
  "lobby",
  "placement",
  "energize",
  "result",
]);

function safeEnergy(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function activeTappedIds(player: EnergyPlayerState, turn: number): string[] {
  if (player.energyTapTurn !== turn || !Array.isArray(player.tappedEnergyIds)) return [];
  const energyCardIds = new Set(player.energyZone.map((card) => card.id));
  return player.tappedEnergyIds.filter((id) => energyCardIds.has(id));
}

export function energyZoneView(
  player: PlayerState | null | undefined,
  turn: number,
): EnergyZoneView {
  if (!player) return EMPTY_ENERGY_ZONE_VIEW;
  const energyPlayer = player as EnergyPlayerState;
  const cards = Array.isArray(player.energyZone) ? player.energyZone : [];
  const currentTurn = Number.isFinite(turn) ? Math.max(0, Math.floor(turn)) : 0;
  const isCurrentTurn = energyPlayer.energyTapTurn === currentTurn;

  return {
    cards,
    tappedEnergyIds: activeTappedIds(energyPlayer, currentTurn),
    // Older matches used `energy` as automatically charged Energy. Until a
    // player taps a card in the current turn, expose zero generated Energy so
    // the new physical interaction remains authoritative.
    availableEnergy: isCurrentTurn ? safeEnergy(player.energy) : 0,
    maxEnergy: cards.length,
  };
}

export function energyZoneViews(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): EnergyZoneViews {
  if (!match?.players.length) {
    return { player: EMPTY_ENERGY_ZONE_VIEW, opponent: EMPTY_ENERGY_ZONE_VIEW };
  }

  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];
  const opponent = match.players.find((candidate) => candidate.id !== player.id);

  return {
    player: energyZoneView(player, match.turn),
    opponent: energyZoneView(opponent, match.turn),
  };
}

export function energyCardCanTap(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  cardId: string,
): boolean {
  if (!match || !playerId || BLOCKED_TAP_PHASES.has(match.phase)) return false;
  const player = match.players.find((candidate) => candidate.id === playerId) as EnergyPlayerState | undefined;
  if (!player?.energyZone.some((card) => card.id === cardId)) return false;
  return !activeTappedIds(player, match.turn).includes(cardId);
}

/**
 * Tap one face-down Energy card to generate one available Energy.
 *
 * `energyTapTurn` makes the new manual resource model backwards compatible
 * with saved matches that predate individual tapped-card state. The first tap
 * in a turn clears the old automatically charged value, then every distinct
 * card tapped during that turn contributes exactly one Energy.
 */
export function tapEnergyCard(
  input: MatchState,
  playerId: string,
  cardId: string,
): MatchState {
  const state = cloneMatch(input);
  if (BLOCKED_TAP_PHASES.has(state.phase)) {
    throw new Error("Energy cards cannot be tapped during this phase.");
  }

  const player = state.players.find((candidate) => candidate.id === playerId) as EnergyPlayerState | undefined;
  if (!player) throw new Error("Unknown player.");
  const card = player.energyZone.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("That card is not in your Energy Card zone.");

  if (player.energyTapTurn !== state.turn) {
    player.energyTapTurn = state.turn;
    player.tappedEnergyIds = [];
    player.energy = 0;
  } else {
    player.tappedEnergyIds = activeTappedIds(player, state.turn);
  }

  if (player.tappedEnergyIds.includes(cardId)) {
    throw new Error("That Energy card is already tapped.");
  }

  player.tappedEnergyIds.push(cardId);
  player.maxEnergy = player.energyZone.length;
  player.energy = safeEnergy(player.energy) + 1;
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-energy-${state.log.length}`,
    at: Date.now(),
    kind: "game",
    message: `${player.name} tapped an Energy card and generated 1 Energy.`,
  });
  return state;
}
