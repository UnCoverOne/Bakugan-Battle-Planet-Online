import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BRAWLER_PROFILE,
  toCloudSnapshot,
  type MatchResultRecord,
  type UserSnapshot,
} from "./persistence";

export const USER_DATA_SCHEMA_VERSION = 2;
export const MAX_ENTITY_BYTES = 900_000;

export type EntityRevisionMap = Record<string, number>;
export type UserDataEntityType = "profile" | "settings" | "preferences" | "deck" | "draft";

export type UserDataEntityUpdate = {
  type: UserDataEntityType;
  id: string;
  expectedRevision: number;
  data: unknown | null;
  deletedAt?: string | null;
};

export type UserDataEntityRow = {
  entity_type: UserDataEntityType;
  entity_id: string;
  revision: number;
  data_json: string | null;
  deleted_at: string | null;
  updated_at: number;
};

export type UserDataSyncRequest = {
  schemaVersion: typeof USER_DATA_SCHEMA_VERSION;
  entities: UserDataEntityUpdate[];
  history: MatchResultRecord[];
};

export function entityKey(type: UserDataEntityType, id: string) {
  return `${type}:${id}`;
}

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function update(
  type: UserDataEntityType,
  id: string,
  data: unknown | null,
  revisions: EntityRevisionMap,
  deletedAt: string | null = null,
): UserDataEntityUpdate {
  return {
    type,
    id,
    data,
    deletedAt,
    expectedRevision: revisions[entityKey(type, id)] ?? 0,
  };
}

export function snapshotToSyncRequest(
  value: UserSnapshot,
  revisions: EntityRevisionMap,
): UserDataSyncRequest {
  const snapshot = toCloudSnapshot(value);
  const entities: UserDataEntityUpdate[] = [
    update("profile", "main", snapshot.profile, revisions),
    update("settings", "main", snapshot.settings, revisions),
    update(
      "preferences",
      "main",
      {
        selectedDeckId: snapshot.selectedDeckId,
        format: snapshot.format,
        matchMode: snapshot.matchMode,
        updatedAt: snapshot.updatedAt,
      },
      revisions,
    ),
    update(
      "draft",
      "main",
      snapshot.builderDeck,
      revisions,
      snapshot.builderDeck ? null : "1970-01-01T00:00:00.000Z",
    ),
    ...snapshot.decks.map((deck) => update("deck", deck.id, deck, revisions)),
    ...(snapshot.deletedDecks ?? []).map((deletion) =>
      update("deck", deletion.id, null, revisions, deletion.deletedAt),
    ),
  ];
  return {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    entities,
    history: snapshot.history,
  };
}

export function validateEntityUpdate(value: unknown): asserts value is UserDataEntityUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sync entity must be an object.");
  }
  const entity = value as Partial<UserDataEntityUpdate>;
  if (!["profile", "settings", "preferences", "deck", "draft"].includes(String(entity.type))) {
    throw new Error("Sync entity type is invalid.");
  }
  if (typeof entity.id !== "string" || !entity.id || entity.id.length > 120) {
    throw new Error("Sync entity ID is invalid.");
  }
  if (entity.type !== "deck" && entity.id !== "main") {
    throw new Error(`Sync entity ${entity.type} must use the main ID.`);
  }
  if (!Number.isInteger(entity.expectedRevision) || Number(entity.expectedRevision) < 0) {
    throw new Error("Sync entity revision is invalid.");
  }
  if (entity.deletedAt != null && !Number.isFinite(Date.parse(String(entity.deletedAt)))) {
    throw new Error("Sync entity deletion timestamp is invalid.");
  }
  if (entity.data != null && jsonBytes(entity.data) > MAX_ENTITY_BYTES) {
    throw new Error(`Sync entity ${entity.type}:${entity.id} is too large.`);
  }
  if (entity.type === "deck" && entity.data != null) {
    const deck = entity.data as Record<string, unknown>;
    if (
      typeof deck.id !== "string" ||
      deck.id !== entity.id ||
      typeof deck.name !== "string" ||
      !deck.name.trim() ||
      !Array.isArray(deck.bakuganIds) ||
      !Array.isArray(deck.coreIds) ||
      !Array.isArray(deck.cardIds)
    ) {
      throw new Error(`Deck ${entity.id} is invalid.`);
    }
  }
}

export function validateHistoryRecord(value: unknown): asserts value is MatchResultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("History record is invalid.");
  }
  const record = value as Partial<MatchResultRecord>;
  if (
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.at !== "string" ||
    !Number.isFinite(Date.parse(record.at)) ||
    !Array.isArray(record.log) ||
    record.log.length > 10_000
  ) {
    throw new Error(`History record ${String(record.id ?? "")} is invalid.`);
  }
  if (jsonBytes(record) > MAX_ENTITY_BYTES) throw new Error(`History record ${record.id} is too large.`);
}

export function assembleEntitySnapshot(
  rows: UserDataEntityRow[],
  history: MatchResultRecord[],
): UserSnapshot | null {
  if (!rows.length && !history.length) return null;
  const active = new Map(
    rows.map((row) => [entityKey(row.entity_type, row.entity_id), row]),
  );
  const parse = <T>(row: UserDataEntityRow | undefined, fallback: T): T => {
    if (!row?.data_json || row.deleted_at) return fallback;
    try {
      return JSON.parse(row.data_json) as T;
    } catch {
      return fallback;
    }
  };
  const profile = parse(active.get("profile:main"), DEFAULT_BRAWLER_PROFILE);
  const settings = parse(active.get("settings:main"), DEFAULT_APP_SETTINGS);
  const preferences = parse(active.get("preferences:main"), {
    selectedDeckId: "",
    format: "bo1",
    matchMode: "solo",
    updatedAt: 0,
  });
  const decks = rows
    .filter((row) => row.entity_type === "deck" && !row.deleted_at && row.data_json)
    .map((row) => parse(row, null))
    .filter(Boolean) as UserSnapshot["decks"];
  const deletedDecks = rows
    .filter((row) => row.entity_type === "deck" && Boolean(row.deleted_at))
    .map((row) => ({ id: row.entity_id, deletedAt: row.deleted_at! }));
  const latestUpdate = Math.max(0, ...rows.map((row) => row.updated_at));
  return {
    schemaVersion: 1,
    updatedAt:
      typeof preferences.updatedAt === "number" && preferences.updatedAt > 0
        ? preferences.updatedAt
        : latestUpdate,
    profile: { ...DEFAULT_BRAWLER_PROFILE, ...profile, signedIn: false },
    decks,
    deletedDecks,
    history: [...history]
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, 200),
    settings: { ...DEFAULT_APP_SETTINGS, ...settings },
    route: "dashboard",
    selectedDeckId:
      typeof preferences.selectedDeckId === "string" ? preferences.selectedDeckId : "",
    builderDeck: parse(active.get("draft:main"), null),
    deckQuery: "",
    compendiumQuery: "",
    compendiumTab: "cards",
    format: preferences.format === "bo3" ? "bo3" : "bo1",
    matchMode:
      preferences.matchMode === "online"
        ? "online"
        : preferences.matchMode === "join"
          ? "join"
          : "solo",
    joinCode: "",
    match: null,
    online: false,
    selectedCore: "",
    logFilter: "all",
    replay: null,
    replayIndex: 0,
    playerId: "",
  };
}

export function revisionMap(rows: UserDataEntityRow[]): EntityRevisionMap {
  return Object.fromEntries(
    rows.map((row) => [entityKey(row.entity_type, row.entity_id), row.revision]),
  );
}
