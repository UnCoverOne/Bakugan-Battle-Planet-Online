import type { MatchState } from "../../lib/game";
import { advanceOpponentAi } from "../../lib/opponentAi";

type OpponentAiWorkerRequest = {
  requestId: number;
  match: MatchState;
  playerId: string;
};

type OpponentAiWorkerResponse = {
  requestId: number;
  next?: MatchState | null;
  error?: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<OpponentAiWorkerRequest>) => void) | null;
  postMessage: (message: OpponentAiWorkerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const { requestId, match, playerId } = event.data;
  try {
    workerScope.postMessage({
      requestId,
      next: advanceOpponentAi(match, playerId),
    });
  } catch (cause) {
    workerScope.postMessage({
      requestId,
      error: cause instanceof Error ? cause.message : "The opponent AI could not decide.",
    });
  }
};

export {};
