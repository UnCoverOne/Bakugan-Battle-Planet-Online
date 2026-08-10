import { getDatabase } from "../../../lib/account-server";
import { applyDatabaseCardOverrides, listAiDecks } from "../../../lib/administration-server";
import { validateDeck } from "../../../lib/data";
import { ServiceUnavailableError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const database = await getDatabase();
    await applyDatabaseCardOverrides(database);
    const candidates = (await listAiDecks(database)).filter((item) => item.enabled && validateDeck(item.deck).isLegal);
    if (!candidates.length) throw new ServiceUnavailableError("No enabled AI deck is available.");
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const deck = candidates[bytes[0] % candidates.length].deck;
    return Response.json({ deck, correlationId }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "No AI deck is available.", {
      route: "/api/ai-decks",
      method: "GET",
    });
  }
}
