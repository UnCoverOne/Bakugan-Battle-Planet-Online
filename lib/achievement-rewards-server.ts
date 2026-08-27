import {
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  normalizeAchievementRewardAssignments,
  type AchievementRewardAssignments,
} from "./achievement-rewards";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";

const RESOURCE_TYPE = "achievement-rewards";
const RESOURCE_ID = "profile-customization";
export const ACHIEVEMENT_REWARD_CATALOGUE_VERSION = 1;

type RewardCataloguePayload = {
  version: number;
  assignments: unknown;
};

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function currentPayload(value: unknown): RewardCataloguePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== ACHIEVEMENT_REWARD_CATALOGUE_VERSION) return null;
  if (!payload.assignments || typeof payload.assignments !== "object" || Array.isArray(payload.assignments)) return null;
  return {
    version: ACHIEVEMENT_REWARD_CATALOGUE_VERSION,
    assignments: payload.assignments,
  };
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

  const payload = currentPayload(parseJson(row.data_json));
  return normalizeAchievementRewardAssignments(
    payload?.assignments ?? DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
    allowedAchievementIds,
  );
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
    JSON.stringify({ version: ACHIEVEMENT_REWARD_CATALOGUE_VERSION, assignments }),
    administratorId,
    Date.now(),
  ).run();
  return assignments;
}
