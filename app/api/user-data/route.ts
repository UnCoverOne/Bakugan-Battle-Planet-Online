import { getDatabase, getSessionUser } from "../../../lib/account-server";
import {
  assertSameOrigin,
  enforceD1RateLimit,
  RateLimitError,
  requestClientKey,
} from "../../../lib/request-security";
import {
  assembleEntitySnapshot,
  entityKey,
  revisionMap,
  snapshotToSyncRequest,
  USER_DATA_SCHEMA_VERSION,
  validateEntityUpdate,
  validateHistoryRecord,
  type UserDataEntityRow,
  type UserDataSyncRequest,
} from "../../../lib/user-data-entities";
import type { UserSnapshot } from "../../../lib/persistence";

export const dynamic = "force-dynamic";
const MAX_SYNC_BYTES = 4_000_000;
const MAX_ACCOUNT_BYTES = 8_000_000;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });

type Database = Awaited<ReturnType<typeof getDatabase>>;
type HistoryRow = { data_json: string };

class PayloadTooLargeError extends Error {}

async function readBoundedText(request: Request, maximumBytes: number) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new PayloadTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new PayloadTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const textBytes = (value: string | null | undefined) =>
  value ? new TextEncoder().encode(value).byteLength : 0;

async function ensureEntitySchema(db: Database) {
  try {
    await db.prepare("SELECT 1 FROM user_data_entities LIMIT 1").first();
    return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/no such table:\s*user_data_entities/i.test(error.message)
    ) {
      throw error;
    }
  }
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

async function readAccountRows(db: Database, userId: string) {
  const [entities, history] = await db.batch([
    db
      .prepare(
        "SELECT entity_type, entity_id, revision, data_json, deleted_at, updated_at FROM user_data_entities WHERE user_id = ? ORDER BY entity_type, entity_id",
      )
      .bind(userId),
    db
      .prepare(
        "SELECT data_json FROM user_match_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 200",
      )
      .bind(userId),
  ]);
  const rows = (entities.results ?? []) as UserDataEntityRow[];
  const records = ((history.results ?? []) as HistoryRow[]).flatMap((row) => {
    try {
      return [JSON.parse(row.data_json)];
    } catch {
      return [];
    }
  });
  return { rows, history: records };
}

async function migrateLegacySnapshot(db: Database, userId: string) {
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM user_data_entities WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  if (Number(count?.count) > 0) return;
  const legacy = await db
    .prepare("SELECT data_json FROM user_data WHERE user_id = ?")
    .bind(userId)
    .first<{ data_json: string }>();
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
    ...initial.entities.map((entity) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
        )
        .bind(
          userId,
          entity.type,
          entity.id,
          entity.data == null ? null : JSON.stringify(entity.data),
          entity.deletedAt ?? null,
          now,
        ),
    ),
    ...initial.history.map((record) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO user_match_history (user_id, event_id, data_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(userId, record.id, JSON.stringify(record), record.at, now),
    ),
  ];
  if (statements.length) await db.batch(statements);
}

async function accountPayload(db: Database, userId: string) {
  const { rows, history } = await readAccountRows(db, userId);
  return {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    revisions: revisionMap(rows),
    updatedAt: Math.max(0, ...rows.map((row) => row.updated_at)),
    data: assembleEntitySnapshot(rows, history),
  };
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    await ensureEntitySchema(db);
    await migrateLegacySnapshot(db, user.id);
    return json(await accountPayload(db, user.id));
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Could not load synced data.",
      },
      400,
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    await ensureEntitySchema(db);
    await enforceD1RateLimit(
      db,
      `sync:${user.id}:${requestClientKey(request)}`,
      30,
      60_000,
    );
    const raw = await readBoundedText(request, MAX_SYNC_BYTES);
    const body = JSON.parse(raw) as Partial<UserDataSyncRequest>;
    if (
      body.schemaVersion !== USER_DATA_SCHEMA_VERSION ||
      !Array.isArray(body.entities) ||
      !Array.isArray(body.history) ||
      body.entities.length > 300 ||
      body.history.length > 200
    ) {
      return json({ error: "Sync batch is invalid." }, 400);
    }

    await migrateLegacySnapshot(db, user.id);
    const usage = await db
      .prepare(
        "SELECT (SELECT COALESCE(SUM(LENGTH(CAST(data_json AS BLOB))), 0) FROM user_data_entities WHERE user_id = ?) + (SELECT COALESCE(SUM(LENGTH(CAST(data_json AS BLOB))), 0) FROM user_match_history WHERE user_id = ?) AS bytes",
      )
      .bind(user.id, user.id)
      .first<{ bytes: number }>();
    let estimatedAccountBytes = Number(usage?.bytes) || 0;
    const conflicts: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const candidate of body.entities) {
      let key = "unknown";
      try {
        validateEntityUpdate(candidate);
        key = entityKey(candidate.type, candidate.id);
        const dataJson =
          candidate.data == null ? null : JSON.stringify(candidate.data);
        const deletedAt = candidate.deletedAt ?? null;
        const current = await db
          .prepare(
            "SELECT entity_type, entity_id, revision, data_json, deleted_at, updated_at FROM user_data_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?",
          )
          .bind(user.id, candidate.type, candidate.id)
          .first<UserDataEntityRow>();
        const nextAccountBytes =
          estimatedAccountBytes -
          textBytes(current?.data_json) +
          textBytes(dataJson);
        if (nextAccountBytes > MAX_ACCOUNT_BYTES) {
          throw new Error("Account recovery storage is full.");
        }
        const identical =
          current?.data_json === dataJson && current?.deleted_at === deletedAt;
        if (current && current.revision !== candidate.expectedRevision) {
          if (!identical) conflicts.push(key);
          continue;
        }
        const now = Date.now();
        if (!current) {
          if (candidate.expectedRevision !== 0) {
            conflicts.push(key);
            continue;
          }
          if (candidate.type === "deck") {
            const deckCount = await db
              .prepare(
                "SELECT COUNT(*) AS count FROM user_data_entities WHERE user_id = ? AND entity_type = 'deck'",
              )
              .bind(user.id)
              .first<{ count: number }>();
            if (Number(deckCount?.count) >= 250) {
              throw new Error("Account deck and deletion storage is full.");
            }
          }
          await db
            .prepare(
              "INSERT OR IGNORE INTO user_data_entities (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
            )
            .bind(
              user.id,
              candidate.type,
              candidate.id,
              dataJson,
              deletedAt,
              now,
            )
            .run();
        } else if (!identical) {
          await db
            .prepare(
              "UPDATE user_data_entities SET revision = revision + 1, data_json = ?, deleted_at = ?, updated_at = ? WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND revision = ?",
            )
            .bind(
              dataJson,
              deletedAt,
              now,
              user.id,
              candidate.type,
              candidate.id,
              candidate.expectedRevision,
            )
            .run();
        }
        const latest = await db
          .prepare(
            "SELECT data_json, deleted_at FROM user_data_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?",
          )
          .bind(user.id, candidate.type, candidate.id)
          .first<{ data_json: string | null; deleted_at: string | null }>();
        if (
          !latest ||
          latest.data_json !== dataJson ||
          latest.deleted_at !== deletedAt
        ) {
          conflicts.push(key);
        } else {
          estimatedAccountBytes = nextAccountBytes;
        }
      } catch (error) {
        errors.push({
          key,
          error: error instanceof Error ? error.message : "Entity is invalid.",
        });
      }
    }

    for (const candidate of body.history) {
      try {
        validateHistoryRecord(candidate);
        const existing = await db
          .prepare(
            "SELECT LENGTH(CAST(data_json AS BLOB)) AS bytes FROM user_match_history WHERE user_id = ? AND event_id = ?",
          )
          .bind(user.id, candidate.id)
          .first<{ bytes: number }>();
        const recordJson = JSON.stringify(candidate);
        if (
          !existing &&
          estimatedAccountBytes + textBytes(recordJson) > MAX_ACCOUNT_BYTES
        ) {
          throw new Error("Account recovery storage is full.");
        }
        await db
          .prepare(
            "INSERT OR IGNORE INTO user_match_history (user_id, event_id, data_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            user.id,
            candidate.id,
            recordJson,
            candidate.at,
            Date.now(),
          )
          .run();
        if (!existing) estimatedAccountBytes += textBytes(recordJson);
      } catch (error) {
        errors.push({
          key: `history:${String(candidate?.id ?? "unknown")}`,
          error:
            error instanceof Error ? error.message : "History record is invalid.",
        });
      }
    }
    await db
      .prepare(
        "DELETE FROM user_match_history WHERE user_id = ? AND event_id NOT IN (SELECT event_id FROM user_match_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 200)",
      )
      .bind(user.id, user.id)
      .run();

    const payload = await accountPayload(db, user.id);
    if (conflicts.length) {
      return json(
        {
          ...payload,
          error: "Cloud entities changed.",
          conflicts: [...new Set(conflicts)],
          errors,
        },
        409,
      );
    }
    return json({ ...payload, errors });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json(
        {
          error:
            "This sync batch is too large. Smaller account entities will continue syncing independently.",
        },
        413,
      );
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: error.message, retryAfter: error.retryAfterSeconds },
        {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "retry-after": String(error.retryAfterSeconds),
          },
        },
      );
    }
    return json(
      {
        error:
          error instanceof Error ? error.message : "Could not save synced data.",
      },
      400,
    );
  }
}
