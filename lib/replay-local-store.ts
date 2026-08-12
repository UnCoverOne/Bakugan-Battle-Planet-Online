import type { ReplayArchive } from "./engine/replay-types";
import { MAX_MATCH_RECORDS } from "./persistence";

const DATABASE_NAME = "bakugan-battle-planet-replays";
const STORE_NAME = "replays";
const DATABASE_VERSION = 1;

type StoredReplay = ReplayArchive & { ownerId: string; savedAt: number };

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Replay storage is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Replay storage could not be opened."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "replayId" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Replay storage request failed."));
  });
}

export async function saveLocalReplay(
  archive: ReplayArchive,
  ownerId = archive.recording.genesis.players[0]?.id ?? "guest",
) {
  const database = await openDatabase();
  try {
    const write = database.transaction(STORE_NAME, "readwrite");
    write.objectStore(STORE_NAME).put({ ...archive, ownerId, savedAt: Date.now() } satisfies StoredReplay);
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve();
      write.onerror = () => reject(write.error ?? new Error("Replay could not be saved."));
      write.onabort = () => reject(write.error ?? new Error("Replay save was aborted."));
    });
    const stored = await listLocalReplayMetadata(ownerId);
    await Promise.all(stored.slice(MAX_MATCH_RECORDS).map((item) => deleteLocalReplay(item.replayId)));
  } finally {
    database.close();
  }
}

export async function loadLocalReplay(replayId: string): Promise<ReplayArchive | null> {
  const database = await openDatabase();
  try {
    const value = await transactionResult(database.transaction(STORE_NAME).objectStore(STORE_NAME).get(replayId)) as StoredReplay | undefined;
    if (!value) return null;
    const archive = structuredClone(value) as Partial<StoredReplay>;
    delete archive.ownerId;
    delete archive.savedAt;
    return archive as ReplayArchive;
  } finally {
    database.close();
  }
}

export async function listLocalReplayMetadata(ownerId?: string) {
  const database = await openDatabase();
  try {
    const values = await transactionResult(database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()) as StoredReplay[];
    return values
      .filter((value) => ownerId == null || value.ownerId === ownerId)
      .map(({ replayId, savedAt, completedAt }) => ({ replayId, savedAt, completedAt }))
      .sort((left, right) => right.savedAt - left.savedAt);
  } finally {
    database.close();
  }
}

export async function deleteLocalReplay(replayId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(replayId);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Replay could not be removed."));
    });
  } finally {
    database.close();
  }
}
