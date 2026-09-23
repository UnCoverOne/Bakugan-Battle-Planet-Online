import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, type DeckRecord } from "../lib/data";
import { createTrainingLobbyState, syncTrainingBotForLobby } from "../lib/training-lobby";
import { archiveReplayRecording, compactReplayCommand, createReplayRecording, replayStateHash } from "../lib/engine/replay-codec";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope, GameCommand } from "../lib/engine/types";
import {
  createOpponentAiWorkerAsync,
  opponentAiWorkerReadyResponse,
  serializeOpponentAiWorkerError,
} from "../lib/opponentAiWorkerProtocol";

test("Training lobby uses the administrator-selected AI deck instead of the built-in fallback", () => {
  const selectedAiDeck: DeckRecord = {
    ...STARTER_DECKS[0],
    id: "admin-selected-training-ai",
    name: "Administrator Selected AI",
    factions: [...STARTER_DECKS[0].factions],
    bakuganIds: [...STARTER_DECKS[0].bakuganIds],
    coreIds: [...STARTER_DECKS[0].coreIds],
    cardIds: [...STARTER_DECKS[0].cardIds],
    tags: [...(STARTER_DECKS[0].tags ?? [])],
  };
  const state = createTrainingLobbyState(
    "TRAIN2",
    "bo1",
    "player-1",
    "Player 1",
    STARTER_DECKS[1],
    selectedAiDeck,
  );
  const bot = state.players.find((player) => player.id === "training-bot");
  assert.ok(bot);
  assert.deepEqual(
    bot.bakugan.map((bakugan) => bakugan.character.catalogId),
    selectedAiDeck.bakuganIds,
  );
  assert.equal((state as typeof state & { trainingAiDeck?: DeckRecord }).trainingAiDeck?.id, selectedAiDeck.id);
});

test("Training lobby keeps its selected AI source deck when the bot is resynchronised", () => {
  const selectedAiDeck: DeckRecord = {
    ...STARTER_DECKS[0],
    id: "admin-selected-training-ai",
    name: "Administrator Selected AI",
    factions: [...STARTER_DECKS[0].factions],
    bakuganIds: [...STARTER_DECKS[0].bakuganIds],
    coreIds: [...STARTER_DECKS[0].coreIds],
    cardIds: [...STARTER_DECKS[0].cardIds],
    tags: [...(STARTER_DECKS[0].tags ?? [])],
  };
  let state = createTrainingLobbyState("TRAIN3", "bo1", "player-1", "Player 1", STARTER_DECKS[1], selectedAiDeck);
  state = syncTrainingBotForLobby(state);
  const bot = state.players.find((player) => player.id === "training-bot");
  assert.ok(bot);
  assert.deepEqual(
    bot.bakugan.map((bakugan) => bakugan.character.catalogId),
    selectedAiDeck.bakuganIds,
  );
});

test("the current Training lobby path starts a reconstructable replay when gameplay begins", () => {
  let state = createTrainingLobbyState(
    "REPLAY",
    "bo1",
    "player-1",
    "Player 1",
    STARTER_DECKS[0],
    STARTER_DECKS[1],
  );
  const recording = createReplayRecording(state);
  const apply = (actorId: string, command: GameCommand, index: number) => {
    const envelope: CommandEnvelope = {
      commandId: `training-replay-${index}`,
      gameId: state.id,
      actorId,
      expectedVersion: state.version,
      issuedAt: 1_900_000_000_000 + index,
      randomSeed: `training-seed-${index}`,
      requestHash: `training-request-${index}`,
      command,
    };
    recording.commands.push(compactReplayCommand(envelope));
    state = reduceMatch(state, envelope).state;
  };
  apply("player-1", { type: "SET_LOBBY_READY", ready: true }, 1);
  apply("player-1", { type: "START_MATCH" }, 2);

  const metadata = (state as typeof state & { __engine?: Record<string, unknown> }).__engine;
  assert.equal("replay" in (metadata ?? {}), false);
  const archive = archiveReplayRecording(recording, state, 1_900_000_010_000);
  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames.length, 3);
  assert.equal(replayStateHash(playback.frames.at(-1)!.state), archive.finalStateHash);
});

test("Match Creation clears completed-session state before opening another lobby and loads AI selection from the server", async () => {
  const creation = await readFile(new URL("../components/routes/MatchCreationScreen.tsx", import.meta.url), "utf8");
  assert.match(creation, /resetPreviousSession/);
  assert.match(creation, /primeMatchStore\(\{ route: "play", match: null, online: false/);
  assert.match(creation, /setMatch\(null\)/);
  assert.match(creation, /fetch\("\/api\/ai-decks", \{ cache: "no-store" \}\)/);
  assert.match(creation, /createTrainingLobbyState\([\s\S]*result\.deck\)/);
  assert.doesNotMatch(creation, /matchError/);
});

test("AI deck endpoint only chooses enabled legal administrator resources", async () => {
  const route = await readFile(new URL("../app/api/ai-decks/route.ts", import.meta.url), "utf8");
  const administration = await readFile(new URL("../lib/administration-server.ts", import.meta.url), "utf8");
  assert.match(route, /selectEnabledLegalAiDeck\(database\)/);
  assert.match(administration, /item\.enabled && validateDeck\(item\.deck\)\.isLegal/);
  assert.doesNotMatch(route, /randomAiDeck/);
  assert.doesNotMatch(route, /STARTER_DECKS/);
});


test("Training AI gateway journals Worker failures and retries the tactical planner before primitive recovery", async () => {
  const client = await readFile(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../components/game-screen-v2/opponentAi.worker.ts", import.meta.url), "utf8");
  const protocol = await readFile(new URL("../lib/opponentAiWorkerProtocol.ts", import.meta.url), "utf8");

  assert.match(client, /withOpponentAiRecoveryDiagnostic/);
  assert.match(client, /worker-preflight/);
  assert.match(client, /worker-timeout/);
  assert.match(client, /trainingWorkerPlacementId/);
  assert.match(client, /storedState\.match\?\.phase === "placement"/);
  assert.match(client, /\|\| match\.phase === "startingPlayer"/);
  assert.match(client, /requestOpponentAiDecision\(latest, "training-bot", true\)/);
  assert.match(client, /fresh-worker-recovered/);
  assert.match(client, /await import\("\.\.\/\.\.\/lib\/opponentAi"\)/);
  assert.match(client, /decision \? `strategic:\$\{command\.type\}` : `primitive:\$\{command\.type\}`/);
  assert.match(worker, /event\.data\.type === "ping"/);
  assert.match(worker, /opponentAiWorkerReadyResponse\(event\.data\.requestId\)/);
  assert.match(worker, /decideOpponentAiWorkerRequest\(event\.data\)/);
  assert.match(protocol, /stack\?: string/);
  assert.match(protocol, /matchVersion: match\.version/);
});

test("Training AI Worker protocol exposes READY and structured failure diagnostics", () => {
  assert.deepEqual(opponentAiWorkerReadyResponse(17), {
    requestId: 17,
    ready: true,
  });

  const cause = new TypeError("forecast exploded");
  const failure = serializeOpponentAiWorkerError(cause, {
    stage: "decision",
    matchId: "MATCH-17",
    matchVersion: 42,
    phase: "selection",
    playerId: "training-bot",
  });
  assert.equal(failure.name, "TypeError");
  assert.equal(failure.message, "forecast exploded");
  assert.match(failure.stack ?? "", /TypeError: forecast exploded/);
  assert.deepEqual(failure.context, {
    stage: "decision",
    matchId: "MATCH-17",
    matchVersion: 42,
    phase: "selection",
    playerId: "training-bot",
  });
});


test("Training AI Worker construction failures reject instead of escaping startup", async () => {
  await assert.rejects(
    createOpponentAiWorkerAsync(() => {
      throw new DOMException("Worker construction blocked", "SecurityError");
    }),
    (cause: unknown) => (
      cause instanceof DOMException
      && cause.name === "SecurityError"
      && cause.message === "Worker construction blocked"
    ),
  );
});

test("Training startup remains independent from Worker preflight and READY timeout", async () => {
  const client = await readFile(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");

  const startupEffect = client.indexOf('match?.phase !== "startingPlayer"');
  const placementPrewarm = client.indexOf('storedState.match?.phase === "placement"');
  const tacticalStartingPlayerGuard = client.indexOf('|| match.phase === "startingPlayer"');
  const readyTimeout = client.indexOf("OPPONENT_AI_WORKER_READY_TIMEOUT_MS");

  assert.ok(startupEffect >= 0);
  assert.ok(placementPrewarm >= 0);
  assert.ok(tacticalStartingPlayerGuard >= 0);
  assert.ok(readyTimeout >= 0);
  assert.match(client.slice(startupEffect, startupEffect + 2_000), /await beginPlacement\(\)/);
  assert.match(client, /WorkerReadyTimeout/);
});
