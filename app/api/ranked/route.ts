import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { getActiveRankedRuleset, rankedLeaderboard, rankedProfile } from "../../../lib/ranked-server";
import { enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `ranked-read:${requestClientKey(request)}`, 180, 60_000);
    if (url.searchParams.get("action") === "rules") {
      return json({ ruleset: await getActiveRankedRuleset(db), correlationId });
    }
    if (url.searchParams.get("action") === "profile") {
      const profile = await rankedProfile(db, String(url.searchParams.get("userId") ?? "").slice(0, 100));
      return profile ? json({ profile, correlationId }) : json({ error: "Brawler profile not found.", correlationId }, 404);
    }
    const viewer = await getSessionUser(request);
    const leaderboard = await rankedLeaderboard(db, {
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 25),
      search: String(url.searchParams.get("search") ?? ""),
      viewer,
    });
    return json({ ...leaderboard, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Ranked data is unavailable.", { route: "/api/ranked", method: "GET" });
  }
}
