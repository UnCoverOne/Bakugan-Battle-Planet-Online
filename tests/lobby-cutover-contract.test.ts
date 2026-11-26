import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import test from "node:test";
const source=(p:string)=>readFileSync(p,"utf8");
test("legacy rooms cannot issue game commands or accept controller connections", () => {
  const game = source("app/api/game/route.ts");
  const actions = game.split("const ACTIONS = new Set(")[1].split("]);")[0];
  assert.doesNotMatch(actions, /"(create|join|chat|lobby-settings|lobby-deck|ranked-roster)"/);
  assert.match(game, /if \(!managed\) throw new ConflictError/);
  assert.match(source("lib/lobby-series-access.ts"), /if \(!binding \|\| binding.status !== "active"\) return false/);
});

test("game controller claims are not a substitute for verified membership",()=>{
  assert.match(source("app/api/game/route.ts"),/managedIdentityOwnsSeat\(database,code,playerId,identities.primary\)/);
  assert.match(source("worker/index.ts"),/managedIdentityOwnsSeat\(this.env.DB,code,playerId,identity\)/);
  assert.match(source("lib/lobby-result-server.ts"),/m.identity_key=\?/);
  assert.match(source("lib/lobby-result-server.ts"),/s.membership_id=m.id/);
});
test("Play lobby mounts only the persistent lobby", () => {
  assert.equal(existsSync("app/api/game/active/route.ts"), false);
  assert.equal(existsSync("app/api/game/resume/route.ts"), false);
  assert.match(source("app/(workspace)/play/lobby/page.tsx"), /<ManagedLobby \/>/);
  assert.match(source("package.json"), /npm run audit:lobby/);
});
