import {
  decideOpponentAiWorkerRequest,
  opponentAiWorkerReadyResponse,
  type OpponentAiWorkerRequest,
  type OpponentAiWorkerResponse,
} from "../../lib/opponentAiWorkerProtocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<OpponentAiWorkerRequest>) => void) | null;
  postMessage: (message: OpponentAiWorkerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  if (event.data.type === "ping") {
    workerScope.postMessage(opponentAiWorkerReadyResponse(event.data.requestId));
    return;
  }
  workerScope.postMessage(decideOpponentAiWorkerRequest(event.data));
};

export {};
