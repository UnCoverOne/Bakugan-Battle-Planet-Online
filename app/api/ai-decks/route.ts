import { getDatabase } from "../../../lib/account-server";
import { randomAiDeck } from "../../../lib/administration-server";
import { ServiceUnavailableError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const deck = await randomAiDeck(await getDatabase());
    if (!deck) throw new ServiceUnavailableError("No AI deck is available.");
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
