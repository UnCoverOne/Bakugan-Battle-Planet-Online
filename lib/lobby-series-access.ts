export type ManagedSeriesBinding = { id: string; lobby_id: string; match_code: string; status: "initializing" | "active" | "completed"; start_command_id: string };

export async function managedSeriesForCode(database: D1Database, code: string) {
  // Legacy installations can run before the additive migrations are applied.
  const table = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lobby_series_bindings'").first();
  if (!table) return null;
  return database.prepare("SELECT id, lobby_id, match_code, status, start_command_id FROM lobby_series_bindings WHERE match_code = ?")
    .bind(code).first<ManagedSeriesBinding>();
}

/** Managed credentials cannot outlive their membership or series. Legacy
 * seats retain their existing capability policy until migrated. */
export async function managedSeatAllowed(database: D1Database, code: string, playerId: string, now = Date.now()) {
  const binding = await managedSeriesForCode(database, code);
  if (!binding) return true;
  if (binding.status !== "active") return false;
  const row = await database.prepare(`SELECT 1 AS allowed FROM lobby_series_seats s
    JOIN lobby_memberships m ON m.id = s.membership_id JOIN lobby_sessions l ON l.id = m.lobby_id
    WHERE s.series_id = ? AND s.player_id = ? AND m.left_at IS NULL AND m.expires_at > ?
      AND l.current_series_id = s.series_id AND NOT EXISTS (
        SELECT 1 FROM lobby_series_departures d WHERE d.series_id = s.series_id AND d.membership_id = m.id)`)
    .bind(binding.id, playerId, now).first();
  return Boolean(row);
}

