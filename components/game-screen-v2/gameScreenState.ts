import type { GameCard, MatchState, Placement, PlayerState } from "../../lib/game";

export type ZoneOwner = "player" | "opponent";

export type GameScreenOwnerState = {
  characterCards: readonly GameCard[];
  heroCards: readonly GameCard[];
  deckCount: number;
  discardCount: number;
  discardCards: readonly GameCard[];
  latestDiscard: GameCard | null;
};

export type GameScreenZoneState = Record<ZoneOwner, GameScreenOwnerState>;

const EMPTY_OWNER_STATE: GameScreenOwnerState = {
  characterCards: [],
  heroCards: [],
  deckCount: 0,
  discardCount: 0,
  discardCards: [],
  latestDiscard: null,
};

export const EMPTY_GAME_SCREEN_ZONE_STATE: GameScreenZoneState = {
  player: EMPTY_OWNER_STATE,
  opponent: EMPTY_OWNER_STATE,
};

export function safeCardCount(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

/**
 * One rendered card back represents up to four physical cards. The visual stack
 * therefore ranges from zero assets for an empty deck to ten assets for a full
 * forty-card deck.
 */
export function deckBackAssetCount(deckCount: number) {
  const count = safeCardCount(deckCount);
  if (count === 0) return 0;
  return Math.min(10, Math.ceil(count / 4));
}

/**
 * Hero cards use the same physical dimensions as cards in the single-card zones.
 * Their horizontal gap compresses as the stack grows while the complete stack
 * remains centred inside the wider Hero zone.
 */
export function heroCardLayout(cardCount: number) {
  const count = safeCardCount(cardCount);
  const cardWidthPercent = 42.75;
  if (count <= 1) {
    return { startPercent: (100 - cardWidthPercent) / 2, stepPercent: 0 };
  }

  const usableSpreadPercent = 52.5;
  const stepPercent = Math.min(12, usableSpreadPercent / (count - 1));
  const occupiedWidthPercent = cardWidthPercent + stepPercent * (count - 1);
  return {
    startPercent: Math.max(2.375, (100 - occupiedWidthPercent) / 2),
    stepPercent,
  };
}

/**
 * Held BakuCores remain centred above their Bakugan. As the zone fills, the
 * individual Cores become slightly smaller and overlap more rather than
 * overflowing into the neighbouring Character Card zones.
 */
export function heldCoreFanLayout(coreCount: number) {
  const count = safeCardCount(coreCount);
  if (count <= 1) {
    return {
      stepPercent: 0,
      widthPercent: 38,
      rotationStepDegrees: 0,
    };
  }

  const widthPercent = Math.max(20, 38 - (count - 1) * 2.7);
  const usableSpreadPercent = Math.max(48, 78 - widthPercent);
  return {
    stepPercent: usableSpreadPercent / (count - 1),
    widthPercent,
    rotationStepDegrees: Math.min(5.5, 18 / (count - 1)),
  };
}

export function hideMatrixPlacements(
  match: MatchState | null | undefined,
): readonly Placement[] {
  return match?.placements.filter((placement) => !placement.attachedTo) ?? [];
}

export function heldCorePlacements(
  match: MatchState | null | undefined,
  bakuganId: string,
): readonly Placement[] {
  return match?.placements
    .filter((placement) => placement.attachedTo === bakuganId)
    .sort((a, b) => a.order - b.order) ?? [];
}

function ownerState(player?: PlayerState): GameScreenOwnerState {
  if (!player) return EMPTY_OWNER_STATE;
  const deckCount = Array.isArray(player.deckCards)
    ? player.deckCards.length
    : safeCardCount(player.deck);
  const discard = Array.isArray(player.discard) ? player.discard : [];

  return {
    characterCards: player.bakugan.slice(0, 3).map((bakugan) => bakugan.character),
    heroCards: Array.isArray(player.heroes) ? player.heroes : [],
    deckCount,
    discardCount: discard.length,
    discardCards: discard,
    latestDiscard: discard.at(-1) ?? null,
  };
}

export function buildGameScreenZoneState(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): GameScreenZoneState {
  if (!match?.players.length) return EMPTY_GAME_SCREEN_ZONE_STATE;

  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];
  const opponent = match.players.find((candidate) => candidate.id !== player.id);

  return {
    player: ownerState(player),
    opponent: ownerState(opponent),
  };
}
