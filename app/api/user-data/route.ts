import { ensureAccountSchema, getDatabase, getSessionUser } from "../../../lib/account-server";

export const dynamic = "force-dynamic";
const MAX_SYNC_BYTES = 4_000_000;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  try {
    await ensureAccountSchema();
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    const row = await db.prepare("SELECT revision, data_json, updated_at FROM user_data WHERE user_id = ?").bind(user.id)
      .first<{ revision: number; data_json: string; updated_at: number }>();
    if (!row) return json({ revision: 0, updatedAt: 0, data: null });
    return json({ revision: row.revision, updatedAt: row.updated_at, data: JSON.parse(row.data_json) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load synced data." }, 400);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureAccountSchema();
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SYNC_BYTES) return json({ error: "Synced data is too large. Remove old replays or unused decks and try again." }, 413);
    const body = JSON.parse(raw) as { expectedRevision?: number; data?: unknown };
    if (!body.data || typeof body.data !== "object") return json({ error: "Sync data is missing." }, 400);
    const expectedRevision = Number.isInteger(body.expectedRevision) ? Number(body.expectedRevision) : 0;
    const dataJson = JSON.stringify(body.data);
    const db = await getDatabase();
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
    if (!result.meta.changes) {
      const latest = await db.prepare("SELECT revision, data_json, updated_at FROM user_data WHERE user_id = ?").bind(user.id)
        .first<{ revision: number; data_json: string; updated_at: number }>();
      return json({ error: "Cloud data changed.", revision: latest?.revision ?? 0, updatedAt: latest?.updated_at ?? 0, data: latest ? JSON.parse(latest.data_json) : null }, 409);
    }
    return json({ revision, updatedAt: now });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save synced data." }, 400);
  }
}
