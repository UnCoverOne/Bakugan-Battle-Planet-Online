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

type EnergyTrackedPlayer = PlayerState & {
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

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

function safeEnergy(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function activeTappedIds(player: EnergyTrackedPlayer, turn: number) {
  if (player.energyTapTurn !== turn || !Array.isArray(player.tappedEnergyIds)) return [];
  const validIds = new Set(player.energyZone.map((card) => card.id));
  return player.tappedEnergyIds.filter((id) => validIds.has(id));
}

function costConditionActive(
  state: MatchState,
  player: PlayerState,
  text: string,
  choices: CardChoices,
) {
  const lower = text.toLowerCase();
  const opponent = state.players.find((candidate) => candidate.id !== player.id);
  if (lower.includes("flow")) return player.cardsPlayedThisTurn > 1;
  if (lower.includes("fury")) return player.hand.length === 0;
  if (lower.includes("turbo")) return Boolean(opponent && player.maxEnergy > opponent.maxEnergy);
  if (lower.includes("domination")) {
    const held = player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    const opposingHeld = opponent?.bakugan.reduce(
      (sum, bakugan) => sum + bakugan.heldCoreCells.length,
      0,
    ) ?? 0;
    return held > opposingHeld;
  }
  if (lower.includes("sacrifice")) return Boolean(choices.discardCardIds?.length);
  if (lower.includes("only have one open bakugan")) {
    return player.bakugan.filter((bakugan) => bakugan.open).length === 1;
  }
  if (lower.includes("three or more heroes")) return player.heroes.length >= 3;
  if (lower.includes("five or more hero")) return player.heroes.length >= 5;
  return false;
}

function currentPool(player: EnergyTrackedPlayer, turn: number) {
  return player.energyTapTurn === turn ? safeEnergy(player.energy) : 0;
}

function untappedCards(player: EnergyTrackedPlayer, turn: number) {
  const tapped = new Set(activeTappedIds(player, turn));
  return player.energyZone.filter((card) => !tapped.has(card.id));
}

/**
 * Mirrors the engine's printed-cost reductions so hover feedback and automatic
 * tapping use the same amount that the authoritative play action will spend.
 */
export function effectiveCardEnergyCost(
  state: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices = {},
) {
  const player = playerById(state, playerId);
  if (!player) return 0;
  const opponent = state.players.find((candidate) => candidate.id !== player.id);
  const tracked = player as EnergyTrackedPlayer;
  const totalCapacity = currentPool(tracked, state.turn) + untappedCards(tracked, state.turn).length;
  let cost = card.cost === "X"
    ? Math.max(0, Math.min(totalCapacity, choices.xValue ?? 0))
    : card.cost;
  const text = card.effect.toLowerCase();

  if (card.type === "Evo") {
    cost -= player.heroes.filter((hero) => hero.name === "Shun Kazami").length;
  }
  if (card.type === "Flip") {
    cost -= player.heroes.filter((hero) => hero.name === "Lightning").length;
  }
  if (text.includes("costs 2 [energy] less") && player.cardsPlayedThisTurn) {
    cost -= 2 * player.cardsPlayedThisTurn;
  }
  if (text.includes("costs 3 [energy] less") && opponent) {
    const held = player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    const opposingHeld = opponent.bakugan.reduce(
      (sum, bakugan) => sum + bakugan.heldCoreCells.length,
      0,
    );
    if (held > opposingHeld) cost -= 3;
  }
  if (
    (text.includes("this is free") || text.includes("play this for free"))
    && costConditionActive(state, player, text, choices)
  ) {
    cost = 0;
  }
  if (card.type === "Flip" && state.damageOrigin) {
    cost += state.frostStrike[state.damageOrigin] ?? 0;
  }
  return Math.max(0, cost);
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
  const availableEnergy = currentPool(player, state.turn);
  const untapped = untappedCards(player, state.turn);
  const shortfall = Math.max(0, cost - availableEnergy);
  const totalEnergy = availableEnergy + untapped.length;
  const kind: CardEnergyPaymentKind = cost <= availableEnergy
    ? "ready"
    : cost <= totalEnergy
      ? "auto-tap"
      : "insufficient";

  return {
    kind,
    cost,
    availableEnergy,
    untappedEnergy: untapped.length,
    totalEnergy,
    shortfall,
    autoTapCardIds: kind === "auto-tap"
      ? untapped.slice(0, shortfall).map((energyCard) => energyCard.id)
      : [],
  };
}

/**
 * Generates only the missing Energy by tapping the first available Energy cards.
 * This is intentionally version-neutral; the following card action owns the
 * single authoritative match-version increment.
 */
export function prepareEnergyPayment(
  input: MatchState,
  playerId: string,
  amount: number,
) {
  const state = cloneMatch(input);
  const player = playerById(state, playerId) as EnergyTrackedPlayer | undefined;
  if (!player) throw new Error("Unknown player.");

  if (player.energyTapTurn !== state.turn) {
    player.energyTapTurn = state.turn;
    player.tappedEnergyIds = [];
    player.energy = 0;
  } else {
    player.tappedEnergyIds = activeTappedIds(player, state.turn);
    player.energy = safeEnergy(player.energy);
  }

  const required = Math.max(0, safeEnergy(amount) - player.energy);
  const untapped = untappedCards(player, state.turn);
  if (untapped.length < required) {
    throw new Error(
      `Not enough Energy. ${safeEnergy(amount)} required, ${player.energy + untapped.length} available.`,
    );
  }

  const tapped = untapped.slice(0, required);
  player.tappedEnergyIds.push(...tapped.map((card) => card.id));
  player.energy += tapped.length;
  player.maxEnergy = player.energyZone.length;
  if (tapped.length) {
    state.log.push({
      id: `${Date.now()}-auto-energy-${state.log.length}`,
      at: Date.now(),
      kind: "game",
      message: `${player.name} automatically tapped ${tapped.length} Energy card${tapped.length === 1 ? "" : "s"}.`,
    });
  }
  return state;
}

export function playCardWithAutoEnergy(
  input: MatchState,
  playerId: string,
  cardId: string,
  choices: CardChoices = {},
) {
  if (hasPendingDraws(input)) {
    throw new Error("Complete every pending Draw action before playing another card.");
  }
  const player = playerById(input, playerId);
  const card = player?.hand.find((candidate) => candidate.id === cardId);
  if (!player || !card) return playCard(input, playerId, cardId, choices);
  if (card.type === "Evo") {
    const target = legalEvoTargets(input, playerId, card)
      .find((candidate) => candidate.id === choices.targetBakuganId);
    if (!target) {
      throw new Error(`Select your matching ${card.evolvesFrom ?? "Bakugan"} Character Card for this Evo.`);
    }
    choices = { ...choices, targetBakuganId: target.id };
  }
  const cost = effectiveCardEnergyCost(input, playerId, card, choices);
  return playCard(prepareEnergyPayment(input, playerId, cost), playerId, cardId, choices);
}
