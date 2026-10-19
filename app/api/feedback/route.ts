import { CARD_BY_ID } from "../../../lib/data";
import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

const CATEGORIES = new Set(["suggestion", "bug", "issue"]);
async function database() {
  const db = await getDatabase();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS feedback_reports (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'bug', 'issue')), card_id TEXT, message TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'closed')), submitted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feedback_reports_user_submitted_idx ON feedback_reports (user_id, submitted_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feedback_reports_status_submitted_idx ON feedback_reports (status, submitted_at)"),
  ]);
  return db;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await database();
    const isAdmin = user.roles.includes("administrator");
    const all = isAdmin && new URL(request.url).searchParams.get("scope") === "all";
    const rows = all
      ? await db.prepare("SELECT id, user_id, kind, card_id, message, source_url, status, submitted_at, updated_at FROM feedback_reports ORDER BY submitted_at DESC LIMIT 200").all()
      : await db.prepare("SELECT id, kind, card_id, message, status, submitted_at, updated_at FROM feedback_reports WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 100").bind(user.id).all();
    return json({ reports: rows.results ?? [] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load feedback reports." }, 400);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const body = await request.json() as { kind?: unknown; cardId?: unknown; message?: unknown; sourceUrl?: unknown };
    const kind = typeof body.kind === "string" ? body.kind : "";
    const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
    const message = typeof body.message === "string"
      ? body.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : "";
    if (!CATEGORIES.has(kind)) return json({ error: "Choose Suggest an Improvement, Report a Bug, or Report an Issue." }, 422);
    if (message.length < 20 || message.length > 2000) return json({ error: "Please write between 20 and 2,000 characters." }, 422);
    if (cardId && !CARD_BY_ID.has(cardId)) return json({ error: "The selected card does not exist." }, 422);
    const db = await database();
    await enforceD1RateLimit(db, `feedback:${user.id}:${requestClientKey(request)}`, 5, 60_000);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(
      "INSERT INTO feedback_reports (id, user_id, kind, card_id, message, source_url, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, user.id, kind, cardId || null, message, sourceUrl, now, now).run();
    return json({ id, status: "pending", submittedAt: now }, 201);
  } catch (error) {
    if (error instanceof RateLimitError) return Response.json({ error: error.message, retryAfter: error.retryAfterSeconds }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) } });
    return json({ error: error instanceof Error ? error.message : "Could not submit feedback." }, 400);
  }
}
