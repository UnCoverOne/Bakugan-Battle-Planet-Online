import { getDatabase } from "../../../lib/account-server";
import { loadAchievementDefinitions } from "../../../lib/achievement-configuration-server";
import { loadAchievementRewardAssignments } from "../../../lib/achievement-rewards-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const achievements = await loadAchievementDefinitions(db);
    const activeAchievementIds = new Set(achievements.map((item) => item.id));
    return Response.json(
      {
        achievements,
        assignments: await loadAchievementRewardAssignments(db, activeAchievementIds),
        correlationId,
      },
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
