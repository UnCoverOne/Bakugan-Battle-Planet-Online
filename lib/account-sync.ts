import {
  entityKey,
  snapshotToSyncRequest,
  type EntityRevisionMap,
  type UserDataSyncRequest,
} from "./user-data-entities";
import {
  MAX_MATCH_RECORDS,
  normalizeSnapshot,
  selectSnapshot,
  type UserSnapshot,
} from "./persistence";
import { COLLECTION_FIELDS, normalizeCollection } from "./collection";

const ACCOUNT_CACHE_PREFIX = "bbp-account-cache-v2:";

export type AccountCache = {
  schemaVersion: 2;
  userId: string;
  snapshot: UserSnapshot;
  pendingEntityKeys?: string[];
  acknowledgedHistoryIds?: string[];
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
      pendingEntityKeys: Array.isArray(parsed.pendingEntityKeys)
        ? parsed.pendingEntityKeys.filter((key): key is string => typeof key === "string")
        : undefined,
      acknowledgedHistoryIds: Array.isArray(parsed.acknowledgedHistoryIds)
        ? parsed.acknowledgedHistoryIds.filter((id): id is string => typeof id === "string")
        : undefined,
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

function comparableEntity(entity: UserDataSyncRequest["entities"][number]) {
  const data =
    entity.type === "preferences" && entity.data && typeof entity.data === "object"
      ? Object.fromEntries(
          Object.entries(entity.data as Record<string, unknown>).filter(
            ([key]) => key !== "updatedAt",
          ),
        )
      : entity.data;
  return JSON.stringify({
    type: entity.type,
    id: entity.id,
    data,
    deletedAt: entity.deletedAt ?? null,
  });
}

export function changedAccountEntityKeys(
  snapshot: UserSnapshot,
  acknowledgedSnapshot: UserSnapshot | null,
) {
  const current = snapshotToSyncRequest(snapshot, {}).entities;
  if (!acknowledgedSnapshot) {
    return current.map((entity) => entityKey(entity.type, entity.id));
  }
  const acknowledged = new Map(
    snapshotToSyncRequest(acknowledgedSnapshot, {}).entities.map((entity) => [
      entityKey(entity.type, entity.id),
      comparableEntity(entity),
    ]),
  );
  return current
    .filter(
      (entity) =>
        acknowledged.get(entityKey(entity.type, entity.id)) !==
        comparableEntity(entity),
    )
    .map((entity) => entityKey(entity.type, entity.id));
}

export function buildChangedAccountSyncRequests(
  snapshot: UserSnapshot,
  acknowledgedSnapshot: UserSnapshot | null,
  revisions: EntityRevisionMap,
  maximumBytes = 750_000,
  pendingEntityKeys?: string[] | null,
) {
  const changedKeys = new Set(
    pendingEntityKeys
      ?? changedAccountEntityKeys(snapshot, acknowledgedSnapshot),
  );
  const full = snapshotToSyncRequest(snapshot, revisions);
  const pending: UserDataSyncRequest = {
    ...full,
    entities: full.entities.filter((entity) =>
      changedKeys.has(entityKey(entity.type, entity.id)),
    ),
    // Match history has its own append-only endpoint and retry lifecycle.
    // Including it here caused the small recovery window to repeatedly replace
    // the complete runtime archive.
    history: [],
  };
  const batches: UserDataSyncRequest[] = [];
  let current: UserDataSyncRequest = {
    schemaVersion: pending.schemaVersion,
    entities: [],
    history: [],
  };
  const size = (value: UserDataSyncRequest) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const pushCurrent = () => {
    if (!current.entities.length && !current.history.length) return;
    batches.push(current);
    current = { schemaVersion: pending.schemaVersion, entities: [], history: [] };
  };
  for (const entity of pending.entities) {
    const candidate = { ...current, entities: [...current.entities, entity] };
    if (size(candidate) > maximumBytes && current.entities.length) pushCurrent();
    current.entities.push(entity);
  }
  for (const record of pending.history) {
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
  return batches;
}

export function retryDelayMs(attempt: number, retryAfterSeconds = 0) {
  if (retryAfterSeconds > 0) return Math.min(60_000, retryAfterSeconds * 1_000);
  return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, attempt)));
}

function mergeCollectionDelta(
  baseline: UserSnapshot["collection"],
  local: UserSnapshot["collection"],
  remote: UserSnapshot["collection"],
) {
  const base = normalizeCollection(baseline ?? {});
  const localCollection = normalizeCollection(local ?? {});
  const remoteCollection = normalizeCollection(remote ?? {});
  const merged = { ...remoteCollection };
  const ids = new Set([...Object.keys(base), ...Object.keys(localCollection)]);

  for (const id of ids) {
    const baseEntry = base[id] ?? { standard: 0, foil: 0, wishlist: 0 };
    const localEntry = localCollection[id] ?? { standard: 0, foil: 0, wishlist: 0 };
    const remoteEntry = remoteCollection[id] ?? { standard: 0, foil: 0, wishlist: 0 };
    const next = { ...remoteEntry };
    let changed = false;
    for (const field of COLLECTION_FIELDS) {
      const delta = localEntry[field] - baseEntry[field];
      if (!delta) continue;
      next[field] = Math.max(0, remoteEntry[field] + delta);
      changed = true;
    }
    if (!changed) continue;
    if (COLLECTION_FIELDS.every((field) => next[field] === 0)) delete merged[id];
    else merged[id] = next;
  }
  return normalizeCollection(merged);
}

export function reconcileRemoteAccountState(
  local: UserSnapshot,
  remote: UserSnapshot,
  localEntityKeys: string[],
  baseline: UserSnapshot | null = null,
) {
  const localCloud = snapshotToSyncRequest(local, {});
  const localEntities = new Map(
    localCloud.entities.map((entity) => [entityKey(entity.type, entity.id), entity]),
  );
  const localSnapshot = selectSnapshot(local, local, "cloud");
  const resolved = selectSnapshot(local, remote, "cloud");
  const keys = new Set(localEntityKeys);

  if (keys.has("profile:main")) {
    resolved.profile = { ...local.profile, signedIn: resolved.profile.signedIn };
  }
  if (keys.has("settings:main")) resolved.settings = local.settings;
  if (keys.has("preferences:main")) {
    resolved.selectedDeckId = localSnapshot.selectedDeckId;
    resolved.format = localSnapshot.format;
    resolved.matchMode = localSnapshot.matchMode;
    resolved.lifetimeStats = localSnapshot.lifetimeStats;
  }
  if (keys.has("collection:main")) {
    resolved.collection = baseline
      ? mergeCollectionDelta(
          baseline.collection,
          local.collection,
          remote.collection,
        )
      : normalizeCollection(local.collection ?? {});
  }
  if (keys.has("draft:main")) resolved.builderDeck = localSnapshot.builderDeck;

  for (const key of keys) {
    if (!key.startsWith("deck:")) continue;
    const id = key.slice("deck:".length);
    const localEntity = localEntities.get(key);
    resolved.decks = resolved.decks.filter((deck) => deck.id !== id);
    resolved.deletedDecks = (resolved.deletedDecks ?? []).filter(
      (deletion) => deletion.id !== id,
    );
    if (localEntity?.data) {
      const localDeck = localSnapshot.decks.find((deck) => deck.id === id);
      if (localDeck) resolved.decks.push(localDeck);
    } else if (localEntity?.deletedAt) {
      resolved.deletedDecks.push({ id, deletedAt: localEntity.deletedAt });
    }
  }

  const history = new Map(remote.history.map((record) => [record.id, record]));
  for (const record of local.history) history.set(record.id, record);
  resolved.history = [...history.values()]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_MATCH_RECORDS);
  if (keys.size) resolved.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return resolved;
}

export function resolveEntityConflicts(
  local: UserSnapshot,
  remote: UserSnapshot,
  conflicts: string[],
  baseline: UserSnapshot | null = null,
) {
  const resolved = reconcileRemoteAccountState(local, remote, conflicts, baseline);
  const history = new Map(remote.history.map((record) => [record.id, record]));
  for (const record of local.history) history.set(record.id, record);
  resolved.history = [...history.values()]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_MATCH_RECORDS);
  resolved.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return resolved;
}
