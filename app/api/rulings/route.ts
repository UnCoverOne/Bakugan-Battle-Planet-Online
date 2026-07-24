import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    const rows = await db.prepare(
      "SELECT id, card_id, question, status, answer, submitted_at, updated_at FROM ruling_requests WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 100",
    ).bind(user.id).all();
    return json({ requests: rows.results ?? [] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load ruling requests." }, 400);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `ruling:${user.id}:${requestClientKey(request)}`, 5, 60_000);
    const body = await request.json() as { cardId?: unknown; question?: unknown; sourceUrl?: unknown };
    const cardId = typeof body.cardId === "string" ? body.cardId.trim().slice(0, 80) : null;
    const question = typeof body.question === "string" ? body.question.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : "";
    if (question.length < 20 || question.length > 2_000) return json({ error: "The question must be between 20 and 2,000 characters." }, 422);
    if (cardId && !/^bb-\d{1,4}$/.test(cardId)) return json({ error: "The selected card ID is invalid." }, 422);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(
      "INSERT INTO ruling_requests (id, user_id, card_id, question, source_url, status, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    ).bind(id, user.id, cardId, question, sourceUrl, now, now).run();
    console.log(JSON.stringify({ event: "ruling_request_created", id, userId: user.id, cardId }));
    return json({ id, status: "pending", submittedAt: now }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit the ruling request.";
    if (error instanceof RateLimitError) return Response.json({ error: error.message, retryAfter: error.retryAfterSeconds }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) } });
    return json({ error: message }, 400);
  }
}
