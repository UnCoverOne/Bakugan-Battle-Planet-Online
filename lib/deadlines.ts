import {
  beginCorePlacement,
  concedeMatch,
  discardToHandLimit,
  energizeCard,
  legalPlacementCells,
  nextTurn,
  orderTriggers,
  selectBakugan,
  submitCardChoice,
  type MatchState,
} from "./game";
import {
  legalCoreReturnCells,
  pendingCoreReturnsForPlayer,
  placeCoreOrReturnCore,
} from "./coreReturns";
import { flipDamageCard, resolveManualDamage } from "./manualDamage";
import {
  flipTieBreakCard,
  manualTieBreakState,
  passPriorityWithTieBreak,
} from "./manualTieBreak";
import { confirmRoll, playerCanConfirmRoll, playerCanSelectRollTarget, selectRollTarget } from "./rolling";
import { drawTurnCard, playerCanDrawTurnCard } from "./turnStart";
import { applyConnectionGrace, recordDecisionTimeout, timeoutChoicesForFields } from "./engine/timeout-policy";

/** Deterministic timeout policy shared by HTTP recovery and Durable Object alarms. */
export function resolveExpiredDeadline(input: MatchState, now = Date.now()) {
  if (input.phase === "startingPlayer" && now >= input.startingPlayerRevealedAt) return beginCorePlacement(input, now);
  if (now <= input.deadline || ["lobby", "result"].includes(input.phase)) return input;
  const state = structuredClone(input);
  const tieBreak = manualTieBreakState(state);
  if (tieBreak?.status === "resolved") {
    return passPriorityWithTieBreak(state, tieBreak.secondPasserId);
  }
  if (tieBreak?.status === "waiting") {
    const nextPlayer = state.players.find((player) => !tieBreak.current[player.id]);
    return nextPlayer ? flipTieBreakCard(state, nextPlayer.id) : input;
  }
  if (state.phase === "charge") return nextTurn(state);
  if (
    state.phase === "reset"
    && !state.pendingChoice
    && !state.batch.length
    && !state.triggerOrders.length
  ) return nextTurn(state);
  const actorId = state.priority;
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) return input;
  if (!actor.connected && applyConnectionGrace(state, actorId, now)) return state;
  const decisionTimeouts = recordDecisionTimeout(state, actorId);
  if (decisionTimeouts >= 3 && ["preRoll", "power", "victor", "damage", "postDamage", "reroll", "retract", "endPlay", "reset", "handLimit"].includes(state.phase)) return concedeMatch(state, actorId);
  if (state.pendingChoice) {
    const fields = state.pendingChoice.schema.fields.filter((candidate) => candidate.chooserId === actorId);
    if (!fields.length) return input;
    return submitCardChoice(state, actorId, timeoutChoicesForFields(state, actorId, fields));
  }
  const triggerOrder = state.triggerOrders.find((request) => request.controllerId === actorId && !request.orderedIds);
  if (triggerOrder) return orderTriggers(state, actorId, triggerOrder.id, triggerOrder.triggerIds);
  if (state.phase === "retract") {
    const core = pendingCoreReturnsForPlayer(state, actorId)[0]?.core;
    const cell = legalCoreReturnCells(state)[0];
    return core && cell ? placeCoreOrReturnCore(state, actorId, core.id, cell) : input;
  }
  if (state.phase === "placement") {
    const used = new Set(state.placements.filter((placement) => placement.playerId === actorId).map((placement) => placement.core.id));
    const core = actor.cores.find((candidate) => !used.has(candidate.id));
    const cell = legalPlacementCells(state)[0];
    return core && cell ? placeCoreOrReturnCore(state, actorId, core.id, cell) : input;
  }
  if (state.phase === "draw" && playerCanDrawTurnCard(state, actorId, now)) return drawTurnCard(state, actorId, now);
  if (state.phase === "energize" && !actor.energizedThisTurn) return energizeCard(state, actorId);
  if (state.phase === "selection" && !state.selected[actorId]) {
    const bakugan = actor.bakugan.find((candidate) => !candidate.open) ?? actor.bakugan[0];
    return bakugan ? selectBakugan(state, actorId, bakugan.id) : input;
  }
  if (state.phase === "target" || state.phase === "reroll") {
    if (playerCanSelectRollTarget(state, actorId)) {
      const target = state.placements.find((placement) => !placement.attachedTo);
      return target ? selectRollTarget(state, actorId, target.cell) : input;
    }
    if (playerCanConfirmRoll(state, actorId)) return confirmRoll(state, actorId);
  }
  if (state.phase === "damage" && state.pendingLoser === actorId) {
    if (state.revealedFlip) return resolveManualDamage(state, actorId);
    if (state.pendingDamage > 0) return flipDamageCard(state, actorId);
  }
  if (["preRoll", "power", "victor", "postDamage", "endPlay", "reset"].includes(state.phase)) return passPriorityWithTieBreak(state, actorId);
  if (state.phase === "handLimit") {
    const amount = Math.max(0, actor.hand.length - 7);
    return discardToHandLimit(state, actorId, actor.hand.slice(0, amount).map((card) => card.id));
  }
  return input;
}

export function nextMatchAlarmAt(match: MatchState, now = Date.now()) {
  const twoHours = now + 2 * 60 * 60 * 1_000;
  if (match.phase === "lobby" || match.phase === "result") return twoHours;
  const deadline = match.phase === "startingPlayer"
    ? Math.min(match.deadline, match.startingPlayerRevealedAt)
    : match.deadline;
  return Math.max(now + 1_000, Number.isFinite(deadline) ? deadline : now + 30_000);
}
