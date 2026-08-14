import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { listManagedPublicDecks, listOfflinePublicDeckSlots } from "../../../lib/administration-server";
import {
  listPublicDeckFavoriteMetadata,
  setPublicDeckFavorite,
} from "../../../lib/public-deck-favorites-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { AuthenticationError, ValidationError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const [managedDecks, offlineSlots, viewer] = await Promise.all([
      listManagedPublicDecks(db),
      listOfflinePublicDeckSlots(db),
      getSessionUser(request),
    ]);
    const decks = managedDecks.map((item) => ({
      ...item.deck,
      creatorUserId: item.source.kind === "user" ? item.source.userId : undefined,
    }));
    const [favorites] = await Promise.all([
      listPublicDeckFavoriteMetadata(db, decks.map((deck) => deck.id), viewer?.id),
    ]);
    const offlineFallbackDecks = offlineSlots.flatMap((slot) => slot.deck ? [slot.deck] : []);
    const offlineFallbackRevision = offlineSlots.reduce((latest, slot) => Math.max(latest, slot.updatedAt), 0);
    return json({
      decks,
      favorites,
      offlineFallbackDecks,
      offlineFallbackRevision,
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Public decks are unavailable.", {
      route: "/api/public-decks",
      method: "GET",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const viewer = await getSessionUser(request);
    if (!viewer) throw new AuthenticationError("Sign in to favorite Public decks.");
    const db = await getDatabase();
    await enforceD1RateLimit(
      db,
      `public-deck-favorite:${viewer.id}:${requestClientKey(request)}`,
      60,
      60_000,
    );
    const body = await request.json() as { action?: unknown; deckId?: unknown };
    const action = String(body.action ?? "");
    if (action !== "favorite" && action !== "unfavorite") {
      throw new ValidationError("Favorite action is invalid.");
    }
    const favorite = await setPublicDeckFavorite(
      db,
      viewer.id,
      String(body.deckId ?? ""),
      action === "favorite",
    );
    return json({ favorite, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "The Public deck favorite could not be changed.", {
      route: "/api/public-decks",
      method: "POST",
    });
  }
}
