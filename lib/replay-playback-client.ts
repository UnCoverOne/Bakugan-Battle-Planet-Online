import type { ReplayArchive, ReplayBundle, ReplayTransportBundle } from "./engine/replay-types";

type PlaybackRequest =
  | { type: "archive"; archive: ReplayArchive; playerId: string }
  | { type: "transport"; transport: ReplayTransportBundle };

type PendingReplay = {
  resolve(bundle: ReplayBundle): void;
  reject(error: Error): void;
  request: PlaybackRequest;
  timeout: number;
};

type PlaybackWorkerResponse = { requestId: number; bundle?: ReplayBundle; error?: string };

let worker: Worker | null = null;
let requestSequence = 0;
const pending = new Map<number, PendingReplay>();
const PLAYBACK_WORKER_TIMEOUT_MS = 12_000;

async function reconstructWithoutWorker(request: PlaybackRequest) {
  const playback = await import("./engine/replay-playback");
  return request.type === "archive"
    ? playback.buildProjectedReplayBundle(request.archive, request.playerId)
    : playback.decodeReplayTransport(request.transport);
}

function resolveWithFallback(requestId: number, cause?: unknown) {
  const waiter = pending.get(requestId);
  if (!waiter) return;
  pending.delete(requestId);
  window.clearTimeout(waiter.timeout);
  void reconstructWithoutWorker(waiter.request).then(waiter.resolve).catch((fallbackCause) => {
    waiter.reject(fallbackCause instanceof Error
      ? fallbackCause
      : cause instanceof Error
        ? cause
        : new Error("Replay reconstruction failed."));
  });
}

function playbackWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./replay-playback.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<PlaybackWorkerResponse>) => {
    const waiter = pending.get(event.data.requestId);
    if (!waiter) return;
    pending.delete(event.data.requestId);
    window.clearTimeout(waiter.timeout);
    if (event.data.bundle) waiter.resolve(event.data.bundle);
    else {
      pending.set(event.data.requestId, waiter);
      resolveWithFallback(event.data.requestId, new Error(event.data.error ?? "Replay reconstruction failed."));
    }
  });
  worker.addEventListener("error", (event) => {
    const cause = new Error(event.message || "Replay reconstruction worker stopped unexpectedly.");
    const requestIds = [...pending.keys()];
    worker?.terminate();
    worker = null;
    for (const requestId of requestIds) resolveWithFallback(requestId, cause);
  });
  return worker;
}

function requestReplay(request: PlaybackRequest) {
  if (typeof Worker === "undefined") return reconstructWithoutWorker(request);
  const requestId = ++requestSequence;
  return new Promise<ReplayBundle>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      const requestIds = [...pending.keys()];
      worker?.terminate();
      worker = null;
      for (const pendingRequestId of requestIds) {
        resolveWithFallback(pendingRequestId, new Error("Replay reconstruction worker timed out."));
      }
    }, PLAYBACK_WORKER_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, request, timeout });
    try {
      playbackWorker().postMessage({ requestId, ...request });
    } catch (cause) {
      resolveWithFallback(requestId, cause);
    }
  });
}

export function reconstructLocalReplay(archive: ReplayArchive, playerId: string) {
  return requestReplay({ type: "archive", archive, playerId });
}

export function reconstructServerReplay(transport: ReplayTransportBundle) {
  return requestReplay({ type: "transport", transport });
}
