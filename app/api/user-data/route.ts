import { getDatabase, getSessionUser } from "../../../lib/account-server";
import {
  MAX_SYNC_BYTES,
  loadAccountDataPayload,
  syncAccountData,
} from "../../../lib/account-data-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import {
  AuthenticationError,
  ValidationError,
  serverErrorResponse,
} from "../../../lib/server-errors";
import type { UserDataSyncRequest } from "../../../lib/user-data-entities";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

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

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    return json({ ...(await loadAccountDataPayload(await getDatabase(), user.id)), correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Could not load synced data.", { route: "/api/user-data", method: "GET" });
  }
}

export async function PUT(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const db = await getDatabase();
    await enforceD1RateLimit(db, `sync:${user.id}:${requestClientKey(request)}`, 30, 60_000);
    const raw = await readBoundedText(request, MAX_SYNC_BYTES);
    let body: Partial<UserDataSyncRequest>;
    try {
      body = JSON.parse(raw) as Partial<UserDataSyncRequest>;
    } catch {
      throw new ValidationError("Sync batch is not valid JSON.");
    }
    const result = await syncAccountData(db, user.id, body);
    if (result.conflicts.length) {
      return json({
        ...result,
        error: "Cloud entities changed.",
        code: "CONFLICT_ERROR",
        correlationId,
      }, 409);
    }
    return json({ ...result, correlationId });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      console.error(JSON.stringify({ event: "sync_payload_too_large", correlationId }));
      return json({
        error: "This sync batch is too large. Smaller account entities will continue syncing independently.",
        code: "VALIDATION_ERROR",
        correlationId,
      }, 413);
    }
    return serverErrorResponse(error, correlationId, "Could not save synced data.", { route: "/api/user-data", method: "PUT" });
  }
}
