import type { GameCard, MatchState, PlayerState } from "../../lib/game";

export type ZoneOwner = "player" | "opponent";

export type GameScreenOwnerState = {
  characterCards: readonly GameCard[];
  heroCards: readonly GameCard[];
  deckCount: number;
  discardCount: number;
  latestDiscard: GameCard | null;
};

export type GameScreenZoneState = Record<ZoneOwner, GameScreenOwnerState>;

const EMPTY_OWNER_STATE: GameScreenOwnerState = {
  characterCards: [],
  heroCards: [],
  deckCount: 0,
  discardCount: 0,
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
 * Keep the Hero cards centred while reducing the gap as the stack grows. The
 * cards stay readable at low counts and compress into a denser fan at high counts.
 */
export function heroCardLayout(cardCount: number) {
  const count = safeCardCount(cardCount);
  const cardWidthPercent = 28;
  if (count <= 1) {
    return { startPercent: (100 - cardWidthPercent) / 2, stepPercent: 0 };
  }

  const usableSpreadPercent = 64;
  const stepPercent = Math.min(14, usableSpreadPercent / (count - 1));
  const occupiedWidthPercent = cardWidthPercent + stepPercent * (count - 1);
  return {
    startPercent: Math.max(4, (100 - occupiedWidthPercent) / 2),
    stepPercent,
  };
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
