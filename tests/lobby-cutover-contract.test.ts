import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import test from "node:test";
const source=(p:string)=>readFileSync(p,"utf8");
test("managed invitations and ordinary admission share the legacy inventory gate",()=>{
  assert.match(source("lib/lobby-session-commands.ts"),/await assertLobbyAdmissionCutover\(database\)/);
  assert.match(source("lib/lobby-social-server.ts"),/await assertLobbyAdmissionCutover\(db\)/);
  assert.match(source("lib/lobby-cutover-server.ts"),/lobby_legacy_room_inventory/);
  assert.match(source("lib/lobby-cutover.ts"),/LEGACY_LOBBY_CREATION_CLOSED = false/);
  assert.match(source("lib/lobby-cutover.ts"),/PERSISTENT_LOBBY_ENABLED = false/);
});
test("game controller claims are not a substitute for verified membership",()=>{
  assert.match(source("app/api/game/route.ts"),/managedIdentityOwnsSeat\(database,code,playerId,identities.primary\)/);
  assert.match(source("worker/index.ts"),/managedIdentityOwnsSeat\(this.env.DB,code,playerId,identity\)/);
  assert.match(source("lib/lobby-result-server.ts"),/m.identity_key=\?/);
  assert.match(source("lib/lobby-result-server.ts"),/s.membership_id=m.id/);
});
test("obsolete duplicate is removed and remaining fallback is deliberate",()=>{
  assert.equal(existsSync("components/routes/"+["Lobby","RoomScreen.tsx"].join("")),false);
  assert.equal(existsSync("components/routes/"+["Lobby","RoomScreen.module.css"].join("")),false);
  assert.match(source("app/(workspace)/play/lobby/page.tsx"),/StreamlinedLobbyRoomScreen/);
  assert.match(source("package.json"),/npm run audit:lobby/);
});
