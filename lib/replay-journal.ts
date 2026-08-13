import type { MatchState } from "./game";
import type { CommandEnvelope } from "./engine/types";

type JournalWorkerRequest =
  | {
    type: "start";
    replayId: string;
    ownerId: string;
    startedAt: number;
    state: MatchState;
  }
  | { type: "append"; replayId: string; envelope: CommandEnvelope }
  | { type: "complete"; requestId: number; replayId: string; ownerId: string; state: MatchState; completedAt: number }
  | { type: "flush" };

type JournalWorkerResponse = { requestId: number; replayId: string; ok: boolean; error?: string };

let worker: Worker | null = null;
let requestSequence = 0;
const initialized = new Set<string>();
const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
let lifecycleListenersInstalled = false;

function installLifecycleListeners() {
  if (lifecycleListenersInstalled || typeof window === "undefined") return;
  lifecycleListenersInstalled = true;
  const flush = () => flushLocalReplayJournal();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function journalWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./replay-journal.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<JournalWorkerResponse>) => {
    const waiter = pending.get(event.data.requestId);
    if (!waiter) return;
    pending.delete(event.data.requestId);
    if (event.data.ok) waiter.resolve();
    else waiter.reject(new Error(event.data.error ?? "Replay finalization failed."));
  });
  worker.addEventListener("error", (event) => {
    const cause = new Error(event.message || "Replay journal worker stopped unexpectedly.");
    for (const waiter of pending.values()) waiter.reject(cause);
    pending.clear();
    initialized.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function initializeLocalReplayJournal(state: MatchState, ownerId: string) {
  if (typeof Worker === "undefined" || initialized.has(state.id)) return;
  installLifecycleListeners();
  initialized.add(state.id);
  const startedAt = state.log.find((entry) => Number.isFinite(entry.at))?.at ?? Date.now();
  journalWorker().postMessage({
    type: "start",
    replayId: state.id,
    ownerId,
    startedAt,
    state,
  } satisfies JournalWorkerRequest);
}

export function journalLocalReplayCommand(before: MatchState, envelope: CommandEnvelope, ownerId: string) {
  if (typeof Worker === "undefined") return;
  initializeLocalReplayJournal(before, ownerId);
  journalWorker().postMessage({
    type: "append",
    replayId: before.id,
    envelope,
  } satisfies JournalWorkerRequest);
}

export function finalizeLocalReplayJournal(state: MatchState, ownerId: string) {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Replay workers are unavailable."));
  initializeLocalReplayJournal(state, ownerId);
  const requestId = ++requestSequence;
  return new Promise<void>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    journalWorker().postMessage({
      type: "complete",
      requestId,
      replayId: state.id,
      ownerId,
      state,
      completedAt: Date.now(),
    } satisfies JournalWorkerRequest);
  });
}

export function flushLocalReplayJournal() {
  worker?.postMessage({ type: "flush" } satisfies JournalWorkerRequest);
}
