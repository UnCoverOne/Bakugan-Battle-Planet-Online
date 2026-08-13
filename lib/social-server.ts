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

export async function ensureSocialSchema(db: AccountDatabase) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS social_relationships (user_low TEXT NOT NULL, user_high TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_low, user_high), CHECK (user_low < user_high), CHECK (requested_by = user_low OR requested_by = user_high), FOREIGN KEY (user_low) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (user_high) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS social_relationships_low_status_idx ON social_relationships(user_low, status, updated_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS social_relationships_high_status_idx ON social_relationships(user_high, status, updated_at DESC)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lobby_invitations (id TEXT PRIMARY KEY, lobby_code TEXT NOT NULL, inviter_user_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, responded_at INTEGER, CHECK (inviter_user_id <> recipient_user_id), FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS lobby_invitations_pending_pair_idx ON lobby_invitations(lobby_code, inviter_user_id, recipient_user_id) WHERE status = 'pending'"),
    db.prepare("CREATE INDEX IF NOT EXISTS lobby_invitations_recipient_idx ON lobby_invitations(recipient_user_id, status, expires_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS lobby_invitations_expiry_idx ON lobby_invitations(status, expires_at)"),
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

async function expireInvitations(db: AccountDatabase, now = Date.now()) {
  await db.prepare("UPDATE lobby_invitations SET status = 'expired', responded_at = ? WHERE status = 'pending' AND expires_at <= ?")
    .bind(now, now).run();
}

export async function createLobbyInvitation(db: AccountDatabase, inviterId: string, recipientId: string, lobbyCode: string) {
  await ensureSocialSchema(db);
  await requireSocialTarget(db, inviterId, recipientId);
  const lobby = await requireInvitableLobby(db, inviterId, lobbyCode);
  const preferences = await db.prepare("SELECT allow_lobby_invites FROM social_preferences WHERE user_id = ?")
    .bind(recipientId).first<{ allow_lobby_invites: number }>();
  if (preferences && !preferences.allow_lobby_invites) throw new AuthorizationError("That Brawler is not accepting lobby invitations.");
  const now = Date.now();
  await expireInvitations(db, now);
  const existing = await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE lobby_code = ? AND inviter_user_id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(lobby.code, inviterId, recipientId).first<InviteRow>();
  if (existing) return existing;
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
  return await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE lobby_code = ? AND inviter_user_id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(lobby.code, inviterId, recipientId).first<InviteRow>() ?? invite;
}

async function requirePendingInvite(db: AccountDatabase, inviteId: string, recipientId: string) {
  await ensureSocialSchema(db);
  await expireInvitations(db);
  const invite = await db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(inviteId, recipientId).first<InviteRow>();
  if (!invite) throw new ConflictError("That lobby invitation is no longer available.");
  return invite;
}

export async function acceptLobbyInvitation(db: AccountDatabase, recipientId: string, inviteId: string) {
  const invite = await requirePendingInvite(db, inviteId, recipientId);
  const lobby = await requireInvitableLobby(db, invite.inviter_user_id, invite.lobby_code);
  const result = await db.prepare("UPDATE lobby_invitations SET status = 'accepted', responded_at = ? WHERE id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(Date.now(), inviteId, recipientId).run();
  if (!result.meta.changes) throw new ConflictError("That lobby invitation is no longer available.");
  return lobby;
}

export async function declineLobbyInvitation(db: AccountDatabase, recipientId: string, inviteId: string) {
  await requirePendingInvite(db, inviteId, recipientId);
  await db.prepare("UPDATE lobby_invitations SET status = 'declined', responded_at = ? WHERE id = ? AND recipient_user_id = ? AND status = 'pending'")
    .bind(Date.now(), inviteId, recipientId).run();
  return true;
}

function relationshipTarget(row: RelationshipRow, viewerId: string) {
  return row.user_low === viewerId ? row.user_high : row.user_low;
}

export async function buildSocialSnapshot(
  db: AccountDatabase,
  viewerId: string,
  onlineAccounts: SocialAccountSummary[],
): Promise<SocialSnapshot> {
  await ensureSocialSchema(db);
  await expireInvitations(db);
  const [relationships, inviteRows, lobby] = await Promise.all([
    db.prepare("SELECT user_low, user_high, requested_by, status FROM social_relationships WHERE user_low = ? OR user_high = ? ORDER BY updated_at DESC")
      .bind(viewerId, viewerId).all<RelationshipRow>(),
    db.prepare("SELECT id, lobby_code, inviter_user_id, recipient_user_id, status, created_at, expires_at FROM lobby_invitations WHERE recipient_user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC")
      .bind(viewerId, Date.now()).all<InviteRow>(),
    activeSocialLobby(db, viewerId),
  ]);
  const relationshipRows = relationships.results ?? [];
  const targetIds = relationshipRows.map((row) => relationshipTarget(row, viewerId));
  const inviterIds = (inviteRows.results ?? []).map((row) => row.inviter_user_id);
  const storedAccounts = await loadSocialAccounts(db, [...targetIds, ...inviterIds]);
  const inviteCodes = [...new Set((inviteRows.results ?? []).map((row) => row.lobby_code))];
  const inviteLobbies = new Map<string, ActiveSocialLobby>();
  if (inviteCodes.length) {
    const placeholders = inviteCodes.map(() => "?").join(", ");
    const states = await db.prepare(`SELECT code, state_json FROM matches WHERE code IN (${placeholders})`)
      .bind(...inviteCodes).all<{ code: string; state_json: string }>();
    for (const row of states.results ?? []) {
      const state = parseMatchState(row.state_json);
      const summary = state ? lobbySummary(state) : null;
      if (summary) inviteLobbies.set(row.code, summary);
    }
  }
  const byId = new Map<string, SocialAccountSummary>();
  for (const account of [...storedAccounts, ...onlineAccounts]) {
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
  const onlineBrawlers = onlineAccounts
    .filter((account) => account.userId !== viewerId && !friendIds.has(account.userId))
    .map((account) => {
      const row = relationshipRows.find((candidate) => relationshipTarget(candidate, viewerId) === account.userId) ?? null;
      return { ...account, online: true, relationship: relationshipFor(row, viewerId) };
    });
  const invitations: LobbyInviteSummary[] = (inviteRows.results ?? []).flatMap((row) => {
    const inviter = byId.get(row.inviter_user_id);
    const invitedLobby = inviteLobbies.get(row.lobby_code);
    if (!inviter || !invitedLobby) return [];
    return [{
      id: row.id,
      lobbyCode: row.lobby_code,
      inviter: { ...inviter, relationship: relationshipFor(
        relationshipRows.find((candidate) => relationshipTarget(candidate, viewerId) === inviter.userId) ?? null,
        viewerId,
      ) },
      format: invitedLobby.format,
      rulesFormat: invitedLobby.rulesFormat,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }];
  });
  return {
    friends: sortSocialAccounts(friends),
    incomingRequests: sortSocialAccounts(incomingRequests),
    outgoingRequests: sortSocialAccounts(outgoingRequests),
    onlineBrawlers: sortSocialAccounts(onlineBrawlers),
    invitations,
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
