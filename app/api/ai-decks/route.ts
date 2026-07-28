import { getDatabase } from "../../../lib/account-server";
import { randomAiDeck } from "../../../lib/administration-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ deck: await randomAiDeck(await getDatabase()) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No AI deck is available." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
