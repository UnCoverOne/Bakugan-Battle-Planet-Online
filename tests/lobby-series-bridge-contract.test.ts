import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("managed engine creation has one transaction for state, seats and binding activation", () => {
  const persistence = source("lib/engine/event-store.ts");
  const bridge = source("lib/lobby-series-bridge.ts");
  const migration = source("migrations/0018_lobby_series_bridge.sql");
  assert.match(persistence, /managed\?\.statements/);
  assert.match(bridge, /persistInitialMatch\(database, state, events, receipt, undefined, \{ seats: input.seats, statements \}\)/);
  assert.match(migration, /LOBBY_SERIES_START_CONFLICT/);
  assert.match(migration, /lobby_one_active_series/);
  assert.match(migration, /NEW\.match_code <> l\.code/);
});
test("series-forfeit command is internal and completion follows archival", () => {
  const reducer = source("lib/engine/reducer.ts");
  const publicRoute = source("app/api/game/route.ts");
  const bridge = source("lib/lobby-series-bridge.ts");
  assert.match(reducer, /case "FORFEIT_SERIES":/);
  assert.match(reducer, /actorId !== "system"/);
  assert.doesNotMatch(publicRoute, /"forfeit-series"/);
  assert.ok(bridge.indexOf("await archiveCompletedMatch(database, state)") < bridge.indexOf("UPDATE lobby_series_bindings SET status = 'completed'"));
});

test("managed seats are fenced and maintenance is serialized", () => {
  const auth = source("lib/match-seat-auth.ts");
  const access = source("lib/lobby-series-access.ts");
  const worker = source("worker/index.ts");
  assert.match(auth, /managedSeatAllowed\(database, code, playerId\)/);
  assert.match(access, /m.expires_at > \?/);
  assert.match(access, /lobby_series_departures/);
  assert.match(worker, /url.pathname === "\/lobby-maintenance"[\s\S]*withSessionMutation/);
  assert.match(worker, /url.pathname === "\/lobby-departure"[\s\S]*withSessionMutation/);
  assert.match(worker, /await finalizeManagedSeries\(this.env.DB, match.code\)/);
  assert.match(source("wrangler.jsonc"), /"\* \* \* \* \*"/);
});
