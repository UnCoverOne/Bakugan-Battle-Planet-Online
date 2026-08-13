import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accountMatchSessionHref,
  accountMatchSessionPresentation,
  type AccountMatchSessionSummary,
} from "../lib/account-match-session";
import { capabilityHashesMatch, digestMatchCapability } from "../lib/match-seat-auth";
import { ensureMatchSessionSchema } from "../lib/match-session-schema";
import { associateMatchSeatAccount } from "../lib/replay-archive-server";

const source = (path: string) => readFileSync(path, "utf8");

const session = (phase: AccountMatchSessionSummary["phase"]): AccountMatchSessionSummary => ({
  code: "ABC234",
  playerId: "player-one",
  phase,
  format: "bo3",
  opponentName: "Dan",
  stepLabel: "",
  updatedAt: 1_786_651_221_602,
  capabilityVersion: 4,
  controllerActive: false,
});

test("account match summaries route lobbies, games, and series intermissions correctly", () => {
  assert.equal(accountMatchSessionHref(session("lobby")), "/play/lobby");
  assert.equal(accountMatchSessionHref(session("match")), "/play/match");
  assert.equal(accountMatchSessionHref(session("intermission")), "/play/result");
  assert.equal(accountMatchSessionPresentation(session("intermission")).actionLabel, "VIEW RESULT");
});

test("seat capability digests compare without accepting a different or malformed hash", async () => {
  const expected = await digestMatchCapability("controller-secret");
  const different = await digestMatchCapability("different-secret");
  assert.equal(capabilityHashesMatch(expected, expected), true);
  assert.equal(capabilityHashesMatch(expected, different), false);
  assert.equal(capabilityHashesMatch(expected, "not-a-sha256-digest"), false);
});

test("the D1 migration adds a versioned, single-controller seat lease", () => {
  const migration = source("migrations/0007_match_session_resume.sql");
  const drizzle = source("drizzle/0006_match_session_resume.sql");
  for (const sql of [migration, drizzle]) {
    assert.match(sql, /capability_version[^;]*DEFAULT 1/i);
    assert.match(sql, /controller_id/i);
    assert.match(sql, /claimed_at/i);
    assert.match(sql, /match_seats_controller_idx/i);
  }
  const schema = source("db/schema.ts");
  assert.match(schema, /export const matchSeats/);
  assert.match(schema, /capabilityVersion: integer\("capability_version"\)/);
  assert.match(schema, /controllerId: text\("controller_id"\)/);
});

test("the runtime schema guard self-heals a missed production migration and tolerates an isolate race", async () => {
  const columns = new Set(["code", "player_id", "capability_hash", "created_at"]);
  const statements: string[] = [];
  let simulatedRace = false;
  const database = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        async all() {
          return { results: [...columns].map((name) => ({ name })) };
        },
        async run() {
          const added = /ADD COLUMN\s+(\w+)/i.exec(sql)?.[1];
          if (added === "controller_id" && !simulatedRace) {
            simulatedRace = true;
            columns.add(added);
            throw new Error("duplicate column name: controller_id");
          }
          if (added) columns.add(added);
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;

  await ensureMatchSessionSchema(database);

  assert.equal(simulatedRace, true);
  assert.equal(columns.has("capability_version"), true);
  assert.equal(columns.has("controller_id"), true);
  assert.equal(columns.has("claimed_at"), true);
  assert.equal(statements.some((sql) => /CREATE INDEX IF NOT EXISTS match_seats_controller_idx/i.test(sql)), true);
});

test("seat account backfill is idempotent and cannot transfer a seat to another account", async () => {
  let association: { code: string; playerId: string; userId: string; createdAt: number } | null = null;
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          values = next;
          return this;
        },
        async run() {
          if (!/INSERT INTO match_seat_accounts/i.test(sql)) return { meta: { changes: 0 } };
          const [code, playerId, userId, createdAt] = values as [string, string, string, number];
          if (association && association.userId !== userId) return { meta: { changes: 0 } };
          association = { code, playerId, userId, createdAt };
          return { meta: { changes: 1 } };
        },
      };
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;

  assert.equal(await associateMatchSeatAccount(database, "ABC234", "player-one", "account-one", 1), true);
  assert.equal(await associateMatchSeatAccount(database, "ABC234", "player-one", "account-one", 2), true);
  assert.equal(await associateMatchSeatAccount(database, "ABC234", "player-one", "account-two", 3), false);
  assert.deepEqual(association, { code: "ABC234", playerId: "player-one", userId: "account-one", createdAt: 2 });
});

test("active-match discovery is authenticated and returns metadata without controller secrets", () => {
  const active = source("app/api/game/active/route.ts");
  assert.match(active, /getSessionUser\(request\)/);
  assert.match(active, /if \(!user\) throw new AuthenticationError/);
  assert.match(active, /match_seat_accounts\.user_id = \?/);
  assert.match(active, /ensureMatchSessionSchema\(database\)/);
  assert.match(active, /ensureReplayArchiveSchema\(database\)/);
  assert.match(active, /authenticateMatchSeat\(database, request, code, playerId\)/);
  assert.match(active, /associateMatchSeatAccount\(database, code, playerId, userId/);
  assert.match(active, /isCompletedSeriesResult\(state\)/);
  assert.doesNotMatch(active, /capability_hash/);
  assert.doesNotMatch(active, /controller_id/);
  assert.match(active, /cache-control.*no-store/);
});

test("authenticated legacy seats are associated from every controlling transport", () => {
  const archive = source("lib/replay-archive-server.ts");
  const game = source("app/api/game/route.ts");
  const worker = source("worker/index.ts");
  const provider = source("components/application/AppProvider.jsx");
  assert.match(archive, /ON CONFLICT\(code, player_id\) DO UPDATE SET created_at = excluded\.created_at/);
  assert.match(archive, /WHERE match_seat_accounts\.user_id = excluded\.user_id/);
  assert.match(game, /authenticateSeat\(request, code, body\.playerId\)[\s\S]*associateMatchSeatAccount/);
  assert.match(game, /valid seat capability is required to reconnect[\s\S]*associateMatchSeatAccount/);
  assert.match(worker, /authenticateMatchSeat\([\s\S]*getSessionUserFromDatabase\(request, this\.env\.DB\)[\s\S]*associateMatchSeatAccount/);
  assert.match(provider, /"x-match-code": match\.code/);
  assert.match(provider, /"x-match-player": playerId/);
  assert.match(provider, /"x-match-capability": matchCapability/);
  assert.match(provider, /"x-match-controller": matchControllerId/);
});

test("resume claims are account-bound, origin-checked, and delegated to the room coordinator", () => {
  const route = source("app/api/game/resume/route.ts");
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /getSessionUser\(request\)/);
  assert.match(route, /userId: user\.id/);
  assert.match(route, /expectedCapabilityVersion/);
  assert.match(route, /MAX_RESUME_BODY_BYTES/);
  assert.match(route, /ensureMatchSessionSchema\(database\)/);
  assert.match(route, /getByName\(code\)\.fetch/);
  assert.doesNotMatch(route, /capability_hash/);
});

test("the room coordinator serializes claims with actions and fences concurrent takeovers", () => {
  const worker = source("worker/index.ts");
  assert.match(worker, /withSessionMutation/);
  assert.match(worker, /url\.pathname === "\/action"[\s\S]*withSessionMutation/);
  assert.match(worker, /url\.pathname === "\/resume"[\s\S]*withSessionMutation/);
  assert.match(worker, /match_seat_accounts\.code = \? AND match_seat_accounts\.user_id = \?/);
  assert.match(worker, /code: "SESSION_ACTIVE"/);
  assert.match(worker, /attachment\.capabilityVersion == null/);
  assert.match(worker, /WHERE code = \? AND player_id = \? AND capability_version = \?/);
  assert.match(worker, /code: "LEASE_CONFLICT"/);
  assert.match(worker, /SESSION_REPLACED_CLOSE_CODE/);
  assert.match(worker, /seat\.capability_version !== attachment\.capabilityVersion/);
  assert.match(worker, /seat\.controller_id !== attachment\.controllerId/);
  assert.match(worker, /ensureMatchSessionSchema\(this\.env\.DB\)/);
});

test("all seat commands require both the capability and current controller ID", () => {
  const auth = source("lib/match-seat-auth.ts");
  const game = source("app/api/game/route.ts");
  const worker = source("worker/index.ts");
  assert.match(auth, /MATCH_CAPABILITY_HEADER = "x-match-capability"/);
  assert.match(auth, /MATCH_CONTROLLER_HEADER = "x-match-controller"/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /seat\.controller_id !== controllerId/);
  assert.match(game, /authenticateMatchSeat/);
  assert.match(worker, /authenticateMatchSeat/);
  assert.doesNotMatch(worker, /searchParams\.get\("capability"\)/);
});

test("the browser keeps controller credentials session-scoped and stops a displaced transport", () => {
  const store = source("components/game-screen-v2/matchStore.ts");
  const provider = source("components/application/AppProvider.jsx");
  const shell = source("components/application/AppShell.jsx");
  const dashboard = source("components/routes/DashboardScreen.tsx");
  assert.match(store, /CONTROLLER_KEY = "bbp-match-controller-v1"/);
  assert.match(store, /readStorage\(sessionStorage, CONTROLLER_KEY\)/);
  assert.match(store, /"x-match-controller": state\.controllerId/);
  assert.match(store, /event\.code === 4001/);
  assert.match(store, /markSessionReplaced/);
  assert.match(store, /match: null/);
  assert.match(provider, /result\.code === "SESSION_ACTIVE"/);
  assert.match(provider, /window\.confirm/);
  assert.match(provider, /primeMatchStore\(\{ route, online: true/);
  assert.match(provider, /if \(!authUser\)/);
  assert.match(provider, /sessionStorage\.removeItem\(MATCH_CONTROLLER_STORAGE_KEY\)/);
  assert.match(provider, /MATCH_CAPABILITY_STORAGE_KEY[^\n]*writeEnabled: true/);
  assert.match(provider, /MATCH_CONTROLLER_STORAGE_KEY[^\n]*writeEnabled: true/);
  assert.match(shell, /canControlLocalMatch/);
  assert.match(dashboard, /canControlLocalMatch/);
});

test("Cloudflare release paths install the match-session schema before Worker promotion", () => {
  const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  const deploymentMigration = source("scripts/ensure-production-match-session-schema.mjs");
  const workersBuildGuide = source("SELF_HOSTING.md");
  const actionsTemplate = source("deploy/github-actions-cloudflare.yml");
  assert.match(packageJson.scripts["cf:publish"], /^npm run cf:migrate && .*wrangler deploy/);
  assert.match(deploymentMigration, /PRAGMA table_info\('match_seats'\)/);
  assert.match(deploymentMigration, /ALTER TABLE match_seats ADD COLUMN capability_version/);
  assert.match(deploymentMigration, /CREATE INDEX IF NOT EXISTS match_seats_controller_idx/);
  assert.match(workersBuildGuide, /deploy command[\s\S]*npm run cf:publish/);
  assert.match(actionsTemplate, /npm run cf:publish/);
});
