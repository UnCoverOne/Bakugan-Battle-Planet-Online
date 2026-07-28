import { getDatabase } from "../../../lib/account-server";
import { loadCardOverrides } from "../../../lib/administration-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overrides = await loadCardOverrides(await getDatabase());
    return Response.json({ overrides }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { overrides: [], error: error instanceof Error ? error.message : "Card updates are unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
