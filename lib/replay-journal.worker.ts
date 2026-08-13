/// <reference lib="webworker" />

import type { MatchState } from "./game";
import type { ReplayJournalDraft } from "./engine/replay-types";
import type { CommandEnvelope } from "./engine/types";
import { compactReplayCommand, createReplayRecording } from "./engine/replay-codec";
import { buildDisplayableReplayArchive } from "./replay-finalization";
import { saveLocalReplay } from "./replay-local-store";
import {
  REPLAY_JOURNAL_STORE,
  indexedDbRequest,
  indexedDbTransaction,
  openReplayDatabase,
} from "./replay-indexed-db";

type WorkerRequest =
  | { type: "start"; replayId: string; ownerId: string; startedAt: number; state: MatchState }
  | { type: "append"; replayId: string; envelope: CommandEnvelope }
  | { type: "complete"; requestId: number; replayId: string; ownerId: string; state: MatchState; completedAt: number }
  | { type: "flush" };

const drafts = new Map<string, ReplayJournalDraft>();
const loading = new Map<string, Promise<ReplayJournalDraft | null>>();
const dirty = new Set<string>();
let flushTimer = 0;
let workQueue = Promise.resolve();

async function storedDraft(replayId: string) {
  const database = await openReplayDatabase();
  try {
    return await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).get(replayId),
    ) as ReplayJournalDraft | undefined;
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

async function persistDraft(draft: ReplayJournalDraft) {
  const database = await openReplayDatabase();
  try {
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    transaction.objectStore(REPLAY_JOURNAL_STORE).put(draft);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}

async function deleteDraft(replayId: string) {
  const database = await openReplayDatabase();
  try {
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    transaction.objectStore(REPLAY_JOURNAL_STORE).delete(replayId);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}

async function flush() {
  const replayIds = [...dirty];
  for (const replayId of replayIds) {
    const draft = drafts.get(replayId);
    if (draft) await persistDraft(draft);
    dirty.delete(replayId);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = self.setTimeout(() => {
    flushTimer = 0;
    workQueue = workQueue.then(flush).catch(() => undefined);
  }, 750);
}

async function handleMessage(message: WorkerRequest) {
  if (message.type === "start") {
    let existing: ReplayJournalDraft | null = null;
    try {
      existing = await draftFor(message.replayId);
    } catch {
      // IndexedDB can transiently reject a read during an upgrade or page
      // lifecycle transition. The supplied state is a safe new genesis.
      loading.delete(message.replayId);
    }
    if (!existing) {
      drafts.set(message.replayId, {
        replayId: message.replayId,
        ownerId: message.ownerId,
        startedAt: message.startedAt,
        updatedAt: Date.now(),
        recording: createReplayRecording(message.state),
      });
      dirty.add(message.replayId);
      scheduleFlush();
    }
    return;
  }
  if (message.type === "append") {
    const draft = await draftFor(message.replayId);
    if (!draft) throw new Error("Replay journal was not initialized.");
    draft.recording.commands.push(compactReplayCommand(message.envelope));
    draft.updatedAt = Date.now();
    dirty.add(message.replayId);
    scheduleFlush();
    return;
  }
  if (message.type === "flush") {
    await flush();
    return;
  }

  let draft: ReplayJournalDraft | null = null;
  try {
    draft = await draftFor(message.replayId);
  } catch {
    loading.delete(message.replayId);
  }
  // A failed draft flush must not prevent the already completed match from
  // receiving a reconstructable archive. Archive persistence is the priority.
  await flush().catch(() => undefined);
  const archive = buildDisplayableReplayArchive(draft?.recording, message.state, message.completedAt);
  await saveLocalReplay(archive, message.ownerId);
  await deleteDraft(message.replayId).catch(() => undefined);
  drafts.delete(message.replayId);
  self.postMessage({ requestId: message.requestId, replayId: message.replayId, ok: true });
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  workQueue = workQueue.then(() => handleMessage(message)).catch((cause) => {
    if (message.type === "complete") {
      self.postMessage({
        requestId: message.requestId,
        replayId: message.replayId,
        ok: false,
        error: cause instanceof Error ? cause.message : "Replay finalization failed.",
      });
    }
    // Recover the queue so a transient IndexedDB error cannot disable later
    // replay commands or a completion retry.
    return undefined;
  });
});

export {};
