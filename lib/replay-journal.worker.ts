/// <reference lib="webworker" />

import type { MatchState } from "./game";
import type { CommandEnvelope } from "./engine/types";
import { compactReplayCommand } from "./engine/replay-codec";
import {
  appendLocalEngineHistoryTransition,
  createLocalEngineHistoryDraft,
  isLocalEngineHistoryDraft,
  type LocalEngineHistoryTransition,
  type StoredLocalReplayJournal,
} from "./local-replay-history";
import {
  REPLAY_JOURNAL_STORE,
  indexedDbRequest,
  indexedDbTransaction,
  openReplayDatabase,
} from "./replay-indexed-db";

type WorkerRequest =
  | { type: "start"; replayId: string; ownerId: string; startedAt: number; state: MatchState }
  | {
    type: "append";
    replayId: string;
    state: MatchState;
    transition: LocalEngineHistoryTransition;
  }
  | { type: "complete"; requestId: number; replayId: string; ownerId: string; state: MatchState; completedAt: number }
  | { type: "flush"; requestId?: number };

const LOCAL_HISTORY_RETENTION = 10;
const drafts = new Map<string, StoredLocalReplayJournal>();
const loading = new Map<string, Promise<StoredLocalReplayJournal | null>>();
let workQueue = Promise.resolve();

async function storedDraft(replayId: string) {
  const database = await openReplayDatabase();
  try {
    return await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).get(replayId),
    ) as StoredLocalReplayJournal | undefined;
  } finally {
    database.close();
  }
}

async function draftFor(replayId: string) {
  const inMemory = drafts.get(replayId);
  if (inMemory) return inMemory;
  let request = loading.get(replayId);
  if (!request) {
    request = storedDraft(replayId).then((draft) => {
      if (draft) drafts.set(replayId, draft);
      loading.delete(replayId);
      return draft ?? null;
    });
    loading.set(replayId, request);
  }
  return request;
}

async function persistDraft(draft: StoredLocalReplayJournal) {
  const database = await openReplayDatabase();
  try {
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    transaction.objectStore(REPLAY_JOURNAL_STORE).put(draft);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}

async function pruneCompletedHistories(ownerId: string) {
  const database = await openReplayDatabase();
  try {
    const values = await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).getAll(),
    ) as StoredLocalReplayJournal[];
    const excess = values
      .filter((draft) => draft.ownerId === ownerId && Boolean(draft.completedAt))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(LOCAL_HISTORY_RETENTION);
    if (!excess.length) return;
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    const store = transaction.objectStore(REPLAY_JOURNAL_STORE);
    for (const draft of excess) store.delete(draft.replayId);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}

async function flush() {
  for (const draft of drafts.values()) await persistDraft(draft);
}

async function handleMessage(message: WorkerRequest) {
  if (message.type === "start") {
    let existing: StoredLocalReplayJournal | null = null;
    try {
      existing = await draftFor(message.replayId);
    } catch {
      loading.delete(message.replayId);
    }
    if (!existing) {
      const draft = createLocalEngineHistoryDraft(message.state, message.ownerId, message.startedAt);
      drafts.set(message.replayId, draft);
      await persistDraft(draft);
    }
    return;
  }

  if (message.type === "append") {
    const draft = await draftFor(message.replayId);
    if (!draft) throw new Error("Local engine history was not initialized.");
    if (isLocalEngineHistoryDraft(draft)) {
      try {
        appendLocalEngineHistoryTransition(draft, message.transition, message.state);
      } catch (cause) {
        // Persist any diagnostic/checkpoint changes made before a non-integrity
        // storage/serialization failure is surfaced to the page.
        await persistDraft(draft).catch(() => undefined);
        throw cause;
      }
    } else {
      // Compatibility for a Training match that was already in progress when
      // the engine-history recorder replaced the old command-only journal.
      const envelope: CommandEnvelope = message.transition.envelope;
      draft.recording.commands.push(compactReplayCommand(envelope));
      draft.updatedAt = Date.now();
    }
    await persistDraft(draft);
    return;
  }

  if (message.type === "flush") {
    await flush();
    if (message.requestId != null) {
      self.postMessage({ type: "flush", requestId: message.requestId, ok: true });
    }
    return;
  }

  let draft: StoredLocalReplayJournal | null = null;
  try {
    draft = await draftFor(message.replayId);
  } catch {
    loading.delete(message.replayId);
  }
  if (!draft) {
    draft = createLocalEngineHistoryDraft(message.state, message.ownerId, message.completedAt);
    drafts.set(message.replayId, draft);
  }
  draft.ownerId = message.ownerId;
  draft.updatedAt = Date.now();
  draft.finalState = structuredClone(message.state);
  draft.completedAt = message.completedAt;
  await persistDraft(draft);
  await pruneCompletedHistories(message.ownerId).catch(() => undefined);
  self.postMessage({ type: "complete", requestId: message.requestId, replayId: message.replayId, ok: true });
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  workQueue = workQueue.then(() => handleMessage(message)).catch((cause) => {
    const error = cause instanceof Error ? cause.message : "Local engine-history operation failed.";
    if (message.type === "complete") {
      self.postMessage({
        type: "complete",
        requestId: message.requestId,
        replayId: message.replayId,
        ok: false,
        error,
      });
    } else if (message.type === "append") {
      self.postMessage({
        type: "append-error",
        replayId: message.replayId,
        commandId: message.transition.envelope.commandId,
        error,
      });
    } else if (message.type === "flush" && message.requestId != null) {
      self.postMessage({ type: "flush", requestId: message.requestId, ok: false, error });
    }
    return undefined;
  });
});

export {};
