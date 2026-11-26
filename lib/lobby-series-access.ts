import type { MatchState } from "./game";
import { LOBBY_DISCONNECTED_AFTER_MS } from "./lobby-session";

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


/** Managed game presence is application-wide. A match WebSocket closing
 * because the player visits Decks/Compendium must not start a disconnect
 * forfeit timer. Use the authoritative lobby heartbeat instead. */
export async function hydrateManagedPresence(database: D1Database, state: MatchState, now = Date.now()) {
  const binding = await managedSeriesForCode(database, state.code);
  if (!binding) return false;
  const rows = await database.prepare(`SELECT s.player_id, m.last_seen_at, m.expires_at, m.left_at,
    EXISTS (SELECT 1 FROM lobby_series_departures d WHERE d.series_id = s.series_id AND d.membership_id = m.id) AS departing
    FROM lobby_series_seats s JOIN lobby_memberships m ON m.id = s.membership_id WHERE s.series_id = ?`)
    .bind(binding.id).all<{ player_id: string; last_seen_at: number; expires_at: number; left_at: number | null; departing: number }>();
  const byPlayer = new Map((rows.results ?? []).map(row => [row.player_id, row]));
  for (const player of state.players) {
    const row = byPlayer.get(player.id);
    player.connected = Boolean(row && binding.status === "active" && row.left_at == null && !row.departing &&
      row.expires_at > now && now - row.last_seen_at < LOBBY_DISCONNECTED_AFTER_MS);
    if (row) player.lastSeen = row.last_seen_at;
  }
  return true;
}
