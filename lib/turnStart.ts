import { cloneMatch, type GameCard, type MatchState } from "./game";

const FIRST_DRAW_DELAY_MS = 3_000;
const DRAW_STEP_DURATION_MS = 35_000;
const ENERGIZE_STEP_DURATION_MS = 35_000;

export type TurnStartMetadata = {
  drawPreparedTurn?: number;
  drawReadyAt?: number;
  drawDeadline?: number;
  drawnPlayerIds?: string[];
};

export type TurnStartMatchState = MatchState & TurnStartMetadata;

function withTurnStartMetadata(match: MatchState): TurnStartMatchState {
  return match as TurnStartMatchState;
}

function drawIds(match: MatchState | null | undefined) {
  if (!match) return [];
  return withTurnStartMetadata(match).drawnPlayerIds ?? [];
}

function isStrata(card: GameCard) {
  return card.name === "Strata"
    || /all players draw an additional card each turn/i.test(card.effect);
}

/**
 * Strata is a global ongoing Hero effect. Every copy in play adds one card to
 * every player's normal Draw Step. The cards are still drawn only when that
 * player confirms Draw through the Action HUD.
 */
export function additionalTurnDrawCount(match: MatchState | null | undefined) {
  return match?.players.reduce((total, player) => (
    total + player.heroes.filter(isStrata).length
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
    && drawIds(state).length < state.players.length;
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
  return Boolean(playerId && match && drawIds(match).includes(playerId));
}

export function playerCanDrawTurnCard(
  match: MatchState | null | undefined,
  playerId?: string,
  now = Date.now(),
) {
  return Boolean(
    match
    && playerId
    && drawStepIsPending(match)
    && !drawStepIsWaiting(match, now)
    && match.players.some((player) => player.id === playerId)
    && !playerHasDrawnTurnCard(match, playerId),
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

/**
 * The legacy engine currently enters Energize after automatically drawing.
 * Convert that transition into a dedicated, player-confirmed Draw Step by
 * returning those just-drawn cards to the top of each deck. The temporary
 * retract engine phase prevents legacy Energize automation from firing while
 * the Draw Step is pending; the visible step label remains Draw.
 */
export function preparePendingDraw(input: MatchState, now = Date.now()): MatchState {
  const current = withTurnStartMetadata(input);
  if (
    current.turn <= 0
    || current.phase !== "energize"
    || current.drawPreparedTurn === current.turn
    || !/Energize Step/i.test(current.stepLabel)
  ) {
    return input;
  }

  const state = withTurnStartMetadata(cloneMatch(input));
  const recentTurnEntries = state.log.slice(-(state.players.length + 2));
  for (const player of state.players) {
    const legacyDrawFailed = recentTurnEntries.some((item) => (
      item.message === `${player.name} could not draw because their deck is empty.`
    ));
    if (!legacyDrawFailed) {
      const drawnCard = player.hand.pop();
      if (drawnCard) player.deckCards.unshift(drawnCard);
    }
    player.deck = player.deckCards.length;
  }

  const delay = state.turn === 1 ? FIRST_DRAW_DELAY_MS : 0;
  state.drawPreparedTurn = state.turn;
  state.drawReadyAt = now + delay;
  state.drawDeadline = state.drawReadyAt + DRAW_STEP_DURATION_MS;
  state.drawnPlayerIds = [];
  state.phase = "retract";
  state.priority = state.startingPlayer;
  state.passes = [];
  state.stepLabel = delay
    ? `Turn ${state.turn} • Draw Step begins in 3 seconds`
    : `Turn ${state.turn} • Draw Step`;
  state.deadline = state.drawDeadline;
  state.log = state.log.filter((item) => !item.message.includes(
    `Turn ${state.turn} began. Both players drew a card and may Energize once.`,
  ));
  state.log.push({
    id: `${now}-draw-step-${state.turn}`,
    at: now,
    kind: "game",
    message: delay
      ? `Turn ${state.turn} is ready. The Draw Step begins in three seconds.`
      : `Turn ${state.turn} began. Both players must draw a card.`,
  });
  // Preparing Draw changes the authoritative phase and must therefore advance
  // the same monotonic version used by online conflict checks and same-tab sync.
  state.version += 1;
  return state;
}

export function drawTurnCard(
  input: MatchState,
  playerId: string,
  now = Date.now(),
): MatchState {
  if (!playerCanDrawTurnCard(input, playerId, now)) {
    if (drawStepIsWaiting(input, now)) throw new Error("The Draw Step has not begun yet.");
    throw new Error("You cannot draw a turn card now.");
  }

  const state = withTurnStartMetadata(cloneMatch(input));
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  const requested = turnDrawCount(state);
  let drawn = 0;
  while (drawn < requested) {
    const card = player.deckCards.shift();
    if (!card) break;
    player.hand.push(card);
    drawn += 1;
  }

  if (drawn > 0) {
    state.log.push({
      id: `${now}-draw-${player.id}`,
      at: now,
      kind: "game",
      message: requested > 1
        ? `${player.name} pressed Draw and drew ${drawn} cards for the Draw Step (${requested - 1} additional from Strata).`
        : `${player.name} drew a card for the Draw Step.`,
    });
  }
  if (drawn < requested) {
    state.log.push({
      id: `${now}-draw-empty-${player.id}`,
      at: now,
      kind: "game",
      message: `${player.name} could not draw ${requested - drawn} card${requested - drawn === 1 ? "" : "s"} because their deck is empty.`,
    });
  }
  player.deck = player.deckCards.length;
  state.drawnPlayerIds = [...drawIds(state), player.id];

  if (state.players.every((candidate) => state.drawnPlayerIds!.includes(candidate.id))) {
    state.phase = "energize";
    state.priority = state.startingPlayer;
    state.passes = [];
    state.stepLabel = `Turn ${state.turn} • Energize Step`;
    state.deadline = now + ENERGIZE_STEP_DURATION_MS;
    state.log.push({
      id: `${now}-energize-step-${state.turn}`,
      at: now,
      kind: "game",
      message: "Both players completed the Draw Step and may Energize once.",
    });
  }

  state.version += 1;
  return state;
}
