import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import { ensureAccountDataSchema } from "./account-data-server";
import type { MatchState } from "./game";
import { lobbyConfig } from "./lobby-config";
import { roomOwnerId } from "./lobby";
import { rankForBp } from "./ranked";
import { ensureReplayArchiveSchema } from "./replay-archive-server";
import { AuthorizationError, ConflictError, ValidationError } from "./server-errors";
import {
  SOCIAL_INVITE_TTL_MS,
  canonicalSocialPair,
  sortSocialAccounts,
  type ActiveSocialLobby,
  type LobbyInviteSummary,
  type LobbySystemMessage,
  type SocialAccountSummary,
  type SocialRelationship,
  type SocialSnapshot,
} from "./social";

type RelationshipRow = {
  user_low: string;
  user_high: string;
  requested_by: string;
  status: "pending" | "accepted";
};

type ProfileRow = {
  id: string;
  display_name: string;
  faction: string;
  profile_json: string | null;
  legacy_json: string | null;
  bp: number | null;
  wins: number | null;
  losses: number | null;
};

type InviteRow = {
  id: string;
  lobby_code: string;
  inviter_user_id: string;
  recipient_user_id: string;
  status: string;
  created_at: number;
  expires_at: number;
};

export async function ensureSocialVisibilitySchema(db: AccountDatabase) {
  await db.prepare("CREATE TABLE IF NOT EXISTS social_hidden_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, updated_at INTEGER NOT NULL)").run();
}

export async function ensureSocialSchema(db: AccountDatabase) {
  await ensureSocialVisibilitySchema(db);
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS social_relationships (user_low TEXT NOT NULL, user_high TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_low, user_high), CHECK (user_low < user_high), CHECK (requested_by = user_low OR requested_by = user_high), FOREIGN KEY (user_low) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (user_high) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS social_relationships_low_status_idx ON social_relationships(user_low, status, updated_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS social_relationships_high_status_idx ON social_relationships(user_high, status, updated_at DESC)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lobby_invitations (id TEXT PRIMARY KEY, lobby_code TEXT NOT NULL, inviter_user_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, responded_at INTEGER, CHECK (inviter_user_id <> recipient_user_id), FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS lobby_invitations_pending_pair_idx ON lobby_invitations(lobby_code, inviter_user_id, recipient_user_id) WHERE status = 'pending'"),
    db.prepare("CREATE INDEX IF NOT EXISTS lobby_invitations_recipient_idx ON lobby_invitations(recipient_user_id, status, expires_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS lobby_invitations_expiry_idx ON lobby_invitations(status, expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS social_lobby_events (id TEXT PRIMARY KEY, lobby_code TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS social_lobby_events_room_created_idx ON social_lobby_events(lobby_code, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS social_preferences (user_id TEXT PRIMARY KEY, presence_visibility TEXT NOT NULL DEFAULT 'online' CHECK (presence_visibility IN ('online', 'friends', 'offline')), allow_lobby_invites INTEGER NOT NULL DEFAULT 1 CHECK (allow_lobby_invites IN (0, 1)), updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
  ]);
}

function parsedObject(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function accountFromRow(row: ProfileRow): SocialAccountSummary {
  const current = parsedObject(row.profile_json);
  const legacy = parsedObject(row.legacy_json);
  const legacyProfile = legacy.profile && typeof legacy.profile === "object"
    ? legacy.profile as Record<string, unknown>
    : {};
  const profile = Object.keys(current).length ? current : legacyProfile;
  const bp = Number.isFinite(Number(row.bp)) ? Number(row.bp) : 1_000;
  const wins = Math.max(0, Number(row.wins ?? 0));
  const losses = Math.max(0, Number(row.losses ?? 0));
  const decided = wins + losses;
  return {
    userId: row.id,
    displayName: row.display_name,
    faction: row.faction,
    avatar: typeof profile.avatar === "string" ? profile.avatar : "",
    titleId: typeof profile.titleId === "string" ? profile.titleId : "battle-planet-brawler",
    rank: rankForBp(bp),
    bp,
    wins,
    losses,
    winRate: decided ? Math.round((wins / decided) * 1_000) / 10 : 0,
    online: false,
    relationship: "none",
  };
}

async function prepareProfileTables(db: AccountDatabase) {
  await Promise.all([
    ensureAdministrationSchema(db),
    ensureAccountDataSchema(db),
    ensureReplayArchiveSchema(db),
  ]);
}

export async function loadSocialAccounts(db: AccountDatabase, userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return [];
  await prepareProfileTables(db);
  const accounts: SocialAccountSummary[] = [];
  for (let index = 0; index < uniqueIds.length; index += 80) {
    const ids = uniqueIds.slice(index, index + 80);
    const placeholders = ids.map(() => "?").join(", ");
    const result = await db.prepare(`SELECT users.id, users.display_name, users.faction,
        current_profile.data_json AS profile_json, legacy.data_json AS legacy_json,
        COALESCE(ranked_ratings.bp, 1000) AS bp,
        COALESCE(account_match_stats.wins, 0) AS wins,
        COALESCE(account_match_stats.losses, 0) AS losses
      FROM users
      LEFT JOIN user_data_entities current_profile
        ON current_profile.user_id = users.id AND current_profile.entity_type = 'profile'
        AND current_profile.entity_id = 'main' AND current_profile.deleted_at IS NULL
      LEFT JOIN user_data legacy ON legacy.user_id = users.id
      LEFT JOIN ranked_ratings ON ranked_ratings.user_id = users.id
      LEFT JOIN account_match_stats ON account_match_stats.user_id = users.id
      LEFT JOIN account_bans ON account_bans.user_id = users.id
      WHERE users.id IN (${placeholders}) AND account_bans.user_id IS NULL`)
      .bind(...ids).all<ProfileRow>();
    accounts.push(...(result.results ?? []).map(accountFromRow));
  }
  return accounts;
}

export async function loadSocialAccount(db: AccountDatabase, userId: string) {
  return (await loadSocialAccounts(db, [userId]))[0] ?? null;
}

async function requireSocialTarget(db: AccountDatabase, actorId: string, targetId: string) {
  if (!targetId || actorId === targetId) throw new ValidationError("Choose another Brawler.");
  const target = await loadSocialAccount(db, targetId);
  if (!target) throw new ValidationError("That Brawler account is unavailable.");
  return target;
}

async function relationshipRow(db: AccountDatabase, actorId: string, targetId: string) {
  const [low, high] = canonicalSocialPair(actorId, targetId);
  return db.prepare("SELECT user_low, user_high, requested_by, status FROM social_relationships WHERE user_low = ? AND user_high = ?")
    .bind(low, high).first<RelationshipRow>();
}

export function relationshipFor(row: RelationshipRow | null, viewerId: string): SocialRelationship {
  if (!row) return "none";
  if (row.status === "accepted") return "friend";
  return row.requested_by === viewerId ? "outgoing" : "incoming";
}

export async function socialRelationship(db: AccountDatabase, actorId: string, targetId: string) {
  await ensureSocialSchema(db);
  return relationshipFor(await relationshipRow(db, actorId, targetId), actorId);
}

export async function requestFriend(db: AccountDatabase, actorId: string, targetId: string) {
  await ensureSocialSchema(db);
  await requireSocialTarget(db, actorId, targetId);
  const [low, high] = canonicalSocialPair(actorId, targetId);
  const existing = await relationshipRow(db, actorId, targetId);
  const now = Date.now();
  if (!existing) {
    await db.prepare("INSERT OR IGNORE INTO social_relationships (user_low, user_high, requested_by, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
      .bind(low, high, actorId, now, now).run();
  }
  const current = existing ?? await relationshipRow(db, actorId, targetId);
  if (current?.status === "pending" && current.requested_by !== actorId) {
    await db.prepare("UPDATE social_relationships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requested_by <> ?")
      .bind(now, low, high, actorId).run();
  }
  return socialRelationship(db, actorId, targetId);
}

export async function acceptFriend(db: AccountDatabase, actorId: string, targetId: string) {
  await ensureSocialSchema(db);
  await requireSocialTarget(db, actorId, targetId);
  const [low, high] = canonicalSocialPair(actorId, targetId);
  const result = await db.prepare("UPDATE social_relationships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requested_by = ?")
    .bind(Date.now(), low, high, targetId).run();
  if (!result.meta.changes) throw new ConflictError("That friend request is no longer available.");
  return "friend" as const;
}

async function deletePendingRequest(db: AccountDatabase, actorId: string, targetId: string, requestedBy: string) {
  await ensureSocialSchema(db);
  const [low, high] = canonicalSocialPair(actorId, targetId);
  const result = await db.prepare("DELETE FROM social_relationships WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requested_by = ?")
    .bind(low, high, requestedBy).run();
  if (!result.meta.changes) throw new ConflictError("That friend request is no longer available.");
  return "none" as const;
}

export function declineFriend(db: AccountDatabase, actorId: string, targetId: string) {
  return deletePendingRequest(db, actorId, targetId, targetId);
}

export function cancelFriend(db: AccountDatabase, actorId: string, targetId: string) {
  return deletePendingRequest(db, actorId, targetId, actorId);
}

export async function removeFriend(db: AccountDatabase, actorId: string, targetId: string) {
  await ensureSocialSchema(db);
  const [low, high] = canonicalSocialPair(actorId, targetId);
  const result = await db.prepare("DELETE FROM social_relationships WHERE user_low = ? AND user_high = ? AND status = 'accepted'")
    .bind(low, high).run();
  if (!result.meta.changes) throw new ConflictError("That Brawler is no longer in your friends list.");
  return "none" as const;
}

function parseMatchState(value: string) {
  try {
    return JSON.parse(value) as MatchState;
  } catch {
    return null;
  }
}

function lobbySummary(state: MatchState): ActiveSocialLobby | null {
  if (state.phase !== "lobby" || state.players.length >= 2) return null;
  const config = lobbyConfig(state);
  if (config.mode === "training") return null;
  return {
    code: state.code,
    format: state.format,
    rulesFormat: config.rulesFormat,
    openSlots: 2 - state.players.length,
  };
}

export async function activeSocialLobby(db: AccountDatabase, userId: string) {
  await ensureReplayArchiveSchema(db);
  const result = await db.prepare(`SELECT matches.state_json, match_seat_accounts.player_id
      FROM match_seat_accounts JOIN matches ON matches.code = match_seat_accounts.code
      WHERE match_seat_accounts.user_id = ? ORDER BY matches.updated_at DESC LIMIT 12`)
    .bind(userId).all<{ state_json: string; player_id: string }>();
  for (const row of result.results ?? []) {
    const state = parseMatchState(row.state_json);
    if (state && roomOwnerId(state) === row.player_id) {
      const summary = lobbySummary(state);
      if (summary) return summary;
    }
  }
  return null;
}

async function requireInvitableLobby(db: AccountDatabase, userId: string, code: string) {
  const lobby = await activeSocialLobby(db, userId);
  if (!lobby || lobby.code !== code.toUpperCase() || lobby.openSlots < 1) {
    throw new ConflictError("Your lobby no longer has an open slot.");
  }
  return lobby;
}

async function recordInviteEvent(db: AccountDatabase, invite: InviteRow, kind: "sent" | "accepted" | "declined" | "expired") {
  const users = await db.prepare("SELECT id, display_name FROM users WHERE id IN (?, ?)")
    .bind(invite.inviter_user_id, invite.recipient_user_id).all<{ id: string; display_name: string }>();
  const byId = new Map((users.results ?? []).map((row) => [row.id, row.display_name]));
  const inviter = byId.get(invite.inviter_user_id) ?? "A Brawler";
  const recipient = byId.get(invite.recipient_user_id) ?? "a Brawler";
  const message = kind === "sent"
    ? `${inviter} invited ${recipient} to the lobby.`
    : kind === "accepted" ? `${recipient} accepted the lobby invitation.`
      : kind === "declined" ? `${recipient} declined the lobby invitation.`
        : `The invitation to ${recipient} expired.`;
  await db.prepare("INSERT OR IGNORE INTO social_lobby_events (id, lobby_code, message, created_at) VALUES (?, ?, ?, ?)")
    .bind(`${invite.id}:${kind}`, invite.lobby_code, message, Date.now()).run();
}

/** Used by the minute cron and before sending a new invitation. Records outcomes once. */
export async function expireLobbyInvitations(db: AccountDatabase, now = Date.now()) {
  const expired = await db.prepare("UPDATE lobby_invitations SET status = 'expired', responded_at = ? WHERE status = 'pending' AND expires_at <= ? RETURNING id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at")
    .bind(now, now).all<InviteRow>();
  for (const invite of expired.results ?? []) await recordInviteEvent(db, invite, "expired");
  return expired.results ?? [];
}

async function currentLobbyMessages(db: AccountDatabase, viewerId: string): Promise<LobbySystemMessage[]> {
  await ensureReplayArchiveSchema(db);
  const seats = await db.prepare(`SELECT matches.state_json, matches.code
    FROM match_seat_accounts JOIN matches ON matches.code = match_seat_accounts.code
    WHERE match_seat_accounts.user_id = ? ORDER BY matches.updated_at DESC LIMIT 12`)
    .bind(viewerId).all<{ state_json: string; code: string }>();
  const room = (seats.results ?? []).find(({ state_json }) => {
    const state = parseMatchState(state_json);
    return state?.phase === "lobby" && lobbyConfig(state).mode !== "training";
  });
  if (!room) return [];
  const events = await db.prepare("SELECT id, lobby_code, message, created_at FROM social_lobby_events WHERE lobby_code = ? ORDER BY created_at ASC LIMIT 100")
    .bind(room.code).all<{ id: string; lobby_code: string; message: string; created_at: number }>();
  return (events.results ?? []).map((event) => ({ id: event.id, lobbyCode: event.lobby_code, at: event.created_at, message: event.message }));
}

export async function createLobbyInvitation(db: AccountDatabase, inviterId: string, recipientId: string, lobbyCode: string) {
  await ensureSocialSchema(db);
  await requireSocialTarget(db, inviterId, recipientId);
  const lobby = await requireInvitableLobby(db, inviterId, lobbyCode);
  const preferences = await db.prepare("SELECT allow_lobby_invites FROM social_preferences WHERE user_id = ?")
    .bind(recipientId).first<{ allow_lobby_invites: number }>();
  if (preferences && !preferences.allow_lobby_invites) throw new AuthorizationError("That Brawler is not accepting lobby invitations.");
  const now = Date.now();
  await expireLobbyInvitations(db, now);
  const existing = await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE lobby_code = ? AND inviter_user_id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(lobby.code, inviterId, recipientId).first<InviteRow>();
  if (existing) return { ...existing, format: lobby.format, rulesFormat: lobby.rulesFormat };
  const invite: InviteRow = {
    id: crypto.randomUUID(),
    lobby_code: lobby.code,
    inviter_user_id: inviterId,
    recipient_user_id: recipientId,
    status: "pending",
    created_at: now,
    expires_at: now + SOCIAL_INVITE_TTL_MS,
  };
  await db.prepare("INSERT OR IGNORE INTO lobby_invitations (id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
    .bind(invite.id, invite.lobby_code, inviterId, recipientId, now, invite.expires_at).run();
  const pending = await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE lobby_code = ? AND inviter_user_id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(lobby.code, inviterId, recipientId).first<InviteRow>() ?? invite;
  await recordInviteEvent(db, pending, "sent");
  return { ...pending, format: lobby.format, rulesFormat: lobby.rulesFormat };
}

async function requirePendingInvite(db: AccountDatabase, inviteId: string, recipientId: string) {
  await ensureSocialSchema(db);
  const invite = await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE id = ? AND recipient_user_id = ? AND status = 'pending' AND expires_at > ?")
    .bind(inviteId, recipientId, Date.now()).first<InviteRow>();
  if (!invite) throw new ConflictError("That lobby invitation is no longer available.");
  return invite;
}

export async function acceptLobbyInvitation(db: AccountDatabase, recipientId: string, inviteId: string) {
  const invite = await requirePendingInvite(db, inviteId, recipientId);
  const lobby = await requireInvitableLobby(db, invite.inviter_user_id, invite.lobby_code);
  const result = await db.prepare("UPDATE lobby_invitations SET status = 'accepted', responded_at = ? WHERE id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(Date.now(), inviteId, recipientId).run();
  if (!result.meta.changes) throw new ConflictError("That lobby invitation is no longer available.");
  await recordInviteEvent(db, invite, "accepted");
  return { lobby, inviterId: invite.inviter_user_id };
}

export async function declineLobbyInvitation(db: AccountDatabase, recipientId: string, inviteId: string) {
  const invite = await requirePendingInvite(db, inviteId, recipientId);
  const result = await db.prepare("UPDATE lobby_invitations SET status = 'declined', responded_at = ? WHERE id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(Date.now(), inviteId, recipientId).run();
  if (!result.meta.changes) throw new ConflictError("That lobby invitation is no longer available.");
  await recordInviteEvent(db, invite, "declined");
  return { inviterId: invite.inviter_user_id, lobbyCode: invite.lobby_code };
}

function relationshipTarget(row: RelationshipRow, viewerId: string) {
  return row.user_low === viewerId ? row.user_high : row.user_low;
}

/**
 * Read pending invitations without loading the social directory, friends, room
 * messages or the presence shards. Used by the drawer and reconnect recovery.
 */
export async function getPendingLobbyInvitations(db: AccountDatabase, viewerId: string): Promise<LobbyInviteSummary[]> {
  await ensureSocialSchema(db);
  const result = await db.prepare(`SELECT
      invite.id, invite.lobby_code, invite.inviter_user_id, invite.created_at, invite.expires_at,
      inviter.display_name, inviter.faction, matches.state_json
    FROM lobby_invitations invite
    JOIN users inviter ON inviter.id = invite.inviter_user_id
    LEFT JOIN social_hidden_accounts hidden ON hidden.user_id = inviter.id
    LEFT JOIN matches ON matches.code = invite.lobby_code
    WHERE invite.recipient_user_id = ? AND invite.status = 'pending'
      AND invite.expires_at > ? AND hidden.user_id IS NULL
    ORDER BY invite.created_at DESC`)
    .bind(viewerId, Date.now()).all<InviteRow & {
      display_name: string;
      faction: string;
      state_json: string | null;
    }>();
  return (result.results ?? []).map((row) => {
    const state = row.state_json ? parseMatchState(row.state_json) : null;
    const lobby = state ? lobbySummary(state) : null;
    return {
      id: row.id,
      lobbyCode: row.lobby_code,
      inviter: {
        userId: row.inviter_user_id,
        displayName: row.display_name,
        faction: row.faction,
        avatar: "",
        titleId: "battle-planet-brawler",
        rank: "",
        bp: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        online: false,
        relationship: "none",
      },
      format: lobby?.format ?? null,
      rulesFormat: lobby?.rulesFormat ?? null,
      available: Boolean(lobby),
      unavailableReason: lobby ? undefined : "This lobby is no longer open. You can decline the invitation.",
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
}

export async function buildSocialSnapshot(
  db: AccountDatabase,
  viewerId: string,
  onlineAccounts: SocialAccountSummary[],
): Promise<SocialSnapshot> {
  await ensureSocialSchema(db);
  const [relationships, invitations, lobby, lobbyMessages] = await Promise.all([
    db.prepare("SELECT user_low, user_high, requested_by, status FROM social_relationships WHERE user_low = ? OR user_high = ? ORDER BY updated_at DESC")
      .bind(viewerId, viewerId).all<RelationshipRow>(),
    getPendingLobbyInvitations(db, viewerId),
    activeSocialLobby(db, viewerId),
    currentLobbyMessages(db, viewerId),
  ]);
  const hiddenRows = await db.prepare("SELECT user_id FROM social_hidden_accounts").all<{ user_id: string }>();
  const hiddenIds = new Set((hiddenRows.results ?? []).map((row) => row.user_id));
  const relationshipRows = (relationships.results ?? []).filter((row) => !hiddenIds.has(relationshipTarget(row, viewerId)));
  const targetIds = relationshipRows.map((row) => relationshipTarget(row, viewerId));
  const storedAccounts = await loadSocialAccounts(db, targetIds);
  const byId = new Map<string, SocialAccountSummary>();
  for (const account of [...storedAccounts, ...onlineAccounts].filter((account) => !hiddenIds.has(account.userId))) {
    const existing = byId.get(account.userId);
    byId.set(account.userId, { ...(existing ?? account), ...account, online: account.online || existing?.online || false });
  }
  const friendIds = new Set<string>();
  const friends: SocialAccountSummary[] = [];
  const incomingRequests: SocialAccountSummary[] = [];
  const outgoingRequests: SocialAccountSummary[] = [];
  for (const row of relationshipRows) {
    const targetId = relationshipTarget(row, viewerId);
    const account = byId.get(targetId);
    if (!account) continue;
    const relationship = relationshipFor(row, viewerId);
    const decorated = { ...account, relationship };
    if (relationship === "friend") {
      friendIds.add(targetId);
      friends.push(decorated);
    } else if (relationship === "incoming") {
      incomingRequests.push(decorated);
    } else {
      outgoingRequests.push(decorated);
    }
  }
  const onlineIds = new Set(onlineAccounts.map((account) => account.userId));
  const directory = await db.prepare("SELECT users.id FROM users LEFT JOIN account_bans ON account_bans.user_id = users.id LEFT JOIN social_hidden_accounts hidden ON hidden.user_id = users.id WHERE account_bans.user_id IS NULL AND hidden.user_id IS NULL AND users.id <> ? ORDER BY users.display_name COLLATE NOCASE")
    .bind(viewerId).all<{ id: string }>();
  const offlineIds = (directory.results ?? []).map((row) => row.id).filter((id) => !onlineIds.has(id) && !friendIds.has(id));
  const offlineBrawlers = (await loadSocialAccounts(db, offlineIds)).map((account) => ({ ...account, online: false, relationship: relationshipFor(relationshipRows.find((row) => relationshipTarget(row, viewerId) === account.userId) ?? null, viewerId) }));
  const onlineBrawlers = onlineAccounts
    .filter((account) => account.userId !== viewerId && !friendIds.has(account.userId) && !hiddenIds.has(account.userId))
    .map((account) => {
      const row = relationshipRows.find((candidate) => relationshipTarget(candidate, viewerId) === account.userId) ?? null;
      return { ...account, online: true, relationship: relationshipFor(row, viewerId) };
    });
  return {
    friends: sortSocialAccounts(friends),
    incomingRequests: sortSocialAccounts(incomingRequests),
    outgoingRequests: sortSocialAccounts(outgoingRequests),
    onlineBrawlers: sortSocialAccounts(onlineBrawlers),
    offlineBrawlers: sortSocialAccounts(offlineBrawlers),
    invitations,
    lobbyMessages,
    activeLobby: lobby,
    unreadCount: incomingRequests.length + invitations.length,
  };
}

export async function socialMatchOpponent(db: AccountDatabase, viewerId: string, code: string) {
  await ensureSocialSchema(db);
  await ensureReplayArchiveSchema(db);
  const seats = await db.prepare("SELECT player_id, user_id FROM match_seat_accounts WHERE code = ?")
    .bind(code.toUpperCase()).all<{ player_id: string; user_id: string }>();
  const rows = seats.results ?? [];
  if (!rows.some((seat) => seat.user_id === viewerId)) throw new AuthorizationError("That match is not associated with your account.");
  const opponent = rows.find((seat) => seat.user_id !== viewerId);
  if (!opponent) return null;
  const account = await loadSocialAccount(db, opponent.user_id);
  if (!account) return null;
  return { ...account, relationship: await socialRelationship(db, viewerId, opponent.user_id) };
}
