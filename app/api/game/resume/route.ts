import { getDatabase, getSessionUser } from "../../../../lib/account-server";
import { ensureMatchSessionSchema } from "../../../../lib/match-session-schema";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../../lib/request-security";
import { AuthenticationError, ServiceUnavailableError, ValidationError, serverErrorResponse } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";
const MAX_RESUME_BODY_BYTES = 2_048;

type ResumeBody = {
  code?: unknown;
  expectedCapabilityVersion?: unknown;
  takeover?: unknown;
};

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const database = await getDatabase();
    await ensureMatchSessionSchema(database);
    await enforceD1RateLimit(database, `match-resume:${user.id}:${requestClientKey(request)}`, 20, 60_000);
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESUME_BODY_BYTES) throw new ValidationError("Resume request is too large.");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESUME_BODY_BYTES) {
      throw new ValidationError("Resume request is too large.");
    }
    const body = (() => {
      try { return JSON.parse(raw) as ResumeBody; }
      catch { return null; }
    })();
    const code = typeof body?.code === "string" ? body.code.toUpperCase() : "";
    const expectedCapabilityVersion = Number(body?.expectedCapabilityVersion);
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new ValidationError("Room code is invalid.");
    if (!Number.isSafeInteger(expectedCapabilityVersion) || expectedCapabilityVersion < 1) {
      throw new ValidationError("Match controller version is invalid.");
    }
    const { env } = await import("cloudflare:workers");
    if (!env.MATCHES) throw new ServiceUnavailableError("Match recovery is temporarily unavailable.");
    const response = await env.MATCHES.getByName(code).fetch(`https://match.internal/resume?code=${code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        expectedCapabilityVersion,
        takeover: body?.takeover === true,
      }),
    });
    const result = await response.json().catch(() => ({
      error: "Match recovery returned an invalid response.",
      code: "SERVICE_UNAVAILABLE",
    })) as Record<string, unknown>;
    return Response.json({ ...result, correlationId }, {
      status: response.status,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "The match could not be resumed.", {
      route: "/api/game/resume",
      method: "POST",
    });
  }
}
