import type { MatchState } from "./game";
import type { ReplayArchive } from "./engine/replay-types";
import {
  compileLocalReplayHistory,
  createLocalEngineHistoryDraft,
  type StoredLocalReplayJournal,
} from "./local-replay-history";
import { MAX_MATCH_RECORDS } from "./persistence";
import {
  REPLAY_ARCHIVE_STORE,
  REPLAY_JOURNAL_STORE,
  indexedDbRequest,
  indexedDbTransaction,
  openReplayDatabase,
} from "./replay-indexed-db";

type StoredReplay = ReplayArchive & { ownerId: string; savedAt: number };

const LOCAL_REPLAY_READY_TIMEOUT_MS = 4_000;
const LOCAL_REPLAY_READY_POLL_MS = 80;

export async function saveLocalReplay(
  archive: ReplayArchive,
  ownerId = archive.recording.genesis.players[0]?.id ?? "guest",
) {
  const database = await openReplayDatabase();
  try {
    const write = database.transaction(REPLAY_ARCHIVE_STORE, "readwrite");
    write.objectStore(REPLAY_ARCHIVE_STORE).put({ ...archive, ownerId, savedAt: Date.now() } satisfies StoredReplay);
    await indexedDbTransaction(write);
    const stored = await listLocalReplayMetadata(ownerId);
    await Promise.all(stored.slice(MAX_MATCH_RECORDS).map((item) => deleteLocalReplay(item.replayId)));
  } finally {
    database.close();
  }
}

export async function loadLocalReplay(replayId: string): Promise<ReplayArchive | null> {
  const database = await openReplayDatabase();
  try {
    const value = await indexedDbRequest(
      database.transaction(REPLAY_ARCHIVE_STORE).objectStore(REPLAY_ARCHIVE_STORE).get(replayId),
    ) as StoredReplay | undefined;
    if (!value) return null;
    const archive = structuredClone(value) as Partial<StoredReplay>;
    delete archive.ownerId;
    delete archive.savedAt;
    return archive as ReplayArchive;
  } finally {
    database.close();
  }
}

export async function loadLocalReplayHistory(replayId: string): Promise<StoredLocalReplayJournal | null> {
  const database = await openReplayDatabase();
  try {
    return await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).get(replayId),
    ) as StoredLocalReplayJournal | undefined ?? null;
  } finally {
    database.close();
  }
}

async function pruneLocalReplayHistories(ownerId: string) {
  const database = await openReplayDatabase();
  try {
    const values = await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).getAll(),
    ) as StoredLocalReplayJournal[];
    const excess = values
      .filter((draft) => draft.ownerId === ownerId && Boolean(draft.completedAt))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(MAX_MATCH_RECORDS);
    if (!excess.length) return;
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    const store = transaction.objectStore(REPLAY_JOURNAL_STORE);
    for (const draft of excess) store.delete(draft.replayId);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}

/** Seal existing IndexedDB engine history without compiling a replay. */
export async function sealLocalReplayHistory(
  replayId: string,
  state: MatchState,
  ownerId: string,
  completedAt = Date.now(),
) {
  const database = await openReplayDatabase();
  try {
    const current = await indexedDbRequest(
      database.transaction(REPLAY_JOURNAL_STORE).objectStore(REPLAY_JOURNAL_STORE).get(replayId),
    ) as StoredLocalReplayJournal | undefined;
    const draft = current ?? createLocalEngineHistoryDraft(state, ownerId, completedAt);
    draft.ownerId = ownerId;
    draft.updatedAt = Date.now();
    draft.finalState = structuredClone(state);
    draft.completedAt = completedAt;
    const transaction = database.transaction(REPLAY_JOURNAL_STORE, "readwrite");
    transaction.objectStore(REPLAY_JOURNAL_STORE).put(draft);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
  await pruneLocalReplayHistories(ownerId);
}

/**
 * Return a cached archive when present; otherwise compile it on first watch
 * from the completed local engine history and cache the frozen result.
 */
export async function loadOrCompileLocalReplay(replayId: string): Promise<ReplayArchive | null> {
  const cached = await loadLocalReplay(replayId);
  if (cached) return cached;
  const history = await loadLocalReplayHistory(replayId);
  if (!history?.finalState || !history.completedAt) return null;
  const archive = compileLocalReplayHistory(history);
  await saveLocalReplay(archive, history.ownerId);
  return archive;
}

/**
 * Completion now seals engine history before the UI publishes the record. A
 * short poll still covers IndexedDB scheduling and immediately compiles the
 * replay only if/when the player opens it.
 */
export async function loadLocalReplayWhenReady(
  replayId: string,
  timeoutMs = LOCAL_REPLAY_READY_TIMEOUT_MS,
): Promise<ReplayArchive | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let archive = await loadOrCompileLocalReplay(replayId);
  while (!archive && Date.now() < deadline) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, LOCAL_REPLAY_READY_POLL_MS));
    archive = await loadOrCompileLocalReplay(replayId);
  }
  return archive;
}

export async function listLocalReplayMetadata(ownerId?: string) {
  const database = await openReplayDatabase();
  try {
    const values = await indexedDbRequest(
      database.transaction(REPLAY_ARCHIVE_STORE).objectStore(REPLAY_ARCHIVE_STORE).getAll(),
    ) as StoredReplay[];
    return values
      .filter((value) => ownerId == null || value.ownerId === ownerId)
      .map(({ replayId, savedAt, completedAt }) => ({ replayId, savedAt, completedAt }))
      .sort((left, right) => right.savedAt - left.savedAt);
  } finally {
    database.close();
  }
}

export async function deleteLocalReplay(replayId: string) {
  const database = await openReplayDatabase();
  try {
    const transaction = database.transaction([REPLAY_ARCHIVE_STORE, REPLAY_JOURNAL_STORE], "readwrite");
    transaction.objectStore(REPLAY_ARCHIVE_STORE).delete(replayId);
    transaction.objectStore(REPLAY_JOURNAL_STORE).delete(replayId);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}
