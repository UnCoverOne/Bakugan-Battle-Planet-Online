import { passPriority, type MatchState } from "./game";
import {
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
} from "./rolling";
import { playerCanDrawTurnCard } from "./turnStart";

const PRIORITY_PHASES = new Set<MatchState["phase"]>([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
]);

/**
 * Lightweight readiness check used by the UI. Tactical planning stays
 * inside the opponent worker and is not bundled into the render thread.
 */
export function opponentAiCanAct(match: MatchState, playerId: string) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  if (match.pendingChoice?.schema.fields.some(
    (field) => field.chooserId === playerId && !match.pendingChoice?.answers[playerId],
  )) return true;
  if (match.triggerOrders.some(
    (request) => request.controllerId === playerId && !request.orderedIds,
  )) return true;
  if (
    match.phase === "startingPlayer"
    && Date.now() >= match.startingPlayerRevealedAt
  ) return true;
  if (match.phase === "placement" && match.priority === playerId) return true;
  if (playerCanDrawTurnCard(match, playerId)) return true;
  if (match.phase === "energize" && !player.energizedThisTurn) return true;
  if (match.phase === "selection" && !match.selected[playerId]) return true;
  if (
    (match.phase === "target" || match.phase === "reroll")
    && (
      playerCanSelectRollTarget(match, playerId)
      || playerCanConfirmRoll(match, playerId)
    )
  ) return true;
  if (match.phase === "damage" && match.pendingLoser === playerId) return true;
  if (
    match.phase === "reset"
    && match.batch.length > 0
    && match.priority === playerId
  ) return true;
  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;
  return match.phase === "handLimit" && match.priority === playerId;
}

/**
 * A failed or unavailable tactical worker must not strand a Training match.
 * Passing is always legal in an otherwise-unblocked pre-roll priority window,
 * so use that conservative action when the planner cannot return a decision.
 */
export function recoverOpponentAiPreRollFailure(
  match: MatchState,
  playerId: string,
): MatchState | null {
  if (
    match.phase !== "preRoll"
    || match.priority !== playerId
    || !opponentAiCanAct(match, playerId)
    || match.pendingChoice
    || match.triggerOrders.some((request) => !request.orderedIds)
  ) return null;
  try {
    return passPriority(match, playerId);
  } catch {
    return null;
  }
}
