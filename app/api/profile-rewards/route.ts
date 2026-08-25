import { getDatabase } from "../../../lib/account-server";
import { loadAchievementRewardAssignments } from "../../../lib/achievement-rewards-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    return Response.json(
      { assignments: await loadAchievementRewardAssignments(db), correlationId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Profile rewards are unavailable.",
      { route: "/api/profile-rewards", method: "GET" },
    );
  }
}
