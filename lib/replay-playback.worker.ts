/// <reference lib="webworker" />

import { buildProjectedReplayBundle, decodeReplayTransport } from "./engine/replay-playback";
import type { ReplayArchive, ReplayBundle, ReplayTransportBundle } from "./engine/replay-types";

type PlaybackWorkerRequest =
  | { requestId: number; type: "archive"; archive: ReplayArchive; playerId: string }
  | { requestId: number; type: "transport"; transport: ReplayTransportBundle };

type PlaybackWorkerResponse = {
  requestId: number;
  bundle?: ReplayBundle;
  error?: string;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PlaybackWorkerRequest>) => void) | null;
  postMessage(message: PlaybackWorkerResponse): void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    workerScope.postMessage({
      requestId: request.requestId,
      bundle: request.type === "archive"
        ? buildProjectedReplayBundle(request.archive, request.playerId)
        : decodeReplayTransport(request.transport),
    });
  } catch (cause) {
    workerScope.postMessage({
      requestId: request.requestId,
      error: cause instanceof Error ? cause.message : "Replay reconstruction failed.",
    });
  }
};

export {};
