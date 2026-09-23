import type { MatchState } from "./game";
import { chooseOpponentAiCommand } from "./opponentAi";
import type { GameCommand } from "./engine/types";

export type OpponentAiWorkerErrorContext = {
  stage: "preflight" | "decision";
  matchId?: string;
  matchVersion?: number;
  phase?: MatchState["phase"];
  playerId?: string;
};

export type OpponentAiWorkerError = {
  name: string;
  message: string;
  stack?: string;
  context: OpponentAiWorkerErrorContext;
};

export type OpponentAiWorkerDecisionRequest = {
  type: "decide";
  requestId: number;
  match: MatchState;
  playerId: string;
};

export type OpponentAiWorkerRequest =
  | { type: "ping"; requestId: number }
  | OpponentAiWorkerDecisionRequest;

export type OpponentAiWorkerResponse = {
  requestId: number;
  ready?: true;
  command?: GameCommand | null;
  error?: OpponentAiWorkerError;
};

export function opponentAiWorkerReadyResponse(requestId: number): OpponentAiWorkerResponse {
  return { requestId, ready: true };
}

/**
 * Schedule Worker construction through a Promise boundary so synchronous
 * constructor failures are observable as rejections instead of escaping a
 * React effect before its .catch() handler is attached.
 */
export function createOpponentAiWorkerAsync<T>(factory: () => T): Promise<T> {
  return Promise.resolve().then(factory);
}

export function serializeOpponentAiWorkerError(
  cause: unknown,
  context: OpponentAiWorkerErrorContext,
): OpponentAiWorkerError {
  if (cause instanceof Error) {
    return {
      name: cause.name || "Error",
      message: cause.message || "The opponent AI could not decide.",
      stack: cause.stack,
      context,
    };
  }
  return {
    name: "Error",
    message: typeof cause === "string" && cause
      ? cause
      : "The opponent AI could not decide.",
    context,
  };
}

/** Pure handler used by the browser Worker and serialized-state regression tests. */
export function decideOpponentAiWorkerRequest(
  request: OpponentAiWorkerDecisionRequest,
): OpponentAiWorkerResponse {
  const { requestId, match, playerId } = request;
  const context: OpponentAiWorkerErrorContext = {
    stage: "decision",
    matchId: match.id,
    matchVersion: match.version,
    phase: match.phase,
    playerId,
  };
  try {
    return {
      requestId,
      command: chooseOpponentAiCommand(match, playerId),
    };
  } catch (cause) {
    return {
      requestId,
      error: serializeOpponentAiWorkerError(cause, context),
    };
  }
}
