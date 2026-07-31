import {
  snapshotToSyncRequest,
  type EntityRevisionMap,
  type UserDataSyncRequest,
} from "./user-data-entities";
import {
  mergeSnapshots,
  normalizeSnapshot,
  selectSnapshot,
  type UserSnapshot,
} from "./persistence";

const ACCOUNT_CACHE_PREFIX = "bbp-account-cache-v2:";

export type AccountCache = {
  schemaVersion: 2;
  userId: string;
  snapshot: UserSnapshot;
  revisions: EntityRevisionMap;
  version: number;
  acknowledgedVersion: number;
  savedAt: number;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function accountCacheKey(userId: string) {
  return `${ACCOUNT_CACHE_PREFIX}${userId}`;
}

export function removeAccountCache(
  storage: Pick<Storage, "removeItem">,
  userId: string,
) {
  storage.removeItem(accountCacheKey(userId));
}

export function readAccountCache(
  storage: StorageLike,
  userId: string,
  fallback: UserSnapshot,
): AccountCache | null {
  try {
    const raw = storage.getItem(accountCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountCache>;
    if (
      parsed.schemaVersion !== 2 ||
      parsed.userId !== userId ||
      !parsed.snapshot ||
      !Number.isInteger(parsed.version) ||
      !Number.isInteger(parsed.acknowledgedVersion)
    ) {
      return null;
    }
    return {
      schemaVersion: 2,
      userId,
      snapshot: normalizeSnapshot(parsed.snapshot, fallback),
      revisions:
        parsed.revisions && typeof parsed.revisions === "object"
          ? parsed.revisions
          : {},
      version: Math.max(0, Number(parsed.version)),
      acknowledgedVersion: Math.max(0, Number(parsed.acknowledgedVersion)),
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function writeAccountCache(
  storage: StorageLike,
  cache: Omit<AccountCache, "schemaVersion" | "savedAt">,
) {
  const value: AccountCache = {
    ...cache,
    schemaVersion: 2,
    savedAt: Date.now(),
  };
  storage.setItem(accountCacheKey(cache.userId), JSON.stringify(value));
  return value;
}

export function isAccountCacheDirty(cache: AccountCache | null) {
  return Boolean(cache && cache.version > cache.acknowledgedVersion);
}

export function buildAccountSyncRequest(
  snapshot: UserSnapshot,
  revisions: EntityRevisionMap,
): UserDataSyncRequest {
  return snapshotToSyncRequest(snapshot, revisions);
}

export function buildAccountSyncRequests(
  snapshot: UserSnapshot,
  revisions: EntityRevisionMap,
  maximumBytes = 750_000,
): UserDataSyncRequest[] {
  const full = snapshotToSyncRequest(snapshot, revisions);
  const batches: UserDataSyncRequest[] = [];
  let current: UserDataSyncRequest = {
    schemaVersion: full.schemaVersion,
    entities: [],
    history: [],
  };
  const size = (value: UserDataSyncRequest) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const pushCurrent = () => {
    if (!current.entities.length && !current.history.length) return;
    batches.push(current);
    current = { schemaVersion: full.schemaVersion, entities: [], history: [] };
  };
  for (const entity of full.entities) {
    const candidate = { ...current, entities: [...current.entities, entity] };
    if (size(candidate) > maximumBytes && current.entities.length) pushCurrent();
    current.entities.push(entity);
  }
  for (const record of full.history) {
    const candidate = { ...current, history: [...current.history, record] };
    if (
      size(candidate) > maximumBytes &&
      (current.entities.length || current.history.length)
    ) {
      pushCurrent();
    }
    current.history.push(record);
  }
  pushCurrent();
  return batches.length
    ? batches
    : [{ schemaVersion: full.schemaVersion, entities: [], history: [] }];
}

export function retryDelayMs(attempt: number, retryAfterSeconds = 0) {
  if (retryAfterSeconds > 0) return Math.min(60_000, retryAfterSeconds * 1_000);
  return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, attempt)));
}

export function resolveEntityConflicts(
  local: UserSnapshot,
  remote: UserSnapshot,
  conflicts: string[],
) {
  const resolved = selectSnapshot(local, remote, "cloud");
  if (local.updatedAt < remote.updatedAt) return resolved;
  const deckState = mergeSnapshots(local, remote);
  for (const key of conflicts) {
    if (key === "profile:main") resolved.profile = local.profile;
    if (key === "settings:main") resolved.settings = local.settings;
    if (key === "preferences:main") {
      resolved.selectedDeckId = local.selectedDeckId;
      resolved.format = local.format;
      resolved.matchMode = local.matchMode;
    }
    if (key === "draft:main") resolved.builderDeck = local.builderDeck;
    if (key.startsWith("deck:")) {
      const id = key.slice("deck:".length);
      resolved.decks = [
        ...resolved.decks.filter((deck) => deck.id !== id),
        ...deckState.decks.filter((deck) => deck.id === id),
      ];
      resolved.deletedDecks = [
        ...(resolved.deletedDecks ?? []).filter((deletion) => deletion.id !== id),
        ...(deckState.deletedDecks ?? []).filter((deletion) => deletion.id === id),
      ];
    }
  }
  resolved.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return resolved;
}
