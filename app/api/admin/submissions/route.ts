import { getDatabase, requireAdministrator } from "../../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../../lib/request-security";
import { serverErrorResponse } from "../../../../lib/server-errors";
import { isSubmissionKind, isSubmissionStatus, sourceSubmissionStatus } from "../../../../lib/submission-moderation";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store" },
});

async function ensureSubmissionTables(db: Awaited<ReturnType<typeof getDatabase>>) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ruling_requests (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id TEXT, question TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'published', 'withdrawn')), answer TEXT, administrator_id TEXT REFERENCES users(id) ON DELETE SET NULL, submitted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feedback_reports (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'bug', 'issue')), card_id TEXT, message TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'closed')), submitted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS submission_reviews (kind TEXT NOT NULL CHECK (kind IN ('question', 'suggestion', 'bug', 'issue')), submission_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'in_review', 'resolved', 'closed')), response TEXT NOT NULL DEFAULT '', administrator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, submission_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS submission_reviews_status_idx ON submission_reviews(status, updated_at)"),
  ]);
  return db;
}

/** The complete inbox is deliberately restricted to verified administrators. */
export async function GET(request: Request) {
  try {
    await requireAdministrator(request);
    const db = await ensureSubmissionTables(await getDatabase());
    const [records, totals] = await Promise.all([
      db.prepare(`
        SELECT 'question' AS kind, r.id, r.user_id, u.display_name AS player_name,
          u.email AS player_email, r.card_id, r.question AS message, r.source_url,
          COALESCE(v.status, CASE
            WHEN r.status IN ('answered', 'published') THEN 'resolved'
            WHEN r.status = 'withdrawn' THEN 'closed' ELSE 'pending' END) AS status,
          COALESCE(v.response, r.answer, '') AS response,
          r.submitted_at, r.updated_at, v.administrator_id AS reviewed_by, v.updated_at AS reviewed_at
        FROM ruling_requests r JOIN users u ON u.id = r.user_id
        LEFT JOIN submission_reviews v ON v.kind = 'question' AND v.submission_id = r.id
        UNION ALL
        SELECT f.kind AS kind, f.id, f.user_id, u.display_name AS player_name,
          u.email AS player_email, f.card_id, f.message, f.source_url,
          COALESCE(v.status, CASE
            WHEN f.status = 'reviewed' THEN 'in_review' ELSE f.status END) AS status,
          COALESCE(v.response, '') AS response,
          f.submitted_at, f.updated_at, v.administrator_id AS reviewed_by, v.updated_at AS reviewed_at
        FROM feedback_reports f JOIN users u ON u.id = f.user_id
        LEFT JOIN submission_reviews v ON v.kind = f.kind AND v.submission_id = f.id
        ORDER BY submitted_at DESC LIMIT 500
      `).all(),
      db.prepare("SELECT ((SELECT COUNT(*) FROM ruling_requests) + (SELECT COUNT(*) FROM feedback_reports)) AS total").first<{ total: number }>(),
    ]);
    return json({ submissions: records.results ?? [], total: Number(totals?.total ?? 0) });
  } catch (error) {
    return serverErrorResponse(error, crypto.randomUUID(), "Could not load submissions.", { route: "/api/admin/submissions", method: "GET" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdministrator(request);
    const raw = await request.text();
    if (raw.length > 8_000) return json({ error: "Request is too large." }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const { kind, id, status } = body;
    const response = typeof body.response === "string"
      ? body.response.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
    if (!isSubmissionKind(kind) || !isSubmissionStatus(status)
      || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)
      || typeof body.response !== "string" || response.length > 2000) {
      return json({ error: "Invalid submission, status, or response (maximum 2,000 characters)." }, 422);
    }
    if (kind === "question" && status === "resolved" && response.length < 5) {
      return json({ error: "Answer the question before marking it resolved." }, 422);
    }
    const db = await ensureSubmissionTables(await getDatabase());
    await enforceD1RateLimit(db, `admin-submissions:${admin.id}:${requestClientKey(request)}`, 60, 60_000);
    const table = kind === "question" ? "ruling_requests" : "feedback_reports";
    const existing = await db.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).bind(id).first<{ id: string; status: string }>();
    if (!existing) return json({ error: "This submission no longer exists." }, 404);
    const now = Date.now();
    const sourceStatus = sourceSubmissionStatus(kind, status);
    await db.batch([
      kind === "question"
        ? db.prepare("UPDATE ruling_requests SET status = ?, answer = ?, administrator_id = ?, updated_at = ? WHERE id = ?")
          .bind(status === "resolved" && existing.status === "published" ? "published" : sourceStatus,
            status === "resolved" ? response : null, admin.id, now, id)
        : db.prepare("UPDATE feedback_reports SET status = ?, updated_at = ? WHERE id = ?")
          .bind(sourceStatus, now, id),
      db.prepare(`INSERT INTO submission_reviews (kind, submission_id, status, response, administrator_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, submission_id) DO UPDATE SET
          status = excluded.status, response = excluded.response,
          administrator_id = excluded.administrator_id, updated_at = excluded.updated_at`)
        .bind(kind, id, status, response, admin.id, now),
    ]);
    return json({ id, kind, status, response, reviewedAt: now });
  } catch (error) {
    if (error instanceof RateLimitError) return Response.json(
      { error: error.message, retryAfter: error.retryAfterSeconds },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) } },
    );
    return serverErrorResponse(error, crypto.randomUUID(), "Could not update submission.", { route: "/api/admin/submissions", method: "POST" });
  }
}
