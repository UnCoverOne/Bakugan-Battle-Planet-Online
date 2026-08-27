import {
  ACHIEVEMENT_DEFINITIONS,
  normalizeAchievementDefinitions,
  type AchievementDefinition,
} from "./achievements";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";

const RESOURCE_TYPE = "achievement-definitions";
const RESOURCE_ID = "catalogue";
export const ACHIEVEMENT_CATALOGUE_VERSION = 1;

type AchievementCataloguePayload = {
  version: number;
  definitions: unknown;
};

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function currentPayload(value: unknown): AchievementCataloguePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== ACHIEVEMENT_CATALOGUE_VERSION || !Array.isArray(payload.definitions)) return null;
  return {
    version: ACHIEVEMENT_CATALOGUE_VERSION,
    definitions: payload.definitions,
  };
}

export async function loadAchievementDefinitions(
  db: AccountDatabase,
): Promise<AchievementDefinition[]> {
  await ensureAdministrationSchema(db);
  const row = await db.prepare(
    "SELECT data_json, enabled FROM admin_resources WHERE resource_type = ? AND resource_id = ?",
  ).bind(RESOURCE_TYPE, RESOURCE_ID).first<{ data_json: string; enabled: number }>();
  if (!row?.enabled) return normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);

  const payload = currentPayload(parseJson(row.data_json));
  return payload
    ? normalizeAchievementDefinitions(payload.definitions)
    : normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);
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
    JSON.stringify({ version: ACHIEVEMENT_CATALOGUE_VERSION, definitions }),
    administratorId,
    Date.now(),
  ).run();
  return definitions;
}
