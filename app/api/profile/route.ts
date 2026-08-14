import { getDatabase } from "../../../lib/account-server";
import { publicBrawlerProfile } from "../../../lib/public-profile-server";
import { enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });

export async function GET(request: Request) {
  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const userId = String(url.searchParams.get("userId") ?? "").slice(0, 100);
    if (!userId) {
      return json({ error: "Choose a Brawler profile.", correlationId }, 400);
    }
    const db = await getDatabase();
    await enforceD1RateLimit(
      db,
      `profile-read:${requestClientKey(request)}`,
      180,
      60_000,
    );
    const profile = await publicBrawlerProfile(db, userId);
    return profile
      ? json({ profile, correlationId })
      : json({ error: "Brawler profile not found.", correlationId }, 404);
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Brawler profile is unavailable.",
      { route: "/api/profile", method: "GET" },
    );
  }
}
