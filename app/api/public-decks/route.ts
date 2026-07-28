import { getDatabase } from "../../../lib/account-server";
import { listPublicDecks } from "../../../lib/administration-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ decks: await listPublicDecks(await getDatabase()) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Public decks are unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
