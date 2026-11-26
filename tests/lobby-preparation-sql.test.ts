import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Test the new migration itself with the narrow schema it extends. The
// previous series-bridge tests separately cover the full activation batch.
function fixture() {
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE lobby_sessions(id TEXT PRIMARY KEY,code TEXT,mode TEXT,configuration_json TEXT,version INTEGER,closed_at INTEGER,current_series_id TEXT,previous_series_id TEXT);
    CREATE TABLE lobby_memberships(id TEXT PRIMARY KEY,lobby_id TEXT,identity_key TEXT,left_at INTEGER,last_seen_at INTEGER,expires_at INTEGER,sequence INTEGER);
    CREATE TABLE lobby_series_bindings(id TEXT,match_code TEXT,lobby_id TEXT,status TEXT);
    CREATE TABLE matches(code TEXT,state_json TEXT);
    CREATE TABLE admin_resources(resource_type TEXT,resource_id TEXT,data_json TEXT);`);
  db.exec(readFileSync("migrations/0019_lobby_preparation.sql","utf8"));
  const config=JSON.stringify({structure:"bo1",format:"standard",meta:"battle-brawlers"});
  const room=(id:string,mode:string)=>db.prepare("INSERT INTO lobby_sessions(id,code,mode,configuration_json,version) VALUES(?,?,?,?,?)").run(id,id,mode,config,1);
  const member=(id:string,lobbyId:string,sequence:number)=>db.prepare("INSERT INTO lobby_memberships VALUES(?,?,?,?,?,?,?)").run(id,lobbyId,"guest:"+id,null,100000,3700000,sequence);
  const prep=(id:string)=>JSON.parse(String(db.prepare("SELECT preparation_json FROM lobby_sessions WHERE id=?").get(id)?.preparation_json));
  const select=(id:string,ids:string[],ai=false)=>db.prepare("UPDATE lobby_sessions SET preparation_json=? WHERE id=?")
    .run(JSON.stringify({members:Object.fromEntries(ids.map(id=>[id,{decks:[{id:"deck-"+id}],ready:true}])),aiDeck:ai?{id:"bot"}:null,ruleset:null}),id);
  const start=(id:string,version:number)=>db.prepare(`INSERT INTO lobby_training_series
    (id,lobby_id,membership_id,start_command_id,expected_lobby_version,identity_key,state_json,status,created_at)
    VALUES(?,?,?,?,?,?,?,'active',?)`).run(id,"training","m",id,version,"guest:m",JSON.stringify({id,lobbyMode:"training",format:"bo1"}),130001);
  const active=()=>db.prepare("SELECT current_series_id,previous_series_id FROM lobby_sessions WHERE id='training'").get();
  return {db,room,member,prep,select,start,active};
}
test("reconnection, local Training readiness, completion and departure preserve the lifecycle",()=>{
  const {db,room,member,prep,select,start,active}=fixture();
  room("training","training");member("m","training",1);select("training",["m"],true);
  db.prepare("UPDATE lobby_memberships SET last_seen_at=130000 WHERE id='m'").run();
  assert.equal(prep("training").members.m.ready,false);
  assert.equal(prep("training").members.m.decks[0].id,"deck-m");
  assert.throws(()=>start("unready",2),/LOBBY_TRAINING_START_CONFLICT/);
  select("training",["m"],true);start("first",2);
  assert.equal(active()?.current_series_id,"first");
  db.prepare("UPDATE lobby_training_series SET status='completed' WHERE id='first'").run();
  assert.equal(active()?.current_series_id,null);
  assert.equal(active()?.previous_series_id,"first");
  assert.equal(prep("training").members.m.ready,false);
  assert.equal(prep("training").aiDeck.id,"bot");
  select("training",["m"],true);start("second",4);
  db.prepare("UPDATE lobby_memberships SET left_at=140000 WHERE id='m'").run();
  assert.equal(db.prepare("SELECT status FROM lobby_training_series WHERE id='second'").get()?.status,"abandoned");
  assert.equal(active()?.current_series_id,null);
  assert.deepEqual(prep("training").members,{});
  db.close();
});
test("online activation requires both prepared and ready seats",()=>{
  const {db,room,member,select}=fixture();
  room("online","casual");member("a","online",1);member("b","online",2);
  db.prepare("INSERT INTO matches VALUES(?,?)").run("XYZ234",JSON.stringify({lobbyMode:"casual",lobbyRulesFormat:"standard",lobbyMeta:"battle-brawlers"}));
  db.prepare("INSERT INTO lobby_series_bindings VALUES(?,?,?,?)").run("series","XYZ234","online","initializing");
  assert.throws(()=>db.prepare("UPDATE lobby_series_bindings SET status='active'").run(),/LOBBY_PREPARATION_CHANGED/);
  select("online",["a","b"]);
  db.prepare("UPDATE lobby_series_bindings SET status='active'").run();
  assert.equal(db.prepare("SELECT status FROM lobby_series_bindings").get()?.status,"active");
  db.close();
});
