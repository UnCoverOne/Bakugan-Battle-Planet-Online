import { CARD_BY_ID } from "../../../lib/data";
import { getDatabase, getSessionUserFromDatabase } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit } from "../../../lib/request-security";
import { FEEDBACK_MAX_REQUEST_BYTES, validateFeedback } from "../../../lib/feedback";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store" },
});

/** Submissions are public-write, private-read. Never trust a client-supplied identity. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > FEEDBACK_MAX_REQUEST_BYTES) {
      return json({ error: "Request is too large." }, 413);
    }
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Invalid feedback." }, 400);
    const decoder = new TextDecoder();
    let raw = "", bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > FEEDBACK_MAX_REQUEST_BYTES) {
          await reader.cancel();
          return json({ error: "Request is too large." }, 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid feedback." }, 400); }
    const result = validateFeedback(body, id => CARD_BY_ID.has(id));
    if (!result.valid) return json({ error: result.error }, 422);

    const db = await getDatabase();
    const user = await getSessionUserFromDatabase(request, db);
    // Cloudflare supplies this header. Do not trust caller-controlled X-Forwarded-For
    // for anonymous quotas; use a shared fallback outside the trusted edge.
    const client = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
    await enforceD1RateLimit(db, "feedback:client:" + client, 20, 60_000);
    if (user) {
      await enforceD1RateLimit(db, "feedback:account:" + user.id, 5, 60_000);
    } else {
      await enforceD1RateLimit(db, "feedback:guest:minute:" + client, 5, 60_000);
      await enforceD1RateLimit(db, "feedback:guest:hour:" + client, 20, 3_600_000);
    }
    const { kind, cardId, message } = result.input;
    const id = crypto.randomUUID();
    const now = Date.now();
    // source_url intentionally omitted: its historical column defaults to an empty string.
    await db.prepare(
      "INSERT INTO feedback_reports (id, user_id, kind, card_id, message, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, user?.id ?? null, kind, cardId, message, now, now).run();
    return json({ id, status: "pending", submittedAt: now }, 201);
  } catch (error) {
    return serverErrorResponse(error, crypto.randomUUID(), "Could not submit feedback. Please try again.", { route: "/api/feedback", method: "POST" });
  }
}
