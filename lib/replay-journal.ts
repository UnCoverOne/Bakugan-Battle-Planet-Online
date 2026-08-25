import type { MatchState } from "./game";
import type { LocalEngineHistoryTransition } from "./local-replay-history";

type JournalWorkerRequest =
  | {
    type: "start";
    replayId: string;
    ownerId: string;
    startedAt: number;
    state: MatchState;
  }
  | {
    type: "append";
    replayId: string;
    state: MatchState;
    transition: LocalEngineHistoryTransition;
  }
  | { type: "complete"; requestId: number; replayId: string; ownerId: string; state: MatchState; completedAt: number }
  | { type: "flush"; requestId?: number };

type JournalWorkerResponse =
  | { type: "complete"; requestId: number; replayId: string; ok: boolean; error?: string }
  | { type: "flush"; requestId: number; ok: boolean; error?: string }
  | { type: "append-error"; replayId: string; commandId: string; error: string };

type PendingFinalization = {
  resolve: () => void;
  reject: (error: Error) => void;
  state: MatchState;
  ownerId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

const REPLAY_FINALIZATION_TIMEOUT_MS = 12_000;
const REPLAY_FLUSH_TIMEOUT_MS = 4_000;
type PendingFlush = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let requestSequence = 0;
const initialized = new Set<string>();
const pending = new Map<number, PendingFinalization>();
const pendingFlushes = new Map<number, PendingFlush>();
let lifecycleListenersInstalled = false;

async function sealCompletedStateFallback(state: MatchState, ownerId: string) {
  const { sealLocalReplayHistory } = await import("./replay-local-store");
  await sealLocalReplayHistory(state.id, state, ownerId, Date.now());
}

function recoverPendingFinalization(requestId: number, cause: Error) {
  const waiter = pending.get(requestId);
  if (!waiter) return;
  pending.delete(requestId);
  clearTimeout(waiter.timeoutId);
  void sealCompletedStateFallback(waiter.state, waiter.ownerId).then(waiter.resolve).catch((fallbackCause) => {
    const detail = fallbackCause instanceof Error ? fallbackCause.message : String(fallbackCause);
    waiter.reject(new Error(`${cause.message} Local engine-history sealing also failed: ${detail}`));
  });
}

function installLifecycleListeners() {
  if (lifecycleListenersInstalled || typeof window === "undefined") return;
  lifecycleListenersInstalled = true;
  const flush = () => flushLocalReplayJournal();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function journalWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./replay-journal.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return null;
  }
  worker.addEventListener("message", (event: MessageEvent<JournalWorkerResponse>) => {
    if (event.data.type === "append-error") {
      // Recording must never stall live Training gameplay, but storage or
      // serialization failures are still surfaced immediately for diagnostics.
      console.error(`[local-replay] ${event.data.error}`);
      return;
    }
    if (event.data.type === "flush") {
      const waiter = pendingFlushes.get(event.data.requestId);
      if (!waiter) return;
      pendingFlushes.delete(event.data.requestId);
      clearTimeout(waiter.timeoutId);
      if (event.data.ok) waiter.resolve();
      else waiter.reject(new Error(event.data.error ?? "Local engine-history flush failed."));
      return;
    }
    const waiter = pending.get(event.data.requestId);
    if (!waiter) return;
    if (!event.data.ok) {
      recoverPendingFinalization(
        event.data.requestId,
        new Error(event.data.error ?? "Local engine-history sealing failed."),
      );
      return;
    }
    pending.delete(event.data.requestId);
    clearTimeout(waiter.timeoutId);
    waiter.resolve();
  });
  worker.addEventListener("error", (event) => {
    const cause = new Error(event.message || "Local engine-history worker stopped unexpectedly.");
    const requestIds = [...pending.keys()];
    initialized.clear();
    worker?.terminate();
    worker = null;
    for (const requestId of requestIds) recoverPendingFinalization(requestId, cause);
    for (const waiter of pendingFlushes.values()) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(cause);
    }
    pendingFlushes.clear();
  });
  return worker;
}

export function initializeLocalReplayJournal(state: MatchState, ownerId: string) {
  if (typeof Worker === "undefined" || initialized.has(state.id)) return;
  installLifecycleListeners();
  const activeWorker = journalWorker();
  if (!activeWorker) return;
  initialized.add(state.id);
  const startedAt = state.log.find((entry) => Number.isFinite(entry.at))?.at ?? Date.now();
  activeWorker.postMessage({
    type: "start",
    replayId: state.id,
    ownerId,
    startedAt,
    state,
  } satisfies JournalWorkerRequest);
}

export function journalLocalEngineTransition(
  before: MatchState,
  transition: LocalEngineHistoryTransition,
  ownerId: string,
) {
  if (typeof Worker === "undefined") return;
  initializeLocalReplayJournal(before, ownerId);
  journalWorker()?.postMessage({
    type: "append",
    replayId: before.id,
    // The worker persists this full authoritative state only at sparse periodic
    // checkpoints or when a hash gap requires an exact resynchronization anchor.
    state: before,
    transition,
  } satisfies JournalWorkerRequest);
}

export function finalizeLocalReplayJournal(state: MatchState, ownerId: string) {
  if (typeof Worker === "undefined") return sealCompletedStateFallback(state, ownerId);
  initializeLocalReplayJournal(state, ownerId);
  const activeWorker = journalWorker();
  if (!activeWorker) return sealCompletedStateFallback(state, ownerId);
  const requestId = ++requestSequence;
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      recoverPendingFinalization(requestId, new Error("Local engine-history sealing timed out."));
    }, REPLAY_FINALIZATION_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, state, ownerId, timeoutId });
    activeWorker.postMessage({
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

/** Wait until every queued local transition has been persisted before diagnostics read IndexedDB. */
export function flushLocalReplayJournalAndWait() {
  if (typeof Worker === "undefined") return Promise.resolve();
  const activeWorker = journalWorker();
  if (!activeWorker) return Promise.resolve();
  const requestId = ++requestSequence;
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingFlushes.delete(requestId);
      reject(new Error("Local engine-history flush timed out."));
    }, REPLAY_FLUSH_TIMEOUT_MS);
    pendingFlushes.set(requestId, { resolve, reject, timeoutId });
    activeWorker.postMessage({ type: "flush", requestId } satisfies JournalWorkerRequest);
  });
}
