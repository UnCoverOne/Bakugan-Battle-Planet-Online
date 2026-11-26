import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const source=(p:string)=>readFileSync(p,"utf8");
test("Play admits players through the lobby session API", () => {
  const play = source("components/routes/MatchCreationScreen.tsx");
  const provider = source("components/application/LobbySessionProvider.jsx");
  assert.match(play, /lobbySession\.command\(/);
  assert.match(provider, /fetch\("\/api\/lobby\/session"/);
  assert.doesNotMatch(play, /\/api\/game/);
});

test("controller claims are membership-scoped and serialized",()=>{
  const controller=source("lib/lobby-controller-server.ts");
  assert.match(controller,/m.id=\? AND m.identity_key=\? AND m.left_at IS NULL AND m.expires_at>\?/);
  assert.match(controller,/capability_version=capability_version\+1/);
  assert.match(controller,/hasActiveSocket\(seat.player_id,seat.capability_version\)&&body.takeover!==true/);
  const worker=source("worker/index.ts");
  assert.match(worker,/url.pathname === "\/lobby-claim"[\s\S]*withSessionMutation/);
  assert.match(worker,/claimManagedController\(this.env.DB,request,identities.primary/);
});
test("navigation and checkpoint synchronization live outside gameplay routes",()=>{
  const layout=source("app/layout.tsx"),provider=source("components/application/LobbySessionProvider.jsx");
  assert.match(layout,/<LobbySessionProvider><LobbyChatProvider><AppShell>/);
  assert.match(provider,/HEARTBEAT_MS=12000/);
  assert.match(provider,/action:"heartbeat",membershipId:current.membership.id/);
  assert.match(provider,/expectedRevision:saved.revision/);
  assert.match(provider,/saved.blocked=true/);
  assert.match(provider,/returnToLobby=useCallback\(async\(\)=>\{await flushTraining\(\);router.push\("\/play\/lobby"\)/);
});
