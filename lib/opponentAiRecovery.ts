import { passPriority, type MatchState } from "./game";

export const OPPONENT_AI_STALL_TIMEOUT_MS = 4_000;

const RECOVERABLE_PRIORITY_PHASES = new Set<MatchState["phase"]>([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
  "reset",
]);

export function opponentPriorityCanFallback(match: MatchState, playerId: string) {
  if (!RECOVERABLE_PRIORITY_PHASES.has(match.phase) || match.priority !== playerId) return false;
  if (match.pendingChoice) return false;
  if (match.triggerOrders.some((request) => !request.orderedIds)) return false;
  if (match.phase === "reset" && !match.batch.length) return false;
  return true;
}

/**
 * Last-resort progress path for a local AI whose worker stopped responding.
 * Passing priority is rules-authoritative and intentionally sacrifices tactical
 * value rather than allowing a Training match to become permanently stuck.
 */
export function recoverStalledOpponentPriority(
  input: MatchState,
  playerId: string,
): MatchState | null {
  if (!opponentPriorityCanFallback(input, playerId)) return null;
  try {
    return passPriority(input, playerId);
  } catch {
    return null;
  }
}
