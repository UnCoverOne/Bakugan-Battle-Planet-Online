import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { compactReplayCommand, createReplayRecording } from "../lib/engine/replay-codec";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope } from "../lib/engine/types";
import { compileLocalReplayHistory, createLocalEngineHistoryDraft } from "../lib/local-replay-history";
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

test("online replay finalization preserves valid frames when a later command is damaged", () => {
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

  const damagedRows = rows.map((row, index) => index === 1 ? { ...row, payload_json: "{}" } : row);
  const recovered = buildReplayArchiveFromRows(genesis, genesis.version, damagedRows, state, 1_900_000_010_000);
  const recoveredPlayback = buildReplayFrames(recovered);
  assert.equal(recovered.recording.commands.length, 1);
  assert.equal(recoveredPlayback.frames.length, 3);
  assert.equal(recoveredPlayback.frames[0].state.version, genesis.version);
  assert.equal(recoveredPlayback.frames[1].state.version, rows[0].result_version);
  assert.equal(recoveredPlayback.frames.at(-1)?.state.version, state.version);
  assert.equal(recoveredPlayback.frames.at(-1)?.label, "Replay gap — recovered final battlefield");
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

test("completed local engine history compiles exact replay patches only when requested", () => {
  const first = makePlayer("lazy-local-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("lazy-local-b", "Training AI", STARTER_DECKS[1]);
  let state = initializeMatch("LAZY01", "bo1", [first, second], {
    commandId: "lazy-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "lazy-create-seed",
    requestHash: "lazy-create-request",
  }).state;
  const draft = createLocalEngineHistoryDraft(state, first.id, 1_900_000_000_000);
  for (const [index, actorId] of [first.id, second.id].entries()) {
    const envelope = readyEnvelope(state, actorId, index + 1);
    const result = reduceMatch(state, envelope);
    assert.equal(result.changed, true);
    draft.transitions.push({ envelope, resultVersion: result.state.version, events: result.events });
    state = result.state;
  }
  draft.finalState = state;
  draft.completedAt = 1_900_000_010_000;

  const archive = compileLocalReplayHistory(draft);
  const playback = buildReplayFrames(archive);
  assert.equal(archive.playback?.steps.length, 2);
  assert.equal(playback.frames.length, 3);
  assert.equal(playback.frames.at(-1)?.state.version, state.version);
});

test("engine history is the only live replay source and replay archives compile on demand", async () => {
  const [dispatcher, journal, journalWorker, serverStore, route, eventStore, theatre, localStore] = await Promise.all([
    source("lib/engine/local-command-dispatcher.ts"),
    source("lib/replay-journal.ts"),
    source("lib/replay-journal.worker.ts"),
    source("lib/replay-archive-server.ts"),
    source("app/api/replays/route.ts"),
    source("lib/engine/event-store.ts"),
    source("components/replay/ReplayTheatre.tsx"),
    source("lib/replay-local-store.ts"),
  ]);

  assert.match(dispatcher, /journalLocalEngineTransition/);
  assert.match(dispatcher, /createReplayStatePatch\(input, result\.state\)/);
  assert.doesNotMatch(dispatcher, /journalLocalReplayCommand/);
  assert.match(journal, /new Worker\(new URL\("\.\/replay-journal\.worker\.ts"/);
  assert.match(journal, /sealCompletedStateFallback/);
  assert.match(journalWorker, /isLocalEngineHistoryDraft/);
  assert.match(journalWorker, /await persistDraft\(draft\)/);
  assert.doesNotMatch(journalWorker, /buildDisplayableReplayArchive|saveLocalReplay/);
  assert.match(serverStore, /PENDING_REPLAY_ARCHIVE_KIND = "pending-engine-history"/);
  assert.match(serverStore, /visual replay archive is compiled lazily/);
  assert.match(route, /materializeReplayArchive\(database, row\)/);
  assert.match(localStore, /loadOrCompileLocalReplay/);
  assert.match(localStore, /compileLocalReplayHistory\(history\)/);
  assert.match(eventStore, /enteredGameplay/);
  assert.match(theatre, /reconstructLocalReplay/);
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
