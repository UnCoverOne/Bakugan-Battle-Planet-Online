import {
  ensureAdministrationSchema,
  getDatabase,
  requireAdministrator,
} from "../../../../lib/account-server";
import {
  loadAchievementDefinitions,
  saveAchievementDefinitions,
} from "../../../../lib/achievement-configuration-server";
import {
  loadAchievementRewardAssignments,
  saveAchievementRewardAssignments,
} from "../../../../lib/achievement-rewards-server";
import {
  assertSameOrigin,
  enforceD1RateLimit,
  requestClientKey,
} from "../../../../lib/request-security";
import { serverErrorResponse, ValidationError } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";
const MAX_REWARD_BYTES = 100_000;
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    const achievements = await loadAchievementDefinitions(db);
    const activeAchievementIds = new Set(achievements.map((item) => item.id));
    return json({
      achievements,
      assignments: await loadAchievementRewardAssignments(db, activeAchievementIds),
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Achievements are unavailable.",
      { route: "/api/admin/achievement-rewards", method: "GET" },
    );
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    await enforceD1RateLimit(
      db,
      `admin-achievement-rewards:${administrator.id}:${requestClientKey(request)}`,
      60,
      60_000,
    );
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REWARD_BYTES) {
      return json({ error: "Achievement administration request is too large.", correlationId }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ValidationError("Achievement administration request is not valid JSON.");
    }
    const achievements = body.achievements === undefined
      ? await loadAchievementDefinitions(db)
      : await saveAchievementDefinitions(db, body.achievements, administrator.id);
    const activeAchievementIds = new Set(achievements.map((item) => item.id));
    const assignments = body.assignments === undefined
      ? await loadAchievementRewardAssignments(db, activeAchievementIds)
      : await saveAchievementRewardAssignments(
          db,
          body.assignments,
          administrator.id,
          activeAchievementIds,
        );
    return json({ achievements, assignments, correlationId });
  } catch (error) {
    return serverErrorResponse(
      error,
      correlationId,
      "Achievements could not be updated.",
      { route: "/api/admin/achievement-rewards", method: "POST" },
    );
  }
}
