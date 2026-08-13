export const REPLAY_DATABASE_NAME = "bakugan-battle-planet-replays";
export const REPLAY_ARCHIVE_STORE = "replays";
export const REPLAY_JOURNAL_STORE = "journals";
export const REPLAY_DATABASE_VERSION = 2;

export function openReplayDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Replay storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPLAY_DATABASE_NAME, REPLAY_DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Replay storage could not be opened."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REPLAY_ARCHIVE_STORE)) {
        const store = database.createObjectStore(REPLAY_ARCHIVE_STORE, { keyPath: "replayId" });
        store.createIndex("savedAt", "savedAt");
      }
      if (!database.objectStoreNames.contains(REPLAY_JOURNAL_STORE)) {
        const store = database.createObjectStore(REPLAY_JOURNAL_STORE, { keyPath: "replayId" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function indexedDbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Replay storage request failed."));
  });
}

export function indexedDbTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Replay storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Replay storage transaction was aborted."));
  });
}
