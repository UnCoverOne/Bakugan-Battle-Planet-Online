import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { AuthenticationError, ValidationError, serverErrorResponse } from "../../../lib/server-errors";
import {
  acceptFriend,
  acceptLobbyInvitation,
  buildSocialSnapshot,
  cancelFriend,
  createLobbyInvitation,
  declineFriend,
  declineLobbyInvitation,
  loadSocialAccount,
  removeFriend,
  requestFriend,
  socialMatchOpponent,
  socialRelationship,
} from "../../../lib/social-server";
import { notifySocialUsers, onlineSocialAccounts } from "../../../lib/social-presence-server";

export const dynamic = "force-dynamic";
const MAX_SOCIAL_BODY_BYTES = 16_384;

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function text(value: unknown, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ValidationError(`${label} is invalid.`);
  }
  return value.trim();
}

async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw new AuthenticationError();
  return user;
}

async function parseBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_SOCIAL_BODY_BYTES) throw new ValidationError("Social request is too large.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SOCIAL_BODY_BYTES) {
    throw new ValidationError("Social request is too large.");
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ValidationError("Social request must be valid JSON.");
  }
}

function notifySafely(userIds: string[], event: Parameters<typeof notifySocialUsers>[1], correlationId: string) {
  return notifySocialUsers(userIds, event).catch((error) => {
    console.error(JSON.stringify({
      event: "social_notification_failed",
      correlationId,
      userIds,
      message: error instanceof Error ? error.message : String(error),
    }));
  });
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "snapshot";
  try {
    const user = await requireUser(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `social:get:${user.id}:${requestClientKey(request)}`, 120, 60_000);
    if (action === "snapshot") {
      const snapshot = await buildSocialSnapshot(db, user.id, await onlineSocialAccounts());
      return json({ snapshot, correlationId });
    }
    if (action === "profile") {
      const targetId = text(url.searchParams.get("userId"), "Brawler", 100);
      const account = await loadSocialAccount(db, targetId);
      if (!account) return json({ error: "Brawler profile not found.", correlationId }, 404);
      return json({ account: { ...account, relationship: await socialRelationship(db, user.id, targetId) }, correlationId });
    }
    if (action === "match-opponent") {
      const code = text(url.searchParams.get("code"), "Lobby code", 6).toUpperCase();
      return json({ account: await socialMatchOpponent(db, user.id, code), correlationId });
    }
    throw new ValidationError("Unknown social action.");
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Social data is unavailable.", {
      route: "/api/social",
      method: "GET",
      action,
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let action = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `social:write:${user.id}:${requestClientKey(request)}`, 40, 60_000);
    const body = await parseBody(request);
    action = text(body.action, "Social action", 40);
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (action === "request-friend") {
      const relationship = await requestFriend(db, user.id, text(targetId, "Brawler", 100));
      await notifySafely([user.id, targetId], { type: "social.changed", actorId: user.id }, correlationId);
      return json({ relationship, correlationId });
    }
    if (action === "accept-friend") {
      const relationship = await acceptFriend(db, user.id, text(targetId, "Brawler", 100));
      await notifySafely([user.id, targetId], { type: "social.changed", actorId: user.id }, correlationId);
      return json({ relationship, correlationId });
    }
    if (action === "decline-friend") {
      const relationship = await declineFriend(db, user.id, text(targetId, "Brawler", 100));
      await notifySafely([user.id, targetId], { type: "social.changed", actorId: user.id }, correlationId);
      return json({ relationship, correlationId });
    }
    if (action === "cancel-friend") {
      const relationship = await cancelFriend(db, user.id, text(targetId, "Brawler", 100));
      await notifySafely([user.id, targetId], { type: "social.changed", actorId: user.id }, correlationId);
      return json({ relationship, correlationId });
    }
    if (action === "remove-friend") {
      const relationship = await removeFriend(db, user.id, text(targetId, "Brawler", 100));
      await notifySafely([user.id, targetId], { type: "social.changed", actorId: user.id }, correlationId);
      return json({ relationship, correlationId });
    }
    if (action === "invite") {
      const invite = await createLobbyInvitation(
        db,
        user.id,
        text(targetId, "Brawler", 100),
        text(body.lobbyCode, "Lobby code", 6).toUpperCase(),
      );
      await notifySafely([targetId], { type: "lobby.invited", actorId: user.id, inviteId: invite.id }, correlationId);
      return json({ inviteId: invite.id, expiresAt: invite.expires_at, correlationId }, 201);
    }
    if (action === "accept-invite") {
      const inviteId = text(body.inviteId, "Invitation", 100);
      const lobby = await acceptLobbyInvitation(db, user.id, inviteId);
      await notifySafely([user.id], { type: "lobby.invite-responded", actorId: user.id, inviteId }, correlationId);
      return json({ lobby, correlationId });
    }
    if (action === "decline-invite") {
      const inviteId = text(body.inviteId, "Invitation", 100);
      await declineLobbyInvitation(db, user.id, inviteId);
      await notifySafely([user.id], { type: "lobby.invite-responded", actorId: user.id, inviteId }, correlationId);
      return json({ ok: true, correlationId });
    }
    throw new ValidationError("Unknown social action.");
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Social action failed.", {
      route: "/api/social",
      method: "POST",
      action,
    });
  }
}
