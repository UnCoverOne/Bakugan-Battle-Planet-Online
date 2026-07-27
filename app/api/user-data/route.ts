import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../lib/request-security";
import { validateDeck, type DeckRecord } from "../../../lib/data";

export const dynamic = "force-dynamic";
const MAX_SYNC_BYTES = 4_000_000;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

function validateSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sync data must be an object.");
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1) throw new Error("Unsupported sync-data schema version.");
  if (!Array.isArray(snapshot.decks) || snapshot.decks.length > 50) throw new Error("Sync data may contain at most 50 decks.");
  if (!Array.isArray(snapshot.history) || snapshot.history.length > 200) throw new Error("Sync data may contain at most 200 history records.");
  for (const [index, candidate] of snapshot.decks.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`Deck ${index + 1} is invalid.`);
    const deck = candidate as Record<string, unknown>;
    if (typeof deck.id !== "string" || !deck.id || typeof deck.name !== "string" || !deck.name.trim()) throw new Error(`Deck ${index + 1} has no valid identity.`);
    if (!Array.isArray(deck.bakuganIds) || deck.bakuganIds.length > 3 || !deck.bakuganIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid Bakugan Team.`);
    if (!Array.isArray(deck.coreIds) || deck.coreIds.length > 6 || !deck.coreIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid BakuCore kit.`);
    if (!Array.isArray(deck.cardIds) || deck.cardIds.length > 40 || !deck.cardIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid Main Deck.`);
    const validation = validateDeck(deck as unknown as DeckRecord);
    if (!validation.isLegal) {
      const firstIssue = validation.issues[0];
      throw new Error(`Deck ${index + 1} [${firstIssue.code}]: ${firstIssue.message}`);
    }
  }
  for (const [index, candidate] of snapshot.history.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`History record ${index + 1} is invalid.`);
    const record = candidate as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) throw new Error(`History record ${index + 1} has an invalid ID or timestamp.`);
    if (!Array.isArray(record.log) || record.log.length > 10_000) throw new Error(`History record ${index + 1} has an invalid event log.`);
  }
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    const row = await db.prepare("SELECT revision, data_json, updated_at FROM user_data WHERE user_id = ?").bind(user.id)
      .first<{ revision: number; data_json: string; updated_at: number }>();
    return row ? json({ revision: row.revision, updatedAt: row.updated_at, data: JSON.parse(row.data_json) }) : json({ revision: 0, updatedAt: 0, data: null });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load synced data." }, 400); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `sync:${user.id}:${requestClientKey(request)}`, 30, 60_000);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SYNC_BYTES) return json({ error: "Synced data is too large. Remove old replays or unused decks and try again." }, 413);
    const body = JSON.parse(raw) as { expectedRevision?: number; data?: unknown };
    if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) return json({ error: "Sync data is missing." }, 400);
    validateSnapshot(body.data);
    const expectedRevision = Number.isInteger(body.expectedRevision) ? Number(body.expectedRevision) : 0;
    const dataJson = JSON.stringify(body.data);
    const current = await db.prepare("SELECT revision, data_json, updated_at FROM user_data WHERE user_id = ?").bind(user.id)
      .first<{ revision: number; data_json: string; updated_at: number }>();
    if (!current) {
      if (expectedRevision !== 0) return json({ error: "Cloud data changed.", revision: 0, updatedAt: 0, data: null }, 409);
      const now = Date.now();
      await db.prepare("INSERT INTO user_data (user_id, revision, data_json, updated_at) VALUES (?, 1, ?, ?)").bind(user.id, dataJson, now).run();
      return json({ revision: 1, updatedAt: now });
    }
    if (current.revision !== expectedRevision) return json({ error: "Cloud data changed.", revision: current.revision, updatedAt: current.updated_at, data: JSON.parse(current.data_json) }, 409);
    const revision = current.revision + 1;
    const now = Date.now();
    const result = await db.prepare("UPDATE user_data SET revision = ?, data_json = ?, updated_at = ? WHERE user_id = ? AND revision = ?")
      .bind(revision, dataJson, now, user.id, expectedRevision).run();
    if (!result.meta?.changes) {
      const latest = await db.prepare("SELECT revision, data_json, updated_at FROM user_data WHERE user_id = ?").bind(user.id)
        .first<{ revision: number; data_json: string; updated_at: number }>();
      return json({ error: "Cloud data changed.", revision: latest?.revision ?? 0, updatedAt: latest?.updated_at ?? 0, data: latest ? JSON.parse(latest.data_json) : null }, 409);
    }
    return json({ revision, updatedAt: now });
  } catch (error) {
    if (error instanceof RateLimitError) return Response.json({ error: error.message, retryAfter: error.retryAfterSeconds }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) } });
    return json({ error: error instanceof Error ? error.message : "Could not save synced data." }, 400);
  }
}

