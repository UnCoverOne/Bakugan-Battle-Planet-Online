import { getDatabase, getSessionUser } from "../../../../lib/account-server";
import { loadAccountDataPayload } from "../../../../lib/account-data-server";
import {
  AuthenticationError,
  serverErrorResponse,
} from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const payload = await loadAccountDataPayload(await getDatabase(), user.id);
    return json({
      history: payload.data?.history ?? [],
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Could not load match history.",
      { route: "/api/user-data/history", method: "GET" },
    );
  }
}
