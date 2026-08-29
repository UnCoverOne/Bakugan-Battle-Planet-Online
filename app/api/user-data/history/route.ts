import { getDatabase, getSessionUser } from "../../../../lib/account-server";
import {
  loadAccountMatchHistory,
  saveAccountMatchRecord,
} from "../../../../lib/account-data-server";
import {
  assertSameOrigin,
  enforceD1RateLimit,
  requestClientKey,
} from "../../../../lib/request-security";
import {
  AuthenticationError,
  ValidationError,
  serverErrorResponse,
} from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

const MAX_HISTORY_REQUEST_BYTES = 1_000_000;

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

async function readHistoryRequest(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_HISTORY_REQUEST_BYTES) {
    throw new ValidationError("Match record is too large.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_HISTORY_REQUEST_BYTES) {
    throw new ValidationError("Match record is too large.");
  }
  try {
    const body = JSON.parse(raw) as { record?: unknown };
    if (!body || typeof body !== "object" || !("record" in body)) {
      throw new ValidationError("Match record is required.");
    }
    return body.record;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Match record is not valid JSON.");
  }
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const history = await loadAccountMatchHistory(await getDatabase(), user.id);
    return json({ history, correlationId });
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Could not load match history.",
      { route: "/api/user-data/history", method: "GET" },
    );
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const db = await getDatabase();
    await enforceD1RateLimit(
      db,
      `match-history:${user.id}:${requestClientKey(request)}`,
      60,
      60_000,
    );
    const record = await saveAccountMatchRecord(
      db,
      user.id,
      await readHistoryRequest(request),
    );
    return json({ record, correlationId });
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Could not save match record.",
      { route: "/api/user-data/history", method: "POST" },
    );
  }
}
