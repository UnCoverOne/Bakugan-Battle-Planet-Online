import { getDatabase } from "../../../lib/account-server";
import { listPublicDecks } from "../../../lib/administration-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    return Response.json({
      decks: await listPublicDecks(await getDatabase()),
      correlationId,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Public decks are unavailable.", {
      route: "/api/public-decks",
      method: "GET",
    });
  }
}
