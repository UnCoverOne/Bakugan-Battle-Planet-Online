import {
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  normalizeAchievementRewardAssignments,
  type AchievementRewardAssignments,
} from "./achievement-rewards";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";

const RESOURCE_TYPE = "achievement-rewards";
const RESOURCE_ID = "profile-customization";

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function loadAchievementRewardAssignments(
  db: AccountDatabase,
  allowedAchievementIds?: ReadonlySet<string>,
): Promise<AchievementRewardAssignments> {
  await ensureAdministrationSchema(db);
  const row = await db.prepare(
    "SELECT data_json, enabled FROM admin_resources WHERE resource_type = ? AND resource_id = ?",
  ).bind(RESOURCE_TYPE, RESOURCE_ID).first<{ data_json: string; enabled: number }>();
  if (!row?.enabled) {
    return normalizeAchievementRewardAssignments(
      DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
      allowedAchievementIds,
    );
  }
  return normalizeAchievementRewardAssignments(parseJson(row.data_json), allowedAchievementIds);
}

export async function saveAchievementRewardAssignments(
  db: AccountDatabase,
  value: unknown,
  administratorId: string,
  allowedAchievementIds?: ReadonlySet<string>,
): Promise<AchievementRewardAssignments> {
  await ensureAdministrationSchema(db);
  const assignments = normalizeAchievementRewardAssignments(value, allowedAchievementIds);
  await db.prepare(
    "INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET data_json = excluded.data_json, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  ).bind(
    RESOURCE_TYPE,
    RESOURCE_ID,
    JSON.stringify(assignments),
    administratorId,
    Date.now(),
  ).run();
  return assignments;
}
