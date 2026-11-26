import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLobbySessionService } from "../lib/lobby-session-server";
import { LOBBY_MEMBERSHIP_TTL_MS, lobbyPresence, lobbyPrimaryAction, type LobbyIdentity } from "../lib/lobby-session";

const alice: LobbyIdentity = { kind: "account", id: "alice" };
const bob: LobbyIdentity = { kind: "account", id: "bob" };
const carol: LobbyIdentity = { kind: "guest", id: "carol" };
const configuration = { structure: "bo1", format: "standard", meta: "battle-brawlers" } as const;
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync("migrations/0016_lobby_sessions.sql", "utf8"));
  sql.exec(readFileSync("migrations/0017_lobby_guest_identity.sql", "utf8"));
  let time = 100000, counter = 0;
  function prepare(query: string) {
    let values: (string | number | null)[] = [];
    const stmt = sql.prepare(query);
    const wrapper = {
      bind(...args: typeof values) { values = args; return wrapper; },
      async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; },
      async first() { return stmt.get(...values) ?? null; },
    };
    return wrapper;
  }
  const database = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sql.exec("BEGIN IMMEDIATE");
      try { const results = []; for (const stmt of statements) results.push(await stmt.run()); sql.exec("COMMIT"); return results; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { sql, service: createLobbySessionService(database, () => time, () => `id-${++counter}`), advance(ms: number) { time += ms; }, now: () => time };
}
test("membership uniqueness rolls back room creation; capacity and ranked account rules are enforced", async () => {
  const { sql, service } = fixture();
  const a = await service.create(alice, "casual", "ABC234", configuration);
  await assert.rejects(service.create(alice, "training", "ABC235", configuration), /UNIQUE/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lobby_sessions").get()?.n, 1);
  await service.join(bob, a.lobbyId);
  await assert.rejects(service.join(carol, a.lobbyId), /LOBBY_FULL/);
  const ranked = { ...configuration, structure: "bo3", format: "competitive" } as const;
  await assert.rejects(service.create(carol, "ranked", "ABC236", ranked), /LOBBY_ACCOUNT_REQUIRED/);
  assert.equal((await service.read(alice))?.members.length, 2);
  assert.equal(await service.read(carol), null);
});
test("heartbeat, expiry boundary, succession, closure and stale membership IDs", async () => {
  const { service, advance, now } = fixture();
  const a = await service.create(alice, "casual", "ABC234", configuration);
  const b = await service.join(bob, a.lobbyId);
  advance(30000);
  assert.equal(lobbyPresence((await service.activeMembership(alice))!, now()), "disconnected");
  assert.equal(await service.heartbeat(bob, b.membershipId), true);
  advance(LOBBY_MEMBERSHIP_TTL_MS - 30000);
  assert.equal(await service.heartbeat(alice, a.membershipId), false);
  assert.equal(await service.expire(), 1);
  assert.equal(await service.read(alice), null);
  assert.equal((await service.read(bob))?.hostMemberId, b.membershipId);
  assert.equal(await service.leave(bob, b.membershipId), true);
  assert.equal(await service.leave(bob, b.membershipId), false);
  await assert.rejects(service.join(carol, a.lobbyId), /LOBBY_NOT_JOINABLE/);
  const c = await service.create(bob, "training", "ABC235", configuration);
  assert.equal(await service.heartbeat(bob, b.membershipId), false);
  assert.equal(await service.heartbeat(alice, c.membershipId), false);
  assert.equal((await service.read(bob))?.id, c.lobbyId);
});
test("series references never determine membership and active-series joins are blocked", async () => {
  const { sql, service } = fixture();
  const a = await service.create(alice, "casual", "ABC234", configuration);
  sql.prepare("UPDATE lobby_sessions SET current_series_id = ? WHERE id = ?").run("series-1", a.lobbyId);
  assert.equal((await service.read(alice))?.currentSeriesId, "series-1");
  await assert.rejects(service.join(bob, a.lobbyId), /LOBBY_NOT_JOINABLE/);
  assert.equal(await service.leave(alice, a.membershipId), false);
  assert.equal(lobbyPrimaryAction(true, false), "return-to-game");
  sql.prepare("UPDATE lobby_sessions SET current_series_id = NULL, previous_series_id = ? WHERE id = ?").run("series-1", a.lobbyId);
  assert.equal((await service.read(alice))?.previousSeriesId, "series-1");
  assert.equal(lobbyPrimaryAction(false, true), "start-game");
  assert.equal(await service.leave(alice, a.membershipId), true);
});

test("admission receipts survive departure and do not open a second room", async () => {
  const { sql, service } = fixture();
  const admission = { commandId: "create-1", requestKey: "create:casual:bo1" };
  const a = await service.create(alice, "casual", "ABC234", configuration, admission);
  assert.deepEqual(await service.create(alice, "casual", "ABC235", configuration, admission), a);
  await assert.rejects(service.create(alice, "casual", "ABC235", configuration, { ...admission, requestKey: "different" }), /LOBBY_COMMAND_REUSED/);
  const b = await service.joinByCode(bob, "ABC234", "join-1");
  assert.equal(await service.leave(bob, b.membershipId), true);
  assert.equal(await service.leave(alice, a.membershipId), true);
  assert.deepEqual(await service.joinByCode(bob, "ABC234", "join-1"), b);
  assert.deepEqual(await service.create(alice, "casual", "ABC235", configuration, admission), a);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lobby_sessions").get()?.n, 1);
  assert.equal(await service.activeMembership(alice), null);
});
test("guest adoption preserves membership and rejects an occupied account", async () => {
  const { service } = fixture();
  const g = await service.create(carol, "training", "ABC234", configuration);
  const a = await service.create(alice, "casual", "ABC235", configuration);
  assert.equal(await service.adoptGuest(carol, alice, g.membershipId), false);
  assert.equal(await service.leave(alice, a.membershipId), true);
  assert.equal(await service.adoptGuest(carol, alice, g.membershipId), true);
  assert.equal(await service.activeMembership(carol), null);
  assert.equal((await service.activeMembership(alice))?.id, g.membershipId);
  assert.equal(await service.heartbeat(carol, g.membershipId), false);
});
test("expired active series are reserved pending settlement, not silently removed", async () => {
  const { sql, service, advance } = fixture();
  const a = await service.create(alice, "casual", "ABC234", configuration);
  sql.prepare("UPDATE lobby_sessions SET current_series_id = ? WHERE id = ?").run("series", a.lobbyId);
  advance(LOBBY_MEMBERSHIP_TTL_MS);
  assert.equal(await service.expire(), 0);
  assert.equal(await service.heartbeat(alice, a.membershipId), false);
  assert.equal((await service.activeMembership(alice))?.id, a.membershipId);
  assert.equal(await service.leave(alice, a.membershipId), false);
});
