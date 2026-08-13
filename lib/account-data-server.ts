import {
  assembleEntitySnapshot,
  entityKey,
  revisionMap,
  snapshotToSyncRequest,
  USER_DATA_SCHEMA_VERSION,
  validateEntityUpdate,
  validateHistoryRecord,
  type UserDataEntityRow,
  type UserDataEntityType,
  type UserDataSyncRequest,
} from "./user-data-entities";
import { MAX_MATCH_RECORDS, type MatchResultRecord, type UserSnapshot } from "./persistence";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import { ValidationError } from "./server-errors";

export const MAX_SYNC_BYTES = 4_000_000;
export const MAX_ACCOUNT_BYTES = 8_000_000;
export const MAX_SYNC_ENTITIES = 300;
export const MAX_SYNC_HISTORY = MAX_MATCH_RECORDS;
export const MAX_ACCOUNT_DECK_ROWS = 250;

export type AccountDataPayload = {
  schemaVersion: typeof USER_DATA_SCHEMA_VERSION;
  revisions: Record<string, number>;
  updatedAt: number;
  data: UserSnapshot | null;
};

export type AccountDataSyncResult = AccountDataPayload & {
  conflicts: string[];
  errors: Array<{ key: string; error: string }>;
};

export type AccountDataStats = {
  deckCount: number;
  matchCount: number;
  updatedAt: number;
};

type HistoryRow = {
  event_id: string;
  data_json: string;
  occurred_at: string;
  created_at: number;
};

type PreparedEntity = {
  key: string;
  type: UserDataEntityType;
  id: string;
  expectedRevision: number;
  dataJson: string | null;
  deletedAt: string | null;
};

type LegacyDataRow = {
  user_id: string;
  data_json: string;
  updated_at: number;
};

const textBytes = (value: string | null | undefined) =>
  value ? new TextEncoder().encode(value).byteLength : 0;

async function runBatches(
  db: AccountDatabase,
  statements: D1PreparedStatement[],
  chunkSize = 50,
) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

export async function ensureAccountDataSchema(db: AccountDatabase) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS user_data_entities (user_id TEXT NOT NULL, entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'settings', 'preferences', 'deck', 'draft')), entity_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, data_json TEXT, deleted_at TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, entity_type, entity_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS user_data_entities_user_updated_idx ON user_data_entities(user_id, updated_at)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS user_match_history (user_id TEXT NOT NULL, event_id TEXT NOT NULL, data_json TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, event_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS user_match_history_user_occurred_idx ON user_match_history(user_id, occurred_at DESC)",
    ),
  ]);
}

export async function readAccountDataRows(db: AccountDatabase, userId: string) {
  const [entities, history] = await db.batch([
    db.prepare(
      "SELECT entity_type, entity_id, revision, data_json, deleted_at, updated_at FROM user_data_entities WHERE user_id = ? ORDER BY entity_type, entity_id",
    ).bind(userId),
    db.prepare(
      `SELECT event_id, data_json, occurred_at, created_at FROM user_match_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ${MAX_MATCH_RECORDS}`,
    ).bind(userId),
  ]);
  const rows = (entities.results ?? []) as UserDataEntityRow[];
  const historyRows = (history.results ?? []) as HistoryRow[];
  const records = historyRows.flatMap((row) => {
    try {
      return [JSON.parse(row.data_json) as MatchResultRecord];
    } catch {
      return [];
    }
  });
  return { rows, historyRows, records };
}

export async function migrateLegacyAccountSnapshot(db: AccountDatabase, userId: string) {
  const count = await db.prepare(
    "SELECT COUNT(*) AS count FROM user_data_entities WHERE user_id = ?",
  ).bind(userId).first<{ count: number }>();
  if (Number(count?.count) > 0) return;
  const legacy = await db.prepare(
    "SELECT data_json FROM user_data WHERE user_id = ?",
  ).bind(userId).first<{ data_json: string }>();
  if (!legacy?.data_json) return;

  let snapshot: UserSnapshot;
  try {
    snapshot = JSON.parse(legacy.data_json) as UserSnapshot;
  } catch {
    return;
  }
  const initial = snapshotToSyncRequest(snapshot, {});
  const now = Date.now();
  const statements = [
    ...initial.entities.map((entity) => db.prepare(
      "INSERT OR IGNORE INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    ).bind(
      userId,
      entity.type,
      entity.id,
      entity.data == null ? null : JSON.stringify(entity.data),
      entity.deletedAt ?? null,
      now,
    )),
    ...initial.history.map((record) => db.prepare(
      "INSERT OR IGNORE INTO user_match_history (user_id, event_id, data_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(userId, record.id, JSON.stringify(record), record.at, now)),
  ];
  await runBatches(db, statements);
}

export async function loadAccountDataPayload(
  db: AccountDatabase,
  userId: string,
): Promise<AccountDataPayload> {
  await ensureAccountDataSchema(db);
  await migrateLegacyAccountSnapshot(db, userId);
  const { rows, records } = await readAccountDataRows(db, userId);
  return {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    revisions: revisionMap(rows),
    updatedAt: Math.max(0, ...rows.map((row) => row.updated_at)),
    data: assembleEntitySnapshot(rows, records),
  };
}

function validateSyncRequest(
  body: Partial<UserDataSyncRequest>,
): asserts body is UserDataSyncRequest {
  if (
    body.schemaVersion !== USER_DATA_SCHEMA_VERSION
    || !Array.isArray(body.entities)
    || !Array.isArray(body.history)
    || body.entities.length > MAX_SYNC_ENTITIES
    || body.history.length > MAX_SYNC_HISTORY
  ) {
    throw new ValidationError("Sync batch is invalid.");
  }
}

export async function syncAccountData(
  db: AccountDatabase,
  userId: string,
  body: Partial<UserDataSyncRequest>,
): Promise<AccountDataSyncResult> {
  validateSyncRequest(body);
  await ensureAccountDataSchema(db);
  await migrateLegacyAccountSnapshot(db, userId);

  const errors: Array<{ key: string; error: string }> = [];
  const preparedEntities: PreparedEntity[] = [];
  const suppliedKeys = new Set<string>();
  for (const candidate of body.entities) {
    let key = "unknown";
    try {
      validateEntityUpdate(candidate);
      key = entityKey(candidate.type, candidate.id);
      if (suppliedKeys.has(key)) {
        throw new Error(`Sync entity ${key} was supplied more than once.`);
      }
      suppliedKeys.add(key);
      preparedEntities.push({
        key,
        type: candidate.type,
        id: candidate.id,
        expectedRevision: candidate.expectedRevision,
        dataJson: candidate.data == null ? null : JSON.stringify(candidate.data),
        deletedAt: candidate.deletedAt ?? null,
      });
    } catch (error) {
      errors.push({
        key,
        error: error instanceof Error ? error.message : "Entity is invalid.",
      });
    }
  }

  const validHistory: MatchResultRecord[] = [];
  const suppliedHistoryIds = new Set<string>();
  for (const candidate of body.history) {
    try {
      validateHistoryRecord(candidate);
      if (suppliedHistoryIds.has(candidate.id)) {
        throw new Error(`History record ${candidate.id} was supplied more than once.`);
      }
      suppliedHistoryIds.add(candidate.id);
      validHistory.push(candidate);
    } catch (error) {
      errors.push({
        key: `history:${String((candidate as { id?: unknown })?.id ?? "unknown")}`,
        error: error instanceof Error ? error.message : "History record is invalid.",
      });
    }
  }

  const { rows: currentRows, historyRows } = await readAccountDataRows(db, userId);
  const currentByKey = new Map(
    currentRows.map((row) => [entityKey(row.entity_type, row.entity_id), row]),
  );
  let estimatedBytes = currentRows.reduce(
    (sum, row) => sum + textBytes(row.data_json),
    0,
  ) + historyRows.reduce((sum, row) => sum + textBytes(row.data_json), 0);
  let deckRows = currentRows.filter((row) => row.entity_type === "deck").length;
  const conflicts = new Set<string>();
  const mutations: D1PreparedStatement[] = [];
  const deletedDeckIds = new Set<string>();
  const expectedFinal = new Map<
    string,
    { dataJson: string | null; deletedAt: string | null }
  >();
  const now = Date.now();

  for (const candidate of preparedEntities) {
    const current = currentByKey.get(candidate.key);
    const identical = current?.data_json === candidate.dataJson
      && current?.deleted_at === candidate.deletedAt;
    if (current && current.revision !== candidate.expectedRevision) {
      if (!identical) conflicts.add(candidate.key);
      continue;
    }
    if (!current && candidate.expectedRevision !== 0) {
      conflicts.add(candidate.key);
      continue;
    }
    const nextBytes = estimatedBytes
      - textBytes(current?.data_json)
      + textBytes(candidate.dataJson);
    if (nextBytes > MAX_ACCOUNT_BYTES) {
      errors.push({ key: candidate.key, error: "Account recovery storage is full." });
      continue;
    }
    if (!current && candidate.type === "deck") {
      if (deckRows >= MAX_ACCOUNT_DECK_ROWS) {
        errors.push({
          key: candidate.key,
          error: "Account deck and deletion storage is full.",
        });
        continue;
      }
      deckRows += 1;
    }
    if (!identical) {
      mutations.push(current
        ? db.prepare(
          "UPDATE user_data_entities SET revision = revision + 1, data_json = ?, deleted_at = ?, updated_at = ? WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND revision = ?",
        ).bind(
          candidate.dataJson,
          candidate.deletedAt,
          now,
          userId,
          candidate.type,
          candidate.id,
          candidate.expectedRevision,
        )
        : db.prepare(
          "INSERT OR IGNORE INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
        ).bind(
          userId,
          candidate.type,
          candidate.id,
          candidate.dataJson,
          candidate.deletedAt,
          now,
        ));
    }
    if (candidate.type === "deck" && candidate.deletedAt) deletedDeckIds.add(candidate.id);
    expectedFinal.set(candidate.key, {
      dataJson: candidate.dataJson,
      deletedAt: candidate.deletedAt,
    });
    estimatedBytes = nextBytes;
  }

  const existingHistory = new Set(historyRows.map((row) => row.event_id));
  for (const record of validHistory) {
    if (existingHistory.has(record.id)) continue;
    const recordJson = JSON.stringify(record);
    if (estimatedBytes + textBytes(recordJson) > MAX_ACCOUNT_BYTES) {
      errors.push({
        key: `history:${record.id}`,
        error: "Account recovery storage is full.",
      });
      continue;
    }
    mutations.push(db.prepare(
      "INSERT OR IGNORE INTO user_match_history (user_id, event_id, data_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(userId, record.id, recordJson, record.at, now));
    existingHistory.add(record.id);
    estimatedBytes += textBytes(recordJson);
  }

  await runBatches(db, mutations);
  if (deletedDeckIds.size) {
    await ensureAdministrationSchema(db);
    await runBatches(db, [...deletedDeckIds].map((deckId) => db.prepare(
      "DELETE FROM public_deck_favorites WHERE deck_id = ?",
    ).bind(deckId)));
  }
  await db.prepare(
    `DELETE FROM user_match_history WHERE user_id = ? AND event_id NOT IN (SELECT event_id FROM user_match_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ${MAX_MATCH_RECORDS})`,
  ).bind(userId, userId).run();

  const payload = await loadAccountDataPayload(db, userId);
  const latestRows = (await readAccountDataRows(db, userId)).rows;
  const latestByKey = new Map(
    latestRows.map((row) => [entityKey(row.entity_type, row.entity_id), row]),
  );
  for (const [key, expected] of expectedFinal) {
    const latest = latestByKey.get(key);
    if (
      !latest
      || latest.data_json !== expected.dataJson
      || latest.deleted_at !== expected.deletedAt
    ) {
      conflicts.add(key);
    }
  }
  return { ...payload, conflicts: [...conflicts], errors };
}

export async function resetAccountData(
  db: AccountDatabase,
  userId: string,
  scope: "all" | "decks" | "history" | "settings" | "profile",
  profile?: { displayName: string; faction: string },
) {
  await ensureAccountDataSchema(db);
  if (scope !== "all") await migrateLegacyAccountSnapshot(db, userId);
  const now = Date.now();
  if (scope === "all") {
    await db.batch([
      db.prepare("DELETE FROM user_data_entities WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_match_history WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId),
    ]);
    return;
  }
  if (scope === "decks") {
    const preferences = JSON.stringify({
      selectedDeckId: "",
      format: "bo1",
      matchMode: "solo",
      updatedAt: now,
    });
    await db.batch([
      db.prepare(
        "DELETE FROM user_data_entities WHERE user_id = ? AND entity_type IN ('deck', 'draft')",
      ).bind(userId),
      db.prepare(
        "INSERT INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, 'preferences', 'main', 1, ?, NULL, ?) ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET revision = revision + 1, data_json = excluded.data_json, deleted_at = NULL, updated_at = excluded.updated_at",
      ).bind(userId, preferences, now),
    ]);
    return;
  }
  if (scope === "history") {
    await db.prepare(
      "DELETE FROM user_match_history WHERE user_id = ?",
    ).bind(userId).run();
    return;
  }
  const type: UserDataEntityType = scope === "settings" ? "settings" : "profile";
  const data = scope === "settings"
    ? null
    : {
      name: profile?.displayName ?? "Brawler",
      faction: profile?.faction ?? "Pyrus",
      signedIn: false,
    };
  await db.prepare(
    "INSERT INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, ?, 'main', 1, ?, NULL, ?) ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET revision = revision + 1, data_json = excluded.data_json, deleted_at = NULL, updated_at = excluded.updated_at",
  ).bind(
    userId,
    type,
    data == null ? null : JSON.stringify(data),
    now,
  ).run();
}

export async function deleteAccountData(db: AccountDatabase, userId: string) {
  await ensureAccountDataSchema(db);
  await db.batch([
    db.prepare("DELETE FROM user_data_entities WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM user_match_history WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId),
  ]);
}

export async function accountDataStatsByUser(db: AccountDatabase) {
  await ensureAccountDataSchema(db);
  const [entities, history, legacy] = await db.batch([
    db.prepare(
      "SELECT user_id, SUM(CASE WHEN entity_type = 'deck' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS deck_count, MAX(updated_at) AS updated_at FROM user_data_entities GROUP BY user_id",
    ),
    db.prepare(
      "SELECT user_id, COUNT(*) AS match_count, MAX(created_at) AS updated_at FROM user_match_history GROUP BY user_id",
    ),
    db.prepare(
      "SELECT user_id, data_json, updated_at FROM user_data WHERE NOT EXISTS (SELECT 1 FROM user_data_entities WHERE user_data_entities.user_id = user_data.user_id)",
    ),
  ]);
  const stats = new Map<string, AccountDataStats>();
  for (const row of (entities.results ?? []) as Array<{
    user_id: string;
    deck_count: number;
    updated_at: number;
  }>) {
    stats.set(row.user_id, {
      deckCount: Number(row.deck_count) || 0,
      matchCount: 0,
      updatedAt: Number(row.updated_at) || 0,
    });
  }
  for (const row of (history.results ?? []) as Array<{
    user_id: string;
    match_count: number;
    updated_at: number;
  }>) {
    const current = stats.get(row.user_id) ?? {
      deckCount: 0,
      matchCount: 0,
      updatedAt: 0,
    };
    current.matchCount = Number(row.match_count) || 0;
    current.updatedAt = Math.max(current.updatedAt, Number(row.updated_at) || 0);
    stats.set(row.user_id, current);
  }
  for (const row of (legacy.results ?? []) as LegacyDataRow[]) {
    try {
      const snapshot = JSON.parse(row.data_json) as Partial<UserSnapshot>;
      stats.set(row.user_id, {
        deckCount: Array.isArray(snapshot.decks) ? snapshot.decks.length : 0,
        matchCount: Array.isArray(snapshot.history) ? snapshot.history.length : 0,
        updatedAt: Number(row.updated_at) || 0,
      });
    } catch {
      stats.set(row.user_id, {
        deckCount: 0,
        matchCount: 0,
        updatedAt: Number(row.updated_at) || 0,
      });
    }
  }
  return stats;
}
