import type { ReplayArchive } from "./engine/replay-types";
import { MAX_MATCH_RECORDS } from "./persistence";
import {
  REPLAY_ARCHIVE_STORE,
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
    const value = await indexedDbRequest(database.transaction(REPLAY_ARCHIVE_STORE).objectStore(REPLAY_ARCHIVE_STORE).get(replayId)) as StoredReplay | undefined;
    if (!value) return null;
    const archive = structuredClone(value) as Partial<StoredReplay>;
    delete archive.ownerId;
    delete archive.savedAt;
    return archive as ReplayArchive;
  } finally {
    database.close();
  }
}

/**
 * A completed-match record is published to the UI before the replay worker's
 * final IndexedDB transaction finishes. Give that transaction a short grace
 * period so opening a brand-new record cannot race the archive write.
 */
export async function loadLocalReplayWhenReady(
  replayId: string,
  timeoutMs = LOCAL_REPLAY_READY_TIMEOUT_MS,
): Promise<ReplayArchive | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let archive = await loadLocalReplay(replayId);
  while (!archive && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, LOCAL_REPLAY_READY_POLL_MS));
    archive = await loadLocalReplay(replayId);
  }
  return archive;
}

export async function listLocalReplayMetadata(ownerId?: string) {
  const database = await openReplayDatabase();
  try {
    const values = await indexedDbRequest(database.transaction(REPLAY_ARCHIVE_STORE).objectStore(REPLAY_ARCHIVE_STORE).getAll()) as StoredReplay[];
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
    const transaction = database.transaction(REPLAY_ARCHIVE_STORE, "readwrite");
    transaction.objectStore(REPLAY_ARCHIVE_STORE).delete(replayId);
    await indexedDbTransaction(transaction);
  } finally {
    database.close();
  }
}
