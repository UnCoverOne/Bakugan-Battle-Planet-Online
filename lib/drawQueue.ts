import {
  cloneMatch,
  type GameCard,
  type MatchState,
  type PendingEffect,
  type PlayerState,
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

function restoreImmediateDrawnCards(
  beforePlayer: PlayerState,
  afterPlayer: PlayerState,
  amount: number,
) {
  const expected = beforePlayer.deckCards.slice(0, amount);
  const afterHandIds = new Set(afterPlayer.hand.map((card) => card.id));
  const restored = expected.filter((card) => afterHandIds.has(card.id));
  if (!restored.length) return 0;
  const restoredIds = new Set(restored.map((card) => card.id));
  afterPlayer.hand = afterPlayer.hand.filter((card) => !restoredIds.has(card.id));
  afterPlayer.deckCards = [
    ...restored.map((card) => structuredClone(card)),
    ...afterPlayer.deckCards.filter((card) => !restoredIds.has(card.id)),
  ];
  afterPlayer.deck = afterPlayer.deckCards.length;
  return restored.length;
}

function drawWasAttempted(
  before: MatchState,
  after: MatchState,
  playerId: string,
  restored: number,
) {
  if (restored > 0) return true;
  return after.log.slice(before.log.length).some((entry) => (
    /could not draw because their deck is empty/i.test(entry.message)
    && after.players.find((player) => player.id === playerId)?.name
    && entry.message.includes(after.players.find((player) => player.id === playerId)!.name)
  ));
}

function removeLegacyEmptyDrawLogs(before: MatchState, after: MatchState) {
  after.log = [
    ...after.log.slice(0, before.log.length),
    ...after.log.slice(before.log.length).filter((entry) => (
      !/could not draw because their deck is empty/i.test(entry.message)
    )),
  ];
}

/**
 * The compact legacy resolver draws every card in one synchronous loop. Rewind
 * only the cards drawn by a resolving multi-draw effect, then expose one Draw
 * action per printed draw without changing the rest of that effect's outcome.
 */
export function reconcileResolvedDrawEffect(
  before: MatchState,
  after: MatchState,
  pending: PendingEffect | null | undefined,
) {
  if (!pending) return after;
  const amount = drawEffectAmount(pending.card, before, pending.controllerId);
  if (amount <= 1) return after;
  const beforePlayer = playerById(before, pending.controllerId);
  const afterPlayer = playerById(after, pending.controllerId);
  if (!beforePlayer || !afterPlayer) return after;
  const restored = restoreImmediateDrawnCards(beforePlayer, afterPlayer, amount);
  if (!drawWasAttempted(before, after, pending.controllerId, restored)) return after;
  removeLegacyEmptyDrawLogs(before, after);
  return appendPendingDraws(after, [{
    playerId: pending.controllerId,
    remaining: amount,
    total: amount,
    sourceName: pending.card.displayName || pending.card.name || "Card effect",
  }]);
}

/**
 * Attack-triggered Hero draws occur when the Victor window closes, outside the
 * Batch object that caused that transition. Reconstruct the engine's Hero order
 * so only multi-card attack draws become click-by-click requests; ordinary
 * one-card attack triggers remain immediate.
 */
export function reconcileAttackDrawEffects(
  before: MatchState,
  after: MatchState,
  damage: number,
) {
  const attacker = before.players.find((player) => player.id === before.brawlWinner);
  const afterAttacker = after.players.find((player) => player.id === before.brawlWinner);
  if (!attacker || !afterAttacker || damage < 10) return after;
  let deckOffset = 0;
  const requests: Omit<PendingDrawRequest, "id">[] = [];

  for (const hero of attacker.heroes) {
    if (/When one of your Bakugan attacks, draw a card/i.test(hero.effect)) deckOffset += 1;
    if (!/If you deal 10 or more damage/i.test(hero.effect)) continue;
    const amount = drawEffectAmount(hero, before, attacker.id);
    if (amount <= 1) continue;
    const sliceBefore = { ...attacker, deckCards: attacker.deckCards.slice(deckOffset) } as PlayerState;
    const restored = restoreImmediateDrawnCards(sliceBefore, afterAttacker, amount);
    if (restored > 0 || attacker.deckCards.length <= deckOffset) {
      requests.push({
        playerId: attacker.id,
        remaining: amount,
        total: amount,
        sourceName: hero.displayName || hero.name,
      });
    }
    deckOffset += amount;
  }
  if (!requests.length) return after;
  removeLegacyEmptyDrawLogs(before, after);
  return appendPendingDraws(after, requests);
}
