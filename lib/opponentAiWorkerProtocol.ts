import type { MatchState } from "./game";
import { chooseOpponentAiCommand } from "./opponentAi";
import type { GameCommand } from "./engine/types";

export type OpponentAiWorkerRequest = {
  requestId: number;
  match: MatchState;
  playerId: string;
};

export type OpponentAiWorkerResponse = {
  requestId: number;
  command?: GameCommand | null;
  error?: string;
};

/** Pure handler used by the browser Worker and serialized-state regression tests. */
export function decideOpponentAiWorkerRequest(
  request: OpponentAiWorkerRequest,
): OpponentAiWorkerResponse {
  const { requestId, match, playerId } = request;
  try {
    return {
      requestId,
      command: chooseOpponentAiCommand(match, playerId),
    };
  } catch (cause) {
    return {
      requestId,
      error: cause instanceof Error ? cause.message : "The opponent AI could not decide.",
    };
  }
}
