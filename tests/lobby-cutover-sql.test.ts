import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE user_data(user_id TEXT PRIMARY KEY); CREATE TABLE matches(code TEXT PRIMARY KEY,state_json TEXT,updated_at INTEGER); CREATE TABLE lobby_series_bindings(match_code TEXT); CREATE TABLE social_hidden_accounts(user_id TEXT PRIMARY KEY);");
  for(const name of ["0006_social.sql","0016_lobby_sessions.sql","0021_lobby_invitations_and_accounts.sql"])db.exec(readFileSync("migrations/"+name,"utf8"));
  for(const id of ["host","guest","other"])db.prepare("INSERT INTO users VALUES(?)").run(id);
  db.prepare("INSERT INTO lobby_sessions(id,code,mode,configuration_json,created_at) VALUES('room','ABC234','casual','{}',100)").run();
  const join=(id:string,identity:string)=>db.prepare("INSERT INTO lobby_memberships(id,lobby_id,identity_key,joined_at,last_seen_at,expires_at) VALUES(?,'room',?,100,100,3600100)").run(id,identity);
  join("h","account:host");
  const invite=(id:string,inviter="host",recipient="guest",hostId="h",code="ABC234")=>db.prepare("INSERT INTO lobby_invitations(id,lobby_code,inviter_user_id,recipient_user_id,status,created_at,expires_at,managed_lobby_id,inviter_membership_id) VALUES(?,?,?,?,'pending',100,600100,'room',?)").run(id,code,inviter,recipient,hostId);
  const state=(id:string)=>db.prepare("SELECT status,accepted_membership_id FROM lobby_invitations WHERE id=?").get(id);
  return{db,join,invite,state};
}
test("managed invite requires the actual open lobby and current host",()=>{
  const {db,invite,join,state}=fixture();
  invite("valid");
  assert.throws(()=>invite("bad","other"),/LOBBY_INVITE_UNAVAILABLE/);
  assert.throws(()=>invite("bad-code","host","guest","h","BAD234"),/LOBBY_INVITE_UNAVAILABLE/);
  join("g","account:guest");
  assert.throws(()=>invite("full","host","other"),/LOBBY_INVITE_UNAVAILABLE/);
  db.prepare("UPDATE lobby_sessions SET current_series_id='series'").run();
  assert.equal(state("valid")?.status,"cancelled");
  db.close();
});
test("host departure cancels pending invitations and account deletion rolls back as a unit",()=>{
  const {db,invite,join,state}=fixture();
  invite("first");
  db.prepare("INSERT INTO user_data VALUES('host')").run();
  db.exec("BEGIN");
  db.prepare("DELETE FROM user_data WHERE user_id='host'").run();
  assert.throws(()=>db.prepare("DELETE FROM users WHERE id='host'").run(),/LOBBY_ACCOUNT_ACTIVE/);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_data").get()?.n,1);
  assert.throws(()=>join("bad","account:missing"),/LOBBY_ACCOUNT_MISSING/);
  db.prepare("UPDATE lobby_memberships SET left_at=200,departure_reason='left' WHERE id='h'").run();
  assert.equal(state("first")?.status,"cancelled");
  db.prepare("DELETE FROM users WHERE id='host'").run();
  db.close();
});
test("actual managed invite admission SQL refuses another guest membership and accepts atomically",()=>{
  const {db,invite,state}=fixture();
  invite("first");
  db.prepare("INSERT INTO lobby_sessions(id,code,mode,configuration_json,created_at) VALUES('other','ABC235','casual','{}',100)").run();
  db.prepare("INSERT INTO lobby_memberships(id,lobby_id,identity_key,joined_at,last_seen_at,expires_at) VALUES('guest-seat','other','guest:browser',100,100,3600100)").run();
  const source=readFileSync("lib/lobby-social-server.ts","utf8");
  const readSql=(prefix:string)=>{
    const start=source.indexOf(prefix);
    assert.ok(start>=0,prefix);
    return source.slice(start,source.indexOf(String.fromCharCode(96),start));
  };
  const admission=db.prepare(readSql("INSERT INTO lobby_memberships("));
  const accept=db.prepare(readSql("UPDATE lobby_invitations SET status='accepted'"));
  const attempt=(membershipId:string,guestKey:string)=>{
    db.exec("BEGIN");
    try{
      admission.run(membershipId,"account:guest",200,200,3600200,"first","guest",200,200,"account:guest",guestKey);
      accept.run(200,membershipId,"first","guest",membershipId,"account:guest");
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
  };
  attempt("blocked","guest:browser");
  assert.equal(state("first")?.status,"pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lobby_memberships WHERE lobby_id='room'").get()?.n,1);
  attempt("joined","");
  assert.equal(state("first")?.status,"accepted");
  assert.equal(state("first")?.accepted_membership_id,"joined");
  attempt("duplicate","");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lobby_memberships WHERE lobby_id='room'").get()?.n,2);
  db.close();
});
test("legacy inventory distinguishes BO3 intermissions, terminal results, malformed and managed rows",()=>{
  const {db}=fixture();
  const base={format:"bo3",phase:"result",players:[{id:"p1"},{id:"p2"}],series:{p1:1,p2:0},winner:"p1"};
  for(const [code,value] of [
    ["partial",base],["complete",{...base,series:{p1:2,p2:0}}],
    ["wrong-winner",{...base,series:{p1:1,p2:2}}],["bad","not JSON"],["bad-players",{...base,players:["garbage"]}],["managed",base],
  ] as const)db.prepare("INSERT INTO matches VALUES(?,?,100)").run(code,typeof value==="string"?value:JSON.stringify(value));
  db.prepare("INSERT INTO lobby_series_bindings VALUES('managed')").run();
  assert.deepEqual(Object.fromEntries(db.prepare("SELECT code,status FROM lobby_legacy_room_inventory").all().map(row=>[row.code,row.status])),{
    partial:"unfinished",complete:"completed","wrong-winner":"unfinished",bad:"unknown","bad-players":"unknown",
  });
  db.close();
});
