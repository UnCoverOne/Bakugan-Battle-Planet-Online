import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canRevealOpponentAiCards,
  TRAINING_AI_PLAYER_ID,
} from "../lib/admin-ai-visibility";
import type { MatchState } from "../lib/game";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function matchWithOpponent(opponentId: string) {
  return {
    players: [
      { id: "viewer", hand: [], energyZone: [] },
      { id: opponentId, hand: [], energyZone: [] },
    ],
  } as unknown as MatchState;
}

const administrator = { id: "admin", roles: ["administrator"] };
const ordinaryUser = { id: "user", roles: [] };

test("only an Administrator may reveal the local Training AI cards", () => {
  const trainingMatch = matchWithOpponent(TRAINING_AI_PLAYER_ID);
  assert.equal(canRevealOpponentAiCards(trainingMatch, "viewer", ordinaryUser, true), false);
  assert.equal(canRevealOpponentAiCards(trainingMatch, "viewer", administrator, false), false);
  assert.equal(canRevealOpponentAiCards(matchWithOpponent("human-opponent"), "viewer", administrator, true), false);
  assert.equal(canRevealOpponentAiCards(trainingMatch, "viewer", administrator, true), true);
});

test("the visibility preference is stored and mutated only through the protected Administrator API", async () => {
  const [api, server, accounts] = await Promise.all([
    read("app/api/admin/route.ts"),
    read("lib/administration-server.ts"),
    read("lib/account-server.ts"),
  ]);
  assert.match(api, /const administrator = await requireAdministrator\(request\)/);
  assert.match(api, /section === "ai-visibility"/);
  assert.match(api, /action === "ai-visibility"/);
  assert.match(api, /getAdministratorAiVisibility\(db, administrator\.id\)/);
  assert.match(api, /setAdministratorAiVisibility\(\s*db,\s*administrator\.id/);
  assert.match(server, /"administrator-ai-visibility"/);
  assert.match(server, /ADMINISTRATOR_AI_VISIBILITY_RESOURCE,\s*administratorId,\s*value/);
  assert.match(accounts, /Administrator access is required/);
});

test("AI Management exposes the Administrator-only reveal switch", async () => {
  const [screen, hook] = await Promise.all([
    read("components/routes/AdminScreen.tsx"),
    read("components/application/useAdministratorAiVisibility.ts"),
  ]);
  assert.match(screen, /Reveal Training AI hidden cards/);
  assert.match(screen, /role="switch"/);
  assert.match(screen, /action: "ai-visibility"/);
  assert.match(screen, /notifyAdministratorAiVisibilityChanged/);
  assert.match(hook, /accountIsAdministrator\(authUser\)/);
  assert.match(hook, /\/api\/admin\?section=ai-visibility/);
  assert.match(hook, /canRevealOpponentAiCards/);
});

test("Training AI hand and Energy faces render only through the protected visibility hook", async () => {
  const [hand, screen] = await Promise.all([
    read("components/game-screen-v2/CardHandLayer.tsx"),
    read("components/game-screen-v2/GameScreen.tsx"),
  ]);
  assert.match(hand, /useAdministratorAiVisibility\(match, playerId\)/);
  assert.match(hand, /src=\{faceUp \? card!\.art : CARD_BACK_ART\}/);
  assert.match(hand, /data-hidden=\{revealFaces \? "false" : "true"\}/);
  assert.match(screen, /useAdministratorAiVisibility\(match, playerId\)/);
  assert.match(screen, /revealEnergyFaces=\{revealOpponentAiCards\}/);
  assert.match(screen, /faceVisible = revealFaces \|\| temporaryRevealCardIds\?\.has\(card\.id\) === true/);
  assert.match(screen, /faceVisible \? card\.art : CARD_BACK_ART/);
});


test("match engine-history download is exposed only to Administrators and uses the protected server stream", async () => {
  const [menu, client, api, exporter] = await Promise.all([
    read("components/game-screen-v2/GameMenuHud.tsx"),
    read("components/game-screen-v2/GameplayClient.tsx"),
    read("app/api/admin/route.ts"),
    read("lib/admin-engine-history-server.ts"),
  ]);
  assert.match(menu, /administrator && onDownloadLog/);
  assert.match(menu, /Download Log/);
  assert.match(client, /accountIsAdministrator\(authUser\)/);
  assert.match(client, /section=match-engine-history/);
  assert.match(api, /const administrator = await requireAdministrator\(request\)/);
  assert.match(api, /section === "match-engine-history"/);
  assert.match(api, /loadAdministratorMatchEngineHistory\(db, code\.toUpperCase\(\), administrator\.id\)/);
  assert.match(exporter, /FROM match_commands WHERE code = \?/);
  assert.match(exporter, /FROM match_events WHERE code = \?/);
  assert.match(exporter, /FROM engine_observations WHERE code = \? OR code = \?/);
  assert.match(exporter, /FROM match_snapshots WHERE code = \?/);
});

test("local Download Log waits for queued engine transitions before reading the journal", async () => {
  const [client, journal, worker] = await Promise.all([
    read("components/game-screen-v2/GameplayClient.tsx"),
    read("lib/replay-journal.ts"),
    read("lib/replay-journal.worker.ts"),
  ]);
  assert.match(client, /await flushLocalReplayJournalAndWait\(\)/);
  assert.match(client, /loadLocalReplayHistory\(match\.id\)/);
  assert.match(journal, /type: "flush"; requestId\?: number/);
  assert.match(journal, /pendingFlushes/);
  assert.match(worker, /message\.requestId != null/);
  assert.match(worker, /type: "flush", requestId: message\.requestId, ok: true/);
});
