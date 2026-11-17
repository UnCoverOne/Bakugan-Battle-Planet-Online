import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalSocialPair, isLobbyInviteSummary, socialPresenceShard, sortSocialAccounts } from "../lib/social";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("friendship pairs are canonical and self-friending is rejected", () => {
  assert.deepEqual(canonicalSocialPair("user-z", "user-a"), ["user-a", "user-z"]);
  assert.throws(() => canonicalSocialPair("same", "same"), /another Brawler/i);
});

test("presence assignment is stable, bounded, and distributed across shards", () => {
  assert.equal(socialPresenceShard("brawler-42"), socialPresenceShard("brawler-42"));
  const shards = new Set(Array.from({ length: 200 }, (_, index) => socialPresenceShard(`user-${index}`)));
  assert.ok(shards.size > 4);
  for (const shard of shards) assert.match(shard, /^social-[0-7]$/);
});

test("social accounts sort online first and then by display name", () => {
  const sorted = sortSocialAccounts([
    { displayName: "Zane", online: false },
    { displayName: "Wynton", online: true },
    { displayName: "Dan", online: true },
  ]);
  assert.deepEqual(sorted.map((account) => account.displayName), ["Dan", "Wynton", "Zane"]);
});

test("social persistence enforces relationship and invitation invariants", async () => {
  const migration = await source("migrations/0006_social.sql");
  assert.match(migration, /PRIMARY KEY \(user_low, user_high\)/);
  assert.match(migration, /CHECK \(user_low < user_high\)/);
  assert.match(migration, /status IN \('pending', 'accepted'\)/);
  assert.match(migration, /lobby_invitations_pending_pair_idx/);
  assert.match(migration, /expires_at/);
});

test("presence uses authenticated hibernating WebSockets and independent social shards", async () => {
  const [worker, config] = await Promise.all([source("worker/index.ts"), source("wrangler.jsonc")]);
  assert.match(worker, /class SocialPresence/);
  assert.match(worker, /acceptWebSocket\(server, \[userId\]\)/);
  assert.match(worker, /serializeAttachment/);
  assert.match(worker, /getSessionUserFromDatabase\(sanitizedRequest, env\.DB\)/);
  assert.match(config, /"SOCIAL_PRESENCE"/);
  assert.match(config, /"SocialPresence"/);
});

test("drawer and both match result surfaces expose the shared social actions", async () => {
  const [drawer, shell, coordinator, routes] = await Promise.all([
    source("components/social/SocialProvider.tsx"),
    source("components/application/AppShell.jsx"),
    source("components/game-screen-v2/MatchStateCoordinator.tsx"),
    source("components/routes/PlayRoutes.tsx"),
  ]);
  assert.match(shell, /<SocialMenuButton \/>/);
  assert.match(drawer, /FRIENDS/);
  assert.match(drawer, /ONLINE BRAWLERS/);
  assert.match(drawer, /ADD FRIEND/);
  assert.match(drawer, /REMOVE FRIEND/);
  assert.match(drawer, /INVITE TO LOBBY/);
  assert.match(coordinator, /<MatchResultSocial/);
  assert.match(routes, /<MatchResultSocial/);
});

test("server match archives preserve the opponent account association", async () => {
  const [persistence, replay] = await Promise.all([
    source("lib/persistence.ts"),
    source("lib/replay-archive-server.ts"),
  ]);
  assert.match(persistence, /opponentUserId\?: string/);
  assert.match(replay, /opponentUserId/);
  assert.match(replay, /byPlayer\.get\(opponent\.id\)/);
});

test("offline directory and hidden-account controls are wired through the social API", async () => {
  const [drawer, social, admin, migration, schema] = await Promise.all([
    source("components/social/SocialProvider.tsx"),
    source("lib/social-server.ts"),
    source("app/api/admin/route.ts"),
    source("migrations/0015_social_hidden_accounts.sql"),
    source("db/schema.ts"),
  ]);
  assert.match(drawer, /OFFLINE BRAWLERS/);
  assert.match(drawer, /snapshot\.offlineBrawlers/);
  assert.match(social, /offlineBrawlers: sortSocialAccounts\(offlineBrawlers\)/);
  assert.match(social, /hiddenIds\.has/);
  assert.match(admin, /action === "set-social-hidden"/);
  assert.match(admin, /requireAdministrator\(request\)/);
  assert.match(migration, /social_hidden_accounts/);
  assert.match(schema, /socialHiddenAccounts/);
});

test("lobby invitations have five-minute validity and are not hidden when the room is unavailable", async () => {
  const [types, server, api] = await Promise.all([
    source("lib/social.ts"), source("lib/social-server.ts"), source("app/api/social/route.ts"),
  ]);
  assert.match(types, /SOCIAL_INVITE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(server, /available: Boolean\(lobby\)/);
  assert.match(server, /getPendingLobbyInvitations/);
  assert.match(server, /expires_at > \?/);
  assert.match(server, /recordInviteEvent\(db, invite, "accepted"\)/);
  assert.match(server, /recordInviteEvent\(db, invite, "declined"\)/);
  assert.match(api, /accepted\.inviterId/);
  assert.match(api, /declined\.inviterId/);
});

test("actionable invites, activity labels, and invitation events are connected to the lobby UI", async () => {
  const [drawer, room, legacyRoom, worker, migration] = await Promise.all([
    source("components/social/SocialProvider.tsx"),
    source("components/routes/StreamlinedLobbyRoomScreen.tsx"),
    source("components/routes/LobbyRoomScreen.tsx"),
    source("worker/index.ts"),
    source("migrations/0016_social_lobby_events.sql"),
  ]);
  assert.match(drawer, /function LobbyInviteNotice/);
  assert.match(drawer, /useState\(15\)/);
  assert.match(drawer, /respond\("accept-invite"\)/);
  assert.match(drawer, /respond\("decline-invite"\)/);
  assert.match(drawer, /activityLabel = activity === "lobby"/);
  assert.match(room, /lobbyChatEntries/);
  assert.match(legacyRoom, /lobbyChatEntries/);
  assert.match(worker, /presence\.activity/);
  assert.match(worker, /expireLobbyInvitations/);
  assert.match(migration, /social_lobby_events/);
});

test("lobby system messages are scoped and ordered alongside player chat", async () => {
  const { lobbyChatEntries } = await import("../lib/chat");
  const match = {
    code: "ABC123",
    log: [{ id: "player-chat", kind: "chat", at: 300, playerId: "p1", author: "Dan", message: "Hi" }],
  } as Parameters<typeof lobbyChatEntries>[0];
  const output = lobbyChatEntries(match, [
    { id: "other", lobbyCode: "OTHER1", at: 50, message: "Hidden" },
    { id: "invite", lobbyCode: "ABC123", at: 100, message: "An invitation was sent." },
  ]);
  assert.deepEqual(output.map((event) => event.id), ["invite", "player-chat"]);
  assert.equal(output[0]?.author, "SYSTEM");
});


test("complete lobby events validate without a social snapshot", () => {
  const invite = {
    id: "inv-123",
    lobbyCode: "ABC234",
    inviter: { userId: "player-a", displayName: "Dan" },
    format: "bo3",
    rulesFormat: "standard",
    available: true,
    createdAt: Date.now() - 500,
    expiresAt: Date.now() + 300_000,
  };
  assert.equal(isLobbyInviteSummary(invite), true);
  assert.equal(isLobbyInviteSummary({ ...invite, id: "" }), false);
  assert.equal(isLobbyInviteSummary({ ...invite, inviter: null }), false);
  assert.equal(isLobbyInviteSummary({ ...invite, expiresAt: "tomorrow" }), false);
  assert.equal(isLobbyInviteSummary({ ...invite, lobbyCode: "abc234" }), false);
  assert.equal(isLobbyInviteSummary(null), false);
});

test("dedicated invite endpoint does not use presence shards and sends complete socket payloads", async () => {
  const [api, drawer, server, events] = await Promise.all([
    source("app/api/social/route.ts"),
    source("components/social/SocialProvider.tsx"),
    source("lib/social-server.ts"),
    source("lib/social-presence-server.ts"),
  ]);
  assert.ok(api.indexOf('action === "invitations"') < api.indexOf("await onlineSocialAccounts()"));
  assert.match(api, /type: "lobby.invited"[\s\S]*invite: inviteSummary/);
  assert.match(events, /invite\?: LobbyInviteSummary/);
  assert.match(server, /JOIN users inviter ON inviter.id = invite.inviter_user_id/);
  assert.match(server, /LEFT JOIN matches ON matches.code = invite.lobby_code/);
  assert.match(drawer, /setIncomingInvite\(invite\)/);
  assert.match(drawer, /api\/social\?action=invitations/);
  assert.match(drawer, /Could not refresh lobby invitations\. Retry below/);
  assert.match(drawer, /RETRY INVITES/);
  assert.doesNotMatch(drawer, /Loading invitation details/);
});

test("pending invitation is still returned by the small endpoint when the lobby is unavailable", async () => {
  const { getPendingLobbyInvitations } = await import("../lib/social-server");
  const sqlStatements: string[] = [];
  const db = {
    prepare(sql: string) {
      sqlStatements.push(sql);
      const statement = {
        bind(..._values: unknown[]) { return statement; },
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({
          results: sql.includes("FROM lobby_invitations invite")
            ? [{
              id: "inv-1", lobby_code: "ABC234", inviter_user_id: "player-a",
              created_at: 10, expires_at: Date.now() + 300_000,
              display_name: "Dan", faction: "Pyrus", state_json: null,
            }]
            : [],
        }),
      };
      return statement;
    },
    batch: async () => [],
  } as unknown as Parameters<typeof getPendingLobbyInvitations>[0];
  const invitations = await getPendingLobbyInvitations(db, "player-b");
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0]?.id, "inv-1");
  assert.equal(invitations[0]?.inviter.displayName, "Dan");
  assert.equal(invitations[0]?.available, false);
  assert.match(invitations[0]?.unavailableReason ?? "", /no longer open/);
  assert.ok(sqlStatements.some((sql) => sql.includes("invite.recipient_user_id = ?")));
});
