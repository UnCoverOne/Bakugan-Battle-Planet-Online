import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { compactReplayCommand, createReplayRecording } from "../lib/engine/replay-codec";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope } from "../lib/engine/types";
import { buildReplayArchiveFromRows } from "../lib/replay-archive-server";
import { buildReplayArchiveFromSnapshotRows } from "../lib/replay-snapshot-recovery";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function readyEnvelope(
  state: ReturnType<typeof initializeMatch>["state"],
  actorId: string,
  index: number,
): CommandEnvelope {
  return {
    commandId: `performance-ready-${index}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_900_000_000_000 + index,
    randomSeed: `performance-seed-${index}`,
    requestHash: `performance-request-${index}`,
    command: { type: "SET_LOBBY_READY", ready: true },
  };
}

test("active MatchState contains no replay recording or accumulated transition history", () => {
  const first = makePlayer("performance-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("performance-b", "Beta", STARTER_DECKS[1]);
  let state = initializeMatch("PERF01", "bo1", [first, second], {
    commandId: "performance-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "performance-create-seed",
    requestHash: "performance-create-request",
  }).state;
  const recording = createReplayRecording(state);
  for (const [index, actorId] of [first.id, second.id].entries()) {
    const envelope = readyEnvelope(state, actorId, index + 1);
    recording.commands.push(compactReplayCommand(envelope));
    state = reduceMatch(state, envelope).state;
  }

  const activeState = JSON.stringify(state);
  assert.equal(activeState.includes("localTransitions"), false);
  assert.equal(activeState.includes("performance-seed-1"), false);
  assert.equal("replay" in (state.__engine ?? {}), false);
  assert.equal(recording.commands.length, 2);
  assert.deepEqual(Object.keys(recording.commands[0]).sort(), ["a", "c", "s", "t"]);
});

test("online replay finalization reuses accepted command events after the gameplay snapshot", () => {
  const first = makePlayer("online-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("online-b", "Beta", STARTER_DECKS[1]);
  let state = initializeMatch("EVENT1", "bo1", [first, second], {
    commandId: "event-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "event-create-seed",
    requestHash: "event-create-request",
  }).state;
  const genesis = structuredClone(state);
  const rows = [];
  for (const [index, actorId] of [first.id, second.id].entries()) {
    const envelope = readyEnvelope(state, actorId, index + 1);
    const result = reduceMatch(state, envelope);
    rows.push({
      command_id: envelope.commandId,
      actor_id: actorId,
      expected_version: envelope.expectedVersion,
      result_version: result.state.version,
      payload_json: JSON.stringify({
        command: envelope.command,
        randomSeed: envelope.randomSeed,
        requestHash: envelope.requestHash,
      }),
      created_at: envelope.issuedAt,
    });
    state = result.state;
  }

  const archive = buildReplayArchiveFromRows(genesis, genesis.version, rows, state, 1_900_000_010_000);
  assert.equal(archive.recording.commands.length, 2);
  assert.equal(buildReplayFrames(archive).frames.at(-1)?.state.version, state.version);

  const damagedRows = rows.map((row, index) => index === 0 ? { ...row, payload_json: "{}" } : row);
  const recovered = buildReplayArchiveFromRows(genesis, genesis.version, damagedRows, state, 1_900_000_010_000);
  assert.equal(recovered.recording.commands.length, 0);
  assert.equal(buildReplayFrames(recovered).frames[0].state.version, state.version);
});

test("periodic snapshots recover retained replay history when a legacy command journal is unusable", () => {
  const first = makePlayer("snapshot-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("snapshot-b", "Beta", STARTER_DECKS[1]);
  const initialized = initializeMatch("SNAP01", "bo1", [first, second], {
    commandId: "snapshot-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "snapshot-create-seed",
    requestHash: "snapshot-create-request",
  }).state;
  const gameplay = structuredClone(initialized);
  gameplay.phase = "placement";
  gameplay.stepLabel = "BakuCore placement 1 / 12";
  gameplay.version = 10;
  const checkpoint = structuredClone(gameplay);
  checkpoint.version = 15;
  checkpoint.placementTurn = 5;
  checkpoint.stepLabel = "BakuCore placement 6 / 12";
  const completed = structuredClone(checkpoint);
  completed.version = 20;
  completed.phase = "result";
  completed.stepLabel = "Match complete";
  completed.winner = first.id;
  completed.resultReason = "Concession";

  const archive = buildReplayArchiveFromSnapshotRows([
    { version: gameplay.version, state_json: JSON.stringify(gameplay), created_at: 1_900_000_001_000 },
    { version: checkpoint.version, state_json: JSON.stringify(checkpoint), created_at: 1_900_000_002_000 },
    { version: completed.version, state_json: JSON.stringify(completed), created_at: 1_900_000_003_000 },
  ], completed, 1_900_000_004_000);
  assert.ok(archive);
  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames.length, 3);
  assert.equal(playback.frames[0].label, "Gameplay begins");
  assert.equal(playback.frames[1].state.placementTurn, 5);
  assert.equal(playback.frames.at(-1)?.state.winner, first.id);
  assert.equal(playback.markers.at(-1)?.type, "result");
  assert.notEqual(playback.frames[0].label, "Recovered final battlefield");
});

test("recording work stays in workers and online finalization stays outside response latency", async () => {
  const [dispatcher, journal, journalWorker, finalization, route, entry, eventStore, theatre, playbackClient] = await Promise.all([
    source("lib/engine/local-command-dispatcher.ts"),
    source("lib/replay-journal.ts"),
    source("lib/replay-journal.worker.ts"),
    source("lib/replay-finalization.ts"),
    source("app/api/game/route.ts"),
    source("worker/index.ts"),
    source("lib/engine/event-store.ts"),
    source("components/replay/ReplayTheatre.tsx"),
    source("lib/replay-playback-client.ts"),
  ]);

  assert.match(dispatcher, /journalLocalReplayCommand\(input, envelope, ownerId\)/);
  assert.doesNotMatch(dispatcher, /structuredClone|JSON\.stringify/);
  assert.match(journal, /new Worker\(new URL\("\.\/replay-journal\.worker\.ts"/);
  assert.match(journalWorker, /REPLAY_JOURNAL_STORE/);
  assert.match(journalWorker, /scheduleFlush\(\)/);
  assert.match(journalWorker, /buildDisplayableReplayArchive/);
  assert.match(journal, /saveCompletedStateFallback/);
  assert.match(journal, /REPLAY_FINALIZATION_TIMEOUT_MS/);
  assert.match(finalization, /buildReplayFrames\(candidate\)/);
  assert.match(finalization, /createReplayRecording\(state\)/);
  assert.match(route, /getRequestExecutionContext\(\)/);
  assert.match(route, /context\.waitUntil\(task\)/);
  assert.match(entry, /runWithExecutionContext/);
  assert.match(eventStore, /enteredGameplay/);
  assert.match(theatre, /reconstructLocalReplay/);
  assert.match(playbackClient, /replay-playback\.worker\.ts/);
});

test("all player-visible local mutation layers route through the command dispatcher", async () => {
  const paths = [
    "components/routes/StreamlinedLobbyRoomScreen.tsx",
    "components/game-screen-v2/GameplayClient.tsx",
    "components/game-screen-v2/BakuCoreLayer.tsx",
    "components/game-screen-v2/ChoiceQueueLayer.tsx",
    "components/game-screen-v2/CorePlacementLayer.tsx",
    "components/game-screen-v2/CoreReturnPlacementLayer.tsx",
    "components/game-screen-v2/DeckInspectionLayer.tsx",
    "components/game-screen-v2/MatchCommunicationLayer.tsx",
    "components/game-screen-v2/MatchDecisionLayer.tsx",
  ];
  const sources = await Promise.all(paths.map(source));
  for (const [index, contents] of sources.entries()) {
    assert.match(contents, /dispatchLocalGame(Action|Command)/, paths[index]);
    assert.doesNotMatch(contents, /appendLocalReplayTransition/, paths[index]);
  }
});

test("record retention is exactly ten for local and server replay stores", async () => {
  const [persistence, localStore, serverStore] = await Promise.all([
    source("lib/persistence.ts"),
    source("lib/replay-local-store.ts"),
    source("lib/replay-archive-server.ts"),
  ]);
  assert.match(persistence, /MAX_MATCH_RECORDS = 10/);
  assert.match(localStore, /slice\(MAX_MATCH_RECORDS\)/);
  assert.match(serverStore, /MATCH_RECORD_RETENTION = 10/);
});
