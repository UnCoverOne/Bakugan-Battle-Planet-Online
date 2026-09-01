import { cloneMatch, type GameCard, type MatchState } from "./game";
import {
  activePendingDraw,
  drawPendingCard,
  playerCanResolvePendingDraw,
} from "./drawQueue";

const DRAW_STEP_DURATION_MS = 35_000;
const ENERGIZE_STEP_DURATION_MS = 35_000;

export type TurnStartMetadata = {
  drawPreparedTurn?: number;
  drawReadyAt?: number;
  drawDeadline?: number;
  drawnPlayerIds?: string[];
  drawRemainingByPlayer?: Record<string, number>;
};

export type TurnStartMatchState = MatchState & TurnStartMetadata;

function withTurnStartMetadata(match: MatchState): TurnStartMatchState {
  return match as TurnStartMatchState;
}

function drawIds(match: MatchState | null | undefined) {
  if (!match) return [];
  return withTurnStartMetadata(match).drawnPlayerIds ?? [];
}

function remainingDraws(
  match: MatchState | null | undefined,
  playerId: string,
) {
  if (!match) return 0;
  const state = withTurnStartMetadata(match);
  const stored = state.drawRemainingByPlayer?.[playerId];
  if (stored != null) return Math.max(0, stored);
  return drawIds(state).includes(playerId) ? 0 : turnDrawCount(state);
}

function grantsAdditionalTurnDraw(card: GameCard) {
  // Strata has separate printings with separate rules text. The global Draw
  // Step modifier belongs only to Battle Brawlers 192, never to BR 80 merely
  // because both cards share the display name "Strata".
  return card.catalogId === "bb-192"
    || /all players draw an additional card each turn/i.test(card.effect);
}

function startOfGameResolutionPending(match: MatchState | null | undefined) {
  return Boolean(match?.phase === "draw" && (
    match.batch.length > 0 || match.triggerOrders.length > 0 || match.pendingChoice
  ));
}

/**
 * Battle Brawlers Strata is a global ongoing Hero effect. Every copy in play
 * adds one card to every player's normal Draw Step. Each individual card still
 * requires its own Draw confirmation in the Action HUD.
 */
export function additionalTurnDrawCount(match: MatchState | null | undefined) {
  return match?.players.reduce((total, player) => (
    total + player.heroes.filter(grantsAdditionalTurnDraw).length
  ), 0) ?? 0;
}

export function turnDrawCount(match: MatchState | null | undefined) {
  return 1 + additionalTurnDrawCount(match);
}

export function drawStepIsPending(match: MatchState | null | undefined) {
  if (!match) return false;
  const state = withTurnStartMetadata(match);
  return state.turn > 0
    && state.drawPreparedTurn === state.turn
    && state.players.some((player) => remainingDraws(state, player.id) > 0);
}

export function drawStepIsWaiting(
  match: MatchState | null | undefined,
  now = Date.now(),
) {
  if (!drawStepIsPending(match)) return false;
  return now < (withTurnStartMetadata(match!).drawReadyAt ?? 0);
}

export function playerHasDrawnTurnCard(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  return Boolean(playerId && match && remainingDraws(match, playerId) <= 0);
}

export function playerCanDrawTurnCard(
  match: MatchState | null | undefined,
  playerId?: string,
  now = Date.now(),
) {
  if (playerCanResolvePendingDraw(match, playerId)) return true;
  if (activePendingDraw(match)) return false;
  if (startOfGameResolutionPending(match)) return false;
  return Boolean(
    match
    && playerId
    && drawStepIsPending(match)
    && !drawStepIsWaiting(match, now)
    && match.players.some((player) => player.id === playerId)
    && remainingDraws(match, playerId) > 0,
  );
}

export function drawStepTimerState(
  match: MatchState | null | undefined,
  now = Date.now(),
): { label: string; seconds: number } | null {
  if (!match || !drawStepIsPending(match)) return null;
  const state = withTurnStartMetadata(match);
  const readyAt = state.drawReadyAt ?? now;
  if (now < readyAt) {
    return {
      label: "Draw Starts",
      seconds: Math.max(0, Math.ceil((readyAt - now) / 1000)),
    };
  }
  const deadline = state.drawDeadline ?? match.deadline;
  return {
    label: "Step Timer",
    seconds: Math.max(0, Math.ceil((deadline - now) / 1000)),
  };
}


export function drawTurnCard(
  input: MatchState,
  playerId: string,
  now = Date.now(),
): MatchState {
  if (playerCanResolvePendingDraw(input, playerId)) {
    return drawPendingCard(input, playerId);
  }
  if (!playerCanDrawTurnCard(input, playerId, now)) {
    if (drawStepIsWaiting(input, now)) throw new Error("The Draw Step has not begun yet.");
    if (startOfGameResolutionPending(input)) throw new Error("Resolve the start-of-game effects before the Draw Step.");
    if (activePendingDraw(input)) throw new Error("The other player must complete their effect draws first.");
    throw new Error("You cannot draw a turn card now.");
  }

  const state = withTurnStartMetadata(cloneMatch(input));
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  const beforeRemaining = remainingDraws(state, playerId);
  const card = player.deckCards.shift();
  if (card) player.hand.push(card);
  player.deck = player.deckCards.length;
  const afterRemaining = Math.max(0, beforeRemaining - 1);
  state.drawRemainingByPlayer = {
    ...(state.drawRemainingByPlayer ?? {}),
    [playerId]: afterRemaining,
  };

  state.log.push({
    id: `${now}-draw-${player.id}-${beforeRemaining}`,
    at: now,
    kind: "game",
    message: card
      ? `${player.name} pressed Draw and drew one card for the Draw Step${afterRemaining ? ` (${afterRemaining} remaining)` : ""}.`
      : `${player.name} pressed Draw but skipped the draw because their deck is empty${afterRemaining ? ` (${afterRemaining} remaining)` : ""}.`,
  });

  if (afterRemaining <= 0 && !drawIds(state).includes(player.id)) {
    state.drawnPlayerIds = [...drawIds(state), player.id];
  }

  const nextDrawer = state.players.find((candidate) => remainingDraws(state, candidate.id) > 0);
  if (nextDrawer) {
    state.priority = nextDrawer.id;
    state.deadline = now + DRAW_STEP_DURATION_MS;
  }

  if (state.players.every((candidate) => remainingDraws(state, candidate.id) <= 0)) {
    state.phase = "energize";
    state.priority = state.startingPlayer;
    state.passes = [];
    state.stepLabel = `Turn ${state.turn} • Energize Step`;
    state.deadline = now + ENERGIZE_STEP_DURATION_MS;
    state.log.push({
      id: `${now}-energize-step-${state.turn}`,
      at: now,
      kind: "game",
      message: "Both players completed every Draw action and may Energize once.",
    });
  }

  state.version += 1;
  return state;
}
