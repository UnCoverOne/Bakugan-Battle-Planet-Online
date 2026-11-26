import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = (name: string) => readFileSync("migrations/" + name, "utf8");
const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(migration("0001_initial.sql"));
  sql.exec(`CREATE TABLE match_seats (code TEXT NOT NULL, player_id TEXT NOT NULL,
    capability_hash TEXT NOT NULL, capability_version INTEGER NOT NULL DEFAULT 1,
    controller_id TEXT, PRIMARY KEY (code,player_id))`);
  sql.exec(migration("0016_lobby_sessions.sql"));
  sql.exec(migration("0018_lobby_series_bridge.sql"));
  sql.prepare("INSERT INTO lobby_sessions (id,code,mode,configuration_json,created_at) VALUES (?,?,?,?,?)")
    .run("lobby", "ABC234", "casual", '{"structure":"bo3","format":"standard","meta":"battle-brawlers"}', 100000);
  for (const id of ["a", "b"]) sql.prepare("INSERT INTO lobby_memberships (id,lobby_id,identity_key,joined_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?)")
    .run(id, "lobby", "account:" + id, 100000, 100000, 3700000);
  const state = (id: string, version = 1, phase = "lobby", winner = "", series = { p1: 0, p2: 0 }) =>
    JSON.stringify({ id, version, phase, winner, format: "bo3", series, players: [{ id: "p1" }, { id: "p2" }] });
  const start = (id: string, code: string, version = 3, host = "a", now = 100100) => {
    sql.exec("BEGIN IMMEDIATE");
    try {
      sql.prepare("INSERT INTO matches (code,state_json,updated_at) VALUES (?,?,?)").run(code, state(id), now);
      for (const player of ["p1","p2"]) {
        sql.prepare("INSERT INTO match_seats VALUES (?,?,?,1,?)").run(code,player,"old","controller");
        sql.prepare("INSERT INTO match_presence VALUES (?,?,?,1)").run(code,player,now);
      }
      sql.prepare(`INSERT INTO lobby_series_bindings
        (id,lobby_id,match_code,start_command_id,host_member_id,host_identity_key,expected_lobby_version,status,created_at)
        VALUES (?,?,?,?,?,?,?,'initializing',?)`).run(id,"lobby",code,id,host,"account:"+host,version,now);
      sql.prepare("INSERT INTO lobby_series_seats VALUES (?,?,?)").run(id,"a","p1");
      sql.prepare("INSERT INTO lobby_series_seats VALUES (?,?,?)").run(id,"b","p2");
      sql.prepare("UPDATE lobby_series_bindings SET status='active' WHERE id=?").run(id);
      sql.exec("COMMIT");
    } catch (error) { sql.exec("ROLLBACK"); throw error; }
  };
  const complete = (id: string, version: number) => sql.prepare("UPDATE lobby_series_bindings SET status='completed',completed_at=200000,final_version=? WHERE id=?").run(version,id);
  const room = () => sql.prepare("SELECT code,version,current_series_id,previous_series_id,closed_at FROM lobby_sessions").get();
  return { sql, state, start, complete, room };
};

test("a stale or non-host start rolls back the engine snapshot, while one valid series attaches", () => {
  const { sql,start,room } = fixture();
  assert.throws(() => start("bad","ABC235",3,"b"), /LOBBY_SERIES_START_CONFLICT/);
  assert.throws(() => start("stale","ABC236",2), /LOBBY_SERIES_START_CONFLICT/);
  assert.throws(() => start("offline","ABC237",3,"a",130000), /LOBBY_SERIES_START_CONFLICT/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM matches").get()?.n, 0);
  start("one","ABC238");
  assert.equal(room()?.current_series_id, "one");
  assert.equal(room()?.code, "ABC234");
  assert.throws(() => start("two","ABC239",4), /UNIQUE/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM matches").get()?.n, 1);
  sql.close();
});

test("series completion cannot be confused with an individual game result", () => {
  const { sql,start,state,complete,room } = fixture();
  start("one","ABC235");
  assert.throws(() => complete("one",1), /LOBBY_SERIES_NOT_COMPLETE/);
  sql.prepare("UPDATE matches SET state_json=? WHERE code=?").run(state("one",2,"result","p1",{p1:1,p2:0}),"ABC235");
  assert.throws(() => complete("one",2), /LOBBY_SERIES_NOT_COMPLETE/);
  sql.prepare("UPDATE matches SET state_json=? WHERE code=?").run(state("one",3,"result","p1",{p1:2,p2:0}),"ABC235");
  complete("one",3);
  assert.equal(room()?.current_series_id, null);
  assert.equal(room()?.previous_series_id, "one");
  assert.equal(room()?.closed_at, null);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lobby_memberships WHERE left_at IS NULL").get()?.n, 2);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM match_seats WHERE capability_version=2 AND controller_id IS NULL").get()?.n, 2);
  start("two","ABC236",5);
  sql.prepare("INSERT INTO lobby_series_departures VALUES (?,?,?,?)").run("two","a","left",200000);
  sql.prepare("UPDATE matches SET state_json=? WHERE code=?").run(state("two",2,"result","p2",{p1:0,p2:2}),"ABC236");
  complete("two",2);
  assert.equal(room()?.code,"ABC234");
  assert.equal(room()?.previous_series_id,"two");
  assert.equal(room()?.closed_at,null);
  assert.equal(sql.prepare("SELECT departure_reason FROM lobby_memberships WHERE id='a'").get()?.departure_reason,"left");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lobby_memberships WHERE left_at IS NULL").get()?.n,1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM matches").get()?.n,2);
  sql.close();
});
