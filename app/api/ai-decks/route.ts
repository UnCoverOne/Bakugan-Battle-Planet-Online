import { getDatabase } from "../../../lib/account-server";
import { selectEnabledLegalAiDeck } from "../../../lib/administration-server";
import { ServiceUnavailableError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const database = await getDatabase();
    const selected = await selectEnabledLegalAiDeck(database);
    if (!selected) throw new ServiceUnavailableError("No enabled legal Training AI deck is available.");
    return Response.json({
      deck: selected.deck,
      resourceId: selected.resourceId,
      configurationRevision: selected.configurationRevision,
      correlationId,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "No AI deck is available.", {
      route: "/api/ai-decks",
      method: "GET",
    });
  }
}
