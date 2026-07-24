import {
  cloneMatch,
  type GameCard,
  type MatchState,
} from "./game";

const DRAW_DECISION_MS = 35_000;

export type PendingDrawRequest = {
  id: string;
  playerId: string;
  remaining: number;
  total: number;
  sourceName: string;
};

export type DrawQueueMetadata = {
  pendingDrawQueue?: PendingDrawRequest[];
  pendingDrawResumePriority?: string;
  pendingDrawResumeDeadline?: number;
  pendingDrawResumeStepLabel?: string;
};

export type DrawQueueMatchState = MatchState & DrawQueueMetadata;

function queuedState(match: MatchState): DrawQueueMatchState {
  return match as DrawQueueMatchState;
}

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function numberWord(value?: string) {
  const words: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const normalized = String(value ?? "").toLowerCase();
  return words[normalized] ?? Math.max(0, Number(normalized) || 0);
}

function log(match: MatchState, message: string) {
  match.log.push({
    id: `${Date.now()}-draw-queue-${match.log.length}`,
    at: Date.now(),
    kind: "game",
    message,
  });
}

export function activePendingDraw(match: MatchState | null | undefined) {
  return match ? queuedState(match).pendingDrawQueue?.[0] ?? null : null;
}

export function hasPendingDraws(match: MatchState | null | undefined) {
  return Boolean(activePendingDraw(match));
}

export function playerCanResolvePendingDraw(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const request = activePendingDraw(match);
  return Boolean(request && playerId && request.playerId === playerId && request.remaining > 0);
}

export function pendingDrawCountForPlayer(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  if (!match || !playerId) return 0;
  return queuedState(match).pendingDrawQueue
    ?.filter((request) => request.playerId === playerId)
    .reduce((sum, request) => sum + request.remaining, 0) ?? 0;
}

export function drawEffectAmount(
  card: GameCard | null | undefined,
  match: MatchState | null | undefined,
  playerId?: string,
) {
  if (!card) return 0;
  const text = card.effect;
  const player = match?.players.find((candidate) => candidate.id === playerId);

  if (/draw a card for each Hero you have in play/i.test(text)) {
    return player?.heroes.length ?? 0;
  }
  if (/draw a card for each Flip card in your discard pile/i.test(text)) {
    return player?.discard.filter((candidate) => candidate.type === "Flip").length ?? 0;
  }
  if (/draw a card for each Energy card you have/i.test(text)) {
    return player?.energyZone.length ?? 0;
  }

  const matchAmount = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  return matchAmount ? numberWord(matchAmount[1]) : 0;
}

export function appendPendingDraws(
  match: MatchState,
  requests: readonly Omit<PendingDrawRequest, "id">[],
) {
  const valid = requests.filter((request) => request.remaining > 0);
  if (!valid.length) return match;
  const state = queuedState(match);
  const existing = state.pendingDrawQueue ?? [];
  if (!existing.length) {
    state.pendingDrawResumePriority = match.priority;
    state.pendingDrawResumeDeadline = match.deadline;
    state.pendingDrawResumeStepLabel = match.stepLabel;
  }
  const created = valid.map((request, index) => ({
    ...request,
    id: `${Date.now()}-${match.version}-${existing.length + index}-${request.playerId}`,
  }));
  state.pendingDrawQueue = [...existing, ...created];
  const active = state.pendingDrawQueue[0];
  match.priority = active.playerId;
  match.stepLabel = `${active.sourceName} • Draw ${active.remaining} card${active.remaining === 1 ? "" : "s"}`;
  match.deadline = Date.now() + DRAW_DECISION_MS;
  return match;
}

export function drawPendingCard(input: MatchState, playerId: string) {
  const request = activePendingDraw(input);
  if (!request || request.playerId !== playerId) {
    throw new Error("You do not have a pending effect draw.");
  }

  const state = queuedState(cloneMatch(input));
  const active = state.pendingDrawQueue![0];
  const player = playerById(state, playerId);
  if (!player) throw new Error("Unknown player.");
  const card = player.deckCards.shift();
  if (card) {
    player.hand.push(card);
    log(state, `${player.name} pressed Draw and drew one card from ${active.sourceName}.`);
  } else {
    log(state, `${player.name} pressed Draw but skipped the draw because their deck is empty.`);
  }
  player.deck = player.deckCards.length;
  active.remaining = Math.max(0, active.remaining - 1);

  if (active.remaining <= 0) state.pendingDrawQueue!.shift();
  const next = state.pendingDrawQueue![0];
  if (next) {
    state.priority = next.playerId;
    state.stepLabel = `${next.sourceName} • Draw ${next.remaining} card${next.remaining === 1 ? "" : "s"}`;
    state.deadline = Date.now() + DRAW_DECISION_MS;
  } else {
    state.priority = state.pendingDrawResumePriority ?? state.priority;
    state.deadline = state.pendingDrawResumeDeadline ?? state.deadline;
    state.stepLabel = state.pendingDrawResumeStepLabel ?? state.stepLabel;
    delete state.pendingDrawQueue;
    delete state.pendingDrawResumePriority;
    delete state.pendingDrawResumeDeadline;
    delete state.pendingDrawResumeStepLabel;
  }
  state.version += 1;
  return state;
}

