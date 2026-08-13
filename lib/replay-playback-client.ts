import type { ReplayArchive, ReplayBundle, ReplayTransportBundle } from "./engine/replay-types";

type PendingReplay = {
  resolve(bundle: ReplayBundle): void;
  reject(error: Error): void;
};

type PlaybackWorkerResponse = { requestId: number; bundle?: ReplayBundle; error?: string };

let worker: Worker | null = null;
let requestSequence = 0;
const pending = new Map<number, PendingReplay>();

function playbackWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./replay-playback.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<PlaybackWorkerResponse>) => {
    const waiter = pending.get(event.data.requestId);
    if (!waiter) return;
    pending.delete(event.data.requestId);
    if (event.data.bundle) waiter.resolve(event.data.bundle);
    else waiter.reject(new Error(event.data.error ?? "Replay reconstruction failed."));
  });
  worker.addEventListener("error", (event) => {
    const cause = new Error(event.message || "Replay reconstruction worker stopped unexpectedly.");
    for (const waiter of pending.values()) waiter.reject(cause);
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function requestReplay(message: Record<string, unknown>) {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Replay workers are unavailable."));
  const requestId = ++requestSequence;
  return new Promise<ReplayBundle>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    playbackWorker().postMessage({ requestId, ...message });
  });
}

export function reconstructLocalReplay(archive: ReplayArchive, playerId: string) {
  return requestReplay({ type: "archive", archive, playerId });
}

export function reconstructServerReplay(transport: ReplayTransportBundle) {
  return requestReplay({ type: "transport", transport });
}
