import { getDatabase } from "../../../lib/account-server";
import {
  applyDatabaseCardOverrides,
  listAiDecks,
} from "../../../lib/administration-server";
import { selectAiDeckForMeta } from "../../../lib/ai-meta-selection";
import { validateDeck } from "../../../lib/data";
import { DEFAULT_META, isLobbyMeta } from "../../../lib/meta-formats";
import { ServiceUnavailableError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const database = await getDatabase();
    await applyDatabaseCardOverrides(database);
    const requestedMeta = new URL(request.url).searchParams.get("meta");
    const meta = isLobbyMeta(requestedMeta) ? requestedMeta : DEFAULT_META;
    const enabledLegal = (await listAiDecks(database)).filter((item) => (
      item.enabled
      && (item.deck.format ?? "standard") === "standard"
      && validateDeck(item.deck).isLegal
    ));
    const selectedDeck = selectAiDeckForMeta(enabledLegal.map((item) => item.deck), meta);
    if (!selectedDeck) throw new ServiceUnavailableError("No enabled legal Standard Training AI deck is available for this meta.");
    const selected = enabledLegal.find((item) => item.deck.id === selectedDeck.id) ?? enabledLegal[0];
    return Response.json({
      deck: selectedDeck,
      availableDecks: enabledLegal.map((item) => item.deck),
      resourceId: selected.id,
      configurationRevision: selected.updatedAt,
      meta,
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
