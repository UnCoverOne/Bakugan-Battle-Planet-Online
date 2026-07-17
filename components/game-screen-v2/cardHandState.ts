import type { GameCard, MatchState, PlayerState } from "../../lib/game";

const IDEAL_ANGLE_STEP_DEGREES = 5.25;
const MIN_FAN_SPAN_DEGREES = 7.5;
const MAX_FAN_SPAN_DEGREES = 42;
const CARD_HEIGHT_RATIO = 7 / 5;

export type HandCardPosition = {
  rotationDegrees: number;
  zIndex: number;
};

export type HandFanGeometry = {
  cardWidth: number;
  fanRadius: number;
  spanDegrees: number;
  renderedWidth: number;
};

function finiteNonNegative(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function handPlayers(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): { player: PlayerState | null; opponent: PlayerState | null } {
  if (!match?.players.length) return { player: null, opponent: null };
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
  const opponent = player
    ? match.players.find((candidate) => candidate.id !== player.id) ?? null
    : null;
  return { player, opponent };
}

export function playerHandCards(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): readonly GameCard[] {
  const { player } = handPlayers(match, playerId);
  return Array.isArray(player?.hand) ? player.hand : [];
}

export function opponentHandCardCount(
  match: MatchState | null | undefined,
  playerId: string | undefined,
): number {
  const { opponent } = handPlayers(match, playerId);
  return Array.isArray(opponent?.hand) ? opponent.hand.length : 0;
}

export function handFanSpanDegrees(cardCount: number): number {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  if (count <= 1) return 0;
  return Math.min(
    MAX_FAN_SPAN_DEGREES,
    Math.max(MIN_FAN_SPAN_DEGREES, (count - 1) * IDEAL_ANGLE_STEP_DEGREES),
  );
}

/**
 * Exact axis-aligned width of the radial fan. The top corners are furthest from
 * the shared pivot, so accounting for them guarantees that every rotated card
 * remains inside the reserved horizontal corridor.
 */
export function handFanRenderedWidth(
  cardWidth: number,
  fanRadius: number,
  spanDegrees: number,
): number {
  const width = finiteNonNegative(cardWidth);
  if (width === 0) return 0;
  const radius = finiteNonNegative(fanRadius);
  const halfAngle = finiteNonNegative(spanDegrees) * Math.PI / 360;
  if (halfAngle === 0) return width;

  const halfWidth = width / 2;
  const cardHeight = width * CARD_HEIGHT_RATIO;
  return 2 * (
    halfWidth * Math.cos(halfAngle)
    + (cardHeight + radius) * Math.sin(halfAngle)
  );
}

/**
 * Fit a fan between the Character Cards and the play-area card zones without
 * ever changing the established card size. When the ideal fan is too wide,
 * equal angular spacing is compressed until the complete fan fits. A corridor
 * narrower than one card is the only unsatisfiable case; card-size consistency
 * deliberately takes precedence over shrinking the card.
 */
export function boundedHandFanGeometry({
  cardCount,
  safeWidth,
  desiredCardWidth,
  radiusRatio,
}: {
  cardCount: number;
  safeWidth: number;
  desiredCardWidth: number;
  /** @deprecated Card size is fixed; retained for call-site compatibility. */
  minimumCardWidth?: number;
  radiusRatio: number;
}): HandFanGeometry {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  const widthLimit = Math.max(1, finiteNonNegative(safeWidth, 1));
  const cardWidth = Math.max(1, finiteNonNegative(desiredCardWidth, 1));
  const ratio = finiteNonNegative(radiusRatio);
  const fanRadius = cardWidth * ratio;
  const desiredSpan = handFanSpanDegrees(count);
  let spanDegrees = desiredSpan;

  if (handFanRenderedWidth(cardWidth, fanRadius, desiredSpan) > widthLimit) {
    if (widthLimit <= cardWidth) {
      spanDegrees = 0;
    } else {
      let low = 0;
      let high = desiredSpan;
      for (let iteration = 0; iteration < 40; iteration += 1) {
        const middle = (low + high) / 2;
        if (handFanRenderedWidth(cardWidth, fanRadius, middle) <= widthLimit) {
          low = middle;
        } else {
          high = middle;
        }
      }
      spanDegrees = low;
    }
  }

  return {
    cardWidth,
    fanRadius,
    spanDegrees,
    renderedWidth: handFanRenderedWidth(cardWidth, fanRadius, spanDegrees),
  };
}

/**
 * Preserve the established near-screen-edge position on normal landscape
 * displays, but follow the playmat edge when a tall viewport creates a large
 * empty band above or below it.
 */
export function handViewportEdgeOffset(
  viewportHeight: number,
  playAreaTop: number,
  playAreaBottom: number,
  owner: "player" | "opponent",
  normalEdgeAllowance = 48,
): number {
  const viewport = finiteNonNegative(viewportHeight);
  const top = finiteNonNegative(playAreaTop);
  const bottom = finiteNonNegative(playAreaBottom);
  const allowance = finiteNonNegative(normalEdgeAllowance);
  return owner === "player"
    ? Math.max(0, viewport - bottom - allowance)
    : Math.max(0, top - allowance);
}

export function handCardLayout(
  cardCount: number,
  requestedSpanDegrees = handFanSpanDegrees(cardCount),
): readonly HandCardPosition[] {
  const count = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  if (count === 0) return [];
  if (count === 1) return [{ rotationDegrees: 0, zIndex: 1 }];

  const spanDegrees = Math.min(
    handFanSpanDegrees(count),
    finiteNonNegative(requestedSpanDegrees),
  );
  const stepDegrees = spanDegrees / (count - 1);

  return Array.from({ length: count }, (_, index) => {
    const rotationDegrees = -spanDegrees / 2 + stepDegrees * index;
    return {
      rotationDegrees: Math.abs(rotationDegrees) < 1e-10 ? 0 : rotationDegrees,
      // Cards are ordered left-to-right. Increasing the stacking level makes
      // every card on the right overlap the card immediately to its left.
      zIndex: index + 1,
    };
  });
}
