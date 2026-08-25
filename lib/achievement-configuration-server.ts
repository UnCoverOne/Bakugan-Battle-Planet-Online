import {
  ACHIEVEMENT_DEFINITIONS,
  normalizeAchievementDefinitions,
  type AchievementDefinition,
} from "./achievements";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";

const RESOURCE_TYPE = "achievement-definitions";
const RESOURCE_ID = "catalogue";

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function loadAchievementDefinitions(
  db: AccountDatabase,
): Promise<AchievementDefinition[]> {
  await ensureAdministrationSchema(db);
  const row = await db.prepare(
    "SELECT data_json, enabled FROM admin_resources WHERE resource_type = ? AND resource_id = ?",
  ).bind(RESOURCE_TYPE, RESOURCE_ID).first<{ data_json: string; enabled: number }>();
  if (!row?.enabled) return normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);
  return normalizeAchievementDefinitions(parseJson(row.data_json));
}

export async function saveAchievementDefinitions(
  db: AccountDatabase,
  value: unknown,
  administratorId: string,
): Promise<AchievementDefinition[]> {
  await ensureAdministrationSchema(db);
  const definitions = normalizeAchievementDefinitions(value);
  await db.prepare(
    "INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET data_json = excluded.data_json, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  ).bind(
    RESOURCE_TYPE,
    RESOURCE_ID,
    JSON.stringify(definitions),
    administratorId,
    Date.now(),
  ).run();
  return definitions;
}
