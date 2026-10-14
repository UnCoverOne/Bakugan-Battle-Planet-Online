import { getDatabase } from "../../../lib/account-server";
import { loadBakuganRollingOverrides, loadCardOverrides } from "../../../lib/administration-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const [overrides, rollingOverrides] = await Promise.all([
      loadCardOverrides(db),
      loadBakuganRollingOverrides(db),
    ]);
    return Response.json({ overrides, rollingOverrides, correlationId }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Card updates are unavailable.", {
      route: "/api/card-overrides",
      method: "GET",
    });
  }
}
