import { getDatabase } from "../../../lib/account-server";
import { listOfflinePublicDeckSlots, listPublicDecks } from "../../../lib/administration-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const [decks, offlineSlots] = await Promise.all([
      listPublicDecks(db),
      listOfflinePublicDeckSlots(db),
    ]);
    const offlineFallbackDecks = offlineSlots.flatMap((slot) => slot.deck ? [slot.deck] : []);
    const offlineFallbackRevision = offlineSlots.reduce((latest, slot) => Math.max(latest, slot.updatedAt), 0);
    return Response.json({
      decks,
      offlineFallbackDecks,
      offlineFallbackRevision,
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
