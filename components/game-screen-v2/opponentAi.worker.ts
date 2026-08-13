import type { MatchState } from "../../lib/game";
import { chooseOpponentAiCommand } from "../../lib/opponentAi";
import type { GameCommand } from "../../lib/engine/types";

type OpponentAiWorkerRequest = {
  requestId: number;
  match: MatchState;
  playerId: string;
};

type OpponentAiWorkerResponse = {
  requestId: number;
  command?: GameCommand | null;
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
      command: chooseOpponentAiCommand(match, playerId),
    });
  } catch (cause) {
    workerScope.postMessage({
      requestId,
      error: cause instanceof Error ? cause.message : "The opponent AI could not decide.",
    });
  }
};

export {};
