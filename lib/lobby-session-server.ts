import { LOBBY_MEMBERSHIP_TTL_MS, type LobbyConfiguration, type LobbyIdentity, type LobbyMembership, type LobbyMode, type LobbySession } from "./lobby-session";

// Internal service: callers MUST derive identity from authenticated account or
// verified guest credentials, never from a request body's claimed player ID.
// The injected clock/IDs are for deterministic tests; production uses server time.
type Row = { id: string; code: string; mode: LobbyMode; configuration_json: string; version: number; created_at: number; closed_at: number | null; current_series_id: string | null; previous_series_id: string | null };
type MemberRow = { id: string; lobby_id: string; joined_at: number; last_seen_at: number; expires_at: number };
function identityKey(identity: LobbyIdentity) {
  if (!identity.id || !["account", "guest"].includes(identity.kind)) throw new Error("Authenticated lobby identity required.");
  return `${identity.kind}:${identity.id}`;
}
function member(row: MemberRow): LobbyMembership {
  return { id: row.id, lobbyId: row.lobby_id, joinedAt: row.joined_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at };
}
export function createLobbySessionService(database: D1Database, clock = Date.now, newId: () => string = () => crypto.randomUUID()) {
  const now = () => clock();
  const expire = async () => {
    const at = now();
    const result = await database.prepare(`UPDATE lobby_memberships SET left_at = ?, departure_reason = 'expired'
      WHERE left_at IS NULL AND expires_at <= ?`).bind(at, at).run();
    return Number(result.meta?.changes ?? 0);
  };
  // A scoped membership heartbeat cannot resurrect an expired or departed seat.
  const heartbeat = async (identity: LobbyIdentity, membershipId: string) => {
    const at = now();
    const result = await database.prepare(`UPDATE lobby_memberships SET last_seen_at = ?, expires_at = ?
      WHERE id = ? AND identity_key = ? AND left_at IS NULL AND expires_at > ? AND last_seen_at <= ?`)
      .bind(at, at + LOBBY_MEMBERSHIP_TTL_MS, membershipId, identityKey(identity), at, at).run();
    return Number(result.meta?.changes ?? 0) === 1;
  };
  const activeMembership = async (identity: LobbyIdentity) => {
    await expire();
    const row = await database.prepare(`SELECT id, lobby_id, joined_at, last_seen_at, expires_at
      FROM lobby_memberships WHERE identity_key = ? AND left_at IS NULL`).bind(identityKey(identity)).first<MemberRow>();
    return row ? member(row) : null;
  };
  const read = async (identity: LobbyIdentity): Promise<LobbySession | null> => {
    await expire();
    // A single statement gives a consistent view of membership and its lobby.
    const row = await database.prepare(`SELECT s.*, (SELECT json_group_array(json_object(
      'id', m.id, 'lobby_id', m.lobby_id, 'joined_at', m.joined_at, 'last_seen_at', m.last_seen_at, 'expires_at', m.expires_at))
      FROM (SELECT * FROM lobby_memberships WHERE lobby_id = s.id AND left_at IS NULL ORDER BY sequence) m) AS members_json
      FROM lobby_sessions s JOIN lobby_memberships own ON own.lobby_id = s.id
      WHERE own.identity_key = ? AND own.left_at IS NULL AND s.closed_at IS NULL`)
      .bind(identityKey(identity)).first<Row & { members_json: string }>();
    if (!row) return null;
    const members = (JSON.parse(row.members_json) as MemberRow[]).map(member);
    return { id: row.id, code: row.code, mode: row.mode, configuration: JSON.parse(row.configuration_json) as LobbyConfiguration,
      version: row.version, createdAt: row.created_at, closedAt: row.closed_at, currentSeriesId: row.current_series_id,
      previousSeriesId: row.previous_series_id, hostMemberId: members[0]?.id ?? null, members };
  };
  const insertMember = (lobbyId: string, identity: LobbyIdentity, id: string, at: number) => database.prepare(`INSERT INTO lobby_memberships
    (id, lobby_id, identity_key, joined_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, lobbyId, identityKey(identity), at, at, at + LOBBY_MEMBERSHIP_TTL_MS);
  const create = async (identity: LobbyIdentity, mode: LobbyMode, code: string, configuration: LobbyConfiguration) => {
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error("Invalid room code.");
    if (mode === "ranked" && (configuration.structure !== "bo3" || configuration.format !== "competitive")) throw new Error("Invalid Ranked configuration.");
    if (mode !== "ranked" && configuration.format === "competitive") throw new Error("Competitive format requires Ranked.");
    await expire();
    const at = now(), id = newId(), membershipId = newId();
    // D1 batches are transactional: admission or uniqueness failure rolls back the room.
    await database.batch([
      database.prepare(`INSERT INTO lobby_sessions (id, code, mode, configuration_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, code, mode, JSON.stringify(configuration), at),
      insertMember(id, identity, membershipId, at),
    ]);
    return { lobbyId: id, membershipId };
  };
  const join = async (identity: LobbyIdentity, lobbyId: string) => {
    await expire();
    const at = now(), membershipId = newId();
    // The trigger and unique partial index enforce admission in the write itself.
    await insertMember(lobbyId, identity, membershipId, at).run();
    return { lobbyId, membershipId };
  };
  const leave = async (identity: LobbyIdentity, membershipId: string) => {
    const at = now();
    // Active series departure must be coordinated with game settlement. Until
    // that integration is implemented, reject rather than silently abandon it.
    const result = await database.prepare(`UPDATE lobby_memberships SET left_at = ?, departure_reason = 'left'
      WHERE id = ? AND identity_key = ? AND left_at IS NULL AND expires_at > ? AND EXISTS (
        SELECT 1 FROM lobby_sessions WHERE id = lobby_memberships.lobby_id AND current_series_id IS NULL
      )`).bind(at, membershipId, identityKey(identity), at).run();
    return Number(result.meta?.changes ?? 0) === 1;
  };
  return { create, join, read, activeMembership, heartbeat, leave, expire };
}
