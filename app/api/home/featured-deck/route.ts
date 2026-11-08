import { getDatabase } from "../../../../lib/account-server";
import { listManagedPublicDecks } from "../../../../lib/administration-server";
import { validateDeck } from "../../../../lib/data";
import { latestLegalStandardCommunityDeck } from "../../../../lib/home-dashboard";
import { serverErrorResponse } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

// Public, non-personalized summary; never send full decks or card catalogue to Home.
export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const published = await listManagedPublicDecks(db);
    const deck = latestLegalStandardCommunityDeck(
      published,
      (candidate) => validateDeck(candidate).isLegal,
    );
    return Response.json(
      { deck },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Featured deck is unavailable.", {
      route: "/api/home/featured-deck",
      method: "GET",
    });
  }
}
