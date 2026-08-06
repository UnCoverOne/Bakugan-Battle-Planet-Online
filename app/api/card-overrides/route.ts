import { getDatabase } from "../../../lib/account-server";
import { loadCardOverrides } from "../../../lib/administration-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const overrides = await loadCardOverrides(await getDatabase());
    return Response.json({ overrides, correlationId }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Card updates are unavailable.", {
      route: "/api/card-overrides",
      method: "GET",
    });
  }
}
