import { persistInitialMatch, persistTransition, type PersistedSeat } from "./engine/event-store";
import { reduceMatch } from "./engine/reducer";
import { normalizeEngineState } from "./engine/events";
import type { CommandEnvelope, EngineBackedMatchState, ReduceResult } from "./engine/types";
import { ensureMatchSessionSchema } from "./match-session-schema";
import { ensureReplayArchiveSchema, archiveCompletedMatch } from "./replay-archive-server";
import { digestMatchCapability, secureMatchCapability } from "./match-seat-auth";
import { settleCompletedRankedState, persistRankedSettlementSnapshot } from "./ranked-match-settlement";
import { isCompletedSeriesResult } from "./match-result-navigation";
import type { LobbyIdentity, LobbyDeparture } from "./lobby-session";
import { ConflictError } from "./server-errors";

export type ManagedSeriesBinding = { id: string; lobby_id: string; match_code: string; status: "initializing" | "active" | "completed"; start_command_id: string };
export type ManagedSeat = PersistedSeat & { membershipId: string };
const key = (identity: LobbyIdentity) => `${identity.kind}:${identity.id}`;

export async function managedSeriesForCode(database: D1Database, code: string) {
  // Legacy installations can run before the additive migrations are applied.
  const table = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lobby_series_bindings'").first();
  if (!table) return null;
  return database.prepare("SELECT id, lobby_id, match_code, status, start_command_id FROM lobby_series_bindings WHERE match_code = ?")
    .bind(code).first<ManagedSeriesBinding>();
}

/** Internal only: prepared state must be produced by canonical deck validation,
 * readiness checks and engine initialization, never received from a browser.
 * A separate transport key per series isolates engine events/replay archives. */
export async function persistManagedSeries(database: D1Database, input: {
  lobbyId: string; expectedLobbyVersion: number; hostMemberId: string; hostIdentity: LobbyIdentity;
  startCommandId: string; initialized: ReduceResult; seats: readonly ManagedSeat[];
}) {
  const { state, receipt, events } = input.initialized;
  if (!receipt || !input.initialized.changed || input.seats.length !== 2 ||
      new Set(input.seats.map(seat => seat.membershipId)).size !== 2 ||
      new Set(input.seats.map(seat => seat.playerId)).size !== 2 ||
      !input.seats.every(seat => state.players.some(player => player.id === seat.playerId))) {
    throw new ConflictError("Invalid prepared series.");
  }
  const lookup = () => database.prepare("SELECT id, lobby_id, match_code, status, start_command_id FROM lobby_series_bindings WHERE lobby_id = ? AND start_command_id = ? AND host_member_id = ? AND host_identity_key = ?")
    .bind(input.lobbyId, input.startCommandId, input.hostMemberId, key(input.hostIdentity)).first<ManagedSeriesBinding>();
  const existing = await lookup();
  if (existing) return existing; // caller must recover credentials, not return newly generated ones
  await ensureMatchSessionSchema(database);
  await ensureReplayArchiveSchema(database);
  const statements = [
    database.prepare(`INSERT INTO lobby_series_bindings
      (id,lobby_id,match_code,start_command_id,host_member_id,host_identity_key,expected_lobby_version,status,created_at)
      VALUES (?,?,?,?,?,?,?,'initializing',?)`)
      .bind(state.id, input.lobbyId, state.code, input.startCommandId, input.hostMemberId, key(input.hostIdentity), input.expectedLobbyVersion, receipt.issuedAt),
    ...input.seats.flatMap(seat => [
      database.prepare("INSERT INTO lobby_series_seats (series_id,membership_id,player_id) VALUES (?,?,?)")
        .bind(state.id, seat.membershipId, seat.playerId),
      database.prepare(`INSERT INTO match_seat_accounts (code,player_id,user_id,created_at)
        SELECT ?, ?, substr(identity_key,9), ? FROM lobby_memberships
        WHERE id = ? AND substr(identity_key,1,8) = 'account:'`)
        .bind(state.code, seat.playerId, receipt.issuedAt, seat.membershipId),
      database.prepare("INSERT INTO match_presence (code,player_id,last_seen,connected) VALUES (?,?,?,1)")
        .bind(state.code, seat.playerId, receipt.issuedAt),
    ]),
    database.prepare("UPDATE lobby_series_bindings SET status = 'active' WHERE id = ? AND status = 'initializing'").bind(state.id),
  ];
  try {
    await persistInitialMatch(database, state, events, receipt, undefined, { seats: input.seats, statements });
  } catch (error) {
    const duplicate = await lookup();
    if (duplicate) return duplicate;
    throw error;
  }
  const saved = await lookup();
  if (!saved) throw new ConflictError("Series initialization was not committed.");
  return saved;
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

async function loadState(database: D1Database, code: string) {
  const row = await database.prepare("SELECT state_json FROM matches WHERE code = ?").bind(code).first<{ state_json: string }>();
  if (!row) throw new ConflictError("Managed series snapshot is missing.");
  return normalizeEngineState(JSON.parse(row.state_json));
}

/** Idempotent completion: existing BP and archive routines are keyed by the
 * engine series ID. A failure before the final D1 update leaves the series
 * attached for retry, not an apparently empty lobby. */
export async function finalizeManagedSeries(database: D1Database, code: string, now = Date.now()) {
  const binding = await managedSeriesForCode(database, code);
  if (!binding || binding.status !== "active") return false;
  const state = await loadState(database, code);
  if (state.id !== binding.id || !isCompletedSeriesResult(state)) return false;
  if (await settleCompletedRankedState(database, state)) await persistRankedSettlementSnapshot(database, state);
  if (!await archiveCompletedMatch(database, state)) throw new ConflictError("Series archive is not complete.");
  const result = await database.prepare(`UPDATE lobby_series_bindings SET status = 'completed', completed_at = ?, final_version = ?
    WHERE id = ? AND status = 'active'`).bind(now, state.version, binding.id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

/** Authenticated explicit departure or trusted server expiry. Record intent
 * before resolving gameplay. A stale membership ID cannot affect a new series.
 * The room coordinator must serialize calls with gameplay and publish results. */
export async function requestManagedDeparture(database: D1Database, input:
  { code: string; membershipId: string; reason: "left"; identity: LobbyIdentity } |
  { code: string; membershipId: string; reason: "expired" }, now = Date.now()) {
  const binding = await managedSeriesForCode(database, input.code);
  if (!binding || binding.status !== "active") return false;
  const predicate = input.reason === "left" ? "m.identity_key = ? AND m.expires_at > ?" : "m.expires_at <= ?";
  const args = input.reason === "left" ? [key(input.identity), now] : [now];
  const result = await database.prepare(`INSERT OR IGNORE INTO lobby_series_departures (series_id,membership_id,reason,requested_at)
    SELECT s.series_id,m.id,?,? FROM lobby_series_seats s JOIN lobby_memberships m ON m.id = s.membership_id
    JOIN lobby_sessions l ON l.id = m.lobby_id
    WHERE s.series_id = ? AND m.id = ? AND m.left_at IS NULL AND l.current_series_id = s.series_id AND ${predicate}`)
    .bind(input.reason, now, binding.id, input.membershipId, ...args).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function resolveManagedDepartures(database: D1Database, code: string) {
  const binding = await managedSeriesForCode(database, code);
  if (!binding || binding.status !== "active") return null;
  // First accepted intent determines the forfeiting side. Additional pending
  // departures are released together only after settlement.
  const departure = await database.prepare(`SELECT d.membership_id,d.reason,d.requested_at,s.player_id
    FROM lobby_series_departures d JOIN lobby_series_seats s ON s.series_id = d.series_id AND s.membership_id = d.membership_id
    WHERE d.series_id = ? ORDER BY d.requested_at,d.membership_id LIMIT 1`)
    .bind(binding.id).first<{ membership_id: string; reason: LobbyDeparture; requested_at: number; player_id: string }>();
  if (!departure) return null;
  const state = await loadState(database, code);
  if (state.id !== binding.id) throw new ConflictError("Series identity changed.");
  if (!isCompletedSeriesResult(state)) {
    const commandId = `lobby-forfeit:${departure.membership_id}:${binding.id}`;
    const command: CommandEnvelope["command"] = { type: "FORFEIT_SERIES", playerId: departure.player_id, reason: departure.reason };
    const envelope: CommandEnvelope = { commandId, gameId: state.id, actorId: "system", expectedVersion: state.version,
      issuedAt: departure.requested_at, randomSeed: secureMatchCapability(32), requestHash: await digestMatchCapability(JSON.stringify(command)), command };
    const result = reduceMatch(state, envelope);
    if (!result.receipt || !isCompletedSeriesResult(result.state)) throw new ConflictError("Series forfeiture did not reach a terminal result.");
    if (!await persistTransition(database, { code, next: result.state, previous: state, expectedVersion: state.version,
      events: result.events, receipt: result.receipt })) throw new ConflictError("Series changed; retry departure resolution.");
  }
  await finalizeManagedSeries(database, code);
  return loadState(database, code);
}
