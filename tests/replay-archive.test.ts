import assert from "node:assert/strict";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { appendLocalReplayTransition, archiveReplay, expandReplayGenesis, replayStateHash } from "../lib/engine/replay-codec";
import { buildProjectedReplayBundle, buildReplayFrames, decodeReplayTransport, encodeReplayTransport } from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import { ENGINE_METADATA_KEY, type CommandEnvelope } from "../lib/engine/types";

function envelope(state: ReturnType<typeof initializeMatch>["state"], actorId: string, type: "SET_LOBBY_READY", index: number): CommandEnvelope {
  return {
    commandId: `replay-command-${index}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_900_000_000_000 + index * 1_000,
    randomSeed: `replay-seed-${index}`,
    requestHash: `replay-request-${index}`,
    command: { type, ready: true },
  };
}

test("compact replay archive reconstructs and verifies every deterministic command", () => {
  const first = makePlayer("replay-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("replay-b", "Beta", STARTER_DECKS[1]);
  let state = initializeMatch("REPLAY", "bo1", [first, second], {
    commandId: "replay-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "replay-create-seed",
    requestHash: "replay-create-request",
  }).state;
  state = reduceMatch(state, envelope(state, first.id, "SET_LOBBY_READY", 1)).state;
  state = reduceMatch(state, envelope(state, second.id, "SET_LOBBY_READY", 2)).state;

  const archive = archiveReplay(state, 1_900_000_010_000);
  assert.ok(archive);
  assert.equal(archive.recording.commands.length, 2);
  assert.deepEqual(Object.keys(archive.recording.commands[0]).sort(), ["a", "c", "s", "t"]);
  assert.equal(archive.finalStateHash, replayStateHash(state));

  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames.length, 3);
  assert.equal(playback.frames.at(-1)?.state.version, state.version);
  assert.equal(replayStateHash(playback.frames.at(-1)!.state), archive.finalStateHash);
});

test("replay genesis stores catalogue references instead of duplicate card definitions", () => {
  const player = makePlayer("compact-a", "Compact", STARTER_DECKS[0]);
  const state = initializeMatch("SMALL", "bo1", [player], {
    commandId: "compact-create",
    actorId: player.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "compact-seed",
    requestHash: "compact-request",
  }).state;
  const genesis = state[ENGINE_METADATA_KEY]!.replay!.genesis;
  const encoded = JSON.stringify(genesis);
  assert.ok(!encoded.includes(player.deckCards[0].effect));
  assert.ok(encoded.length < JSON.stringify({ ...state, [ENGINE_METADATA_KEY]: undefined }).length / 3);
  const restored = expandReplayGenesis(genesis);
  assert.deepEqual(restored.players[0].deckCards, player.deckCards);
  assert.deepEqual(restored.players[0].hand, player.hand);
});

test("server replay projection never exposes an opponent hand or deck identity", () => {
  const first = makePlayer("private-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("private-b", "Beta", STARTER_DECKS[1]);
  const state = initializeMatch("PRIVATE", "bo1", [first, second], {
    commandId: "private-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "private-seed",
    requestHash: "private-request",
  }).state;
  const archive = archiveReplay(state, 1_900_000_001_000)!;
  const bundle = buildProjectedReplayBundle(archive, first.id);
  const opponent = bundle.frames[0].state.players.find((candidate) => candidate.id === second.id)!;
  assert.equal(opponent.hand.length, second.hand.length);
  assert.ok(opponent.hand.every((card) => card.catalogId === "hidden"));
  assert.ok(opponent.deckCards.every((card) => card.catalogId === "hidden"));
});

test("offline transition deltas and projected transport reconstruct without repeated snapshots", () => {
  const first = makePlayer("offline-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("offline-b", "Training AI", STARTER_DECKS[1]);
  const initialized = initializeMatch("OFFLINE", "bo1", [first, second], {
    commandId: "offline-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "offline-seed",
    requestHash: "offline-request",
  }).state;
  const changed = structuredClone(initialized);
  changed.version += 1;
  changed.turn = 2;
  changed.stepLabel = "Offline transition";
  const recorded = appendLocalReplayTransition(initialized, changed, "Training AI advanced", 1_900_000_001_000);
  const archive = archiveReplay(recorded, 1_900_000_002_000)!;
  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames.at(-1)?.state.stepLabel, "Offline transition");
  assert.equal(replayStateHash(playback.frames.at(-1)!.state), archive.finalStateHash);

  const projected = buildProjectedReplayBundle(archive, first.id);
  const transport = encodeReplayTransport(projected);
  assert.ok(transport.steps.every((step) => !("state" in step)));
  const decoded = decodeReplayTransport(transport);
  assert.deepEqual(decoded.frames, projected.frames);
});

test("legacy deltas retain their exact position between reducer commands", () => {
  const first = makePlayer("mixed-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("mixed-b", "Beta", STARTER_DECKS[1]);
  let state = initializeMatch("MIXED", "bo1", [first], {
    commandId: "mixed-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "mixed-seed",
    requestHash: "mixed-request",
  }).state;
  const configured = structuredClone(state);
  configured.trainingAiDeck = { resourceId: "mixed-config", configurationRevision: 1 };
  state = appendLocalReplayTransition(state, configured, "Configuration", 1_900_000_000_100);
  state = reduceMatch(state, {
    commandId: "mixed-join",
    gameId: state.id,
    actorId: second.id,
    expectedVersion: state.version,
    issuedAt: 1_900_000_000_200,
    randomSeed: "mixed-join-seed",
    requestHash: "mixed-join-request",
    command: { type: "JOIN_PLAYER", player: second },
  }).state;
  const labelled = structuredClone(state);
  labelled.stepLabel = "Joined and configured";
  state = appendLocalReplayTransition(state, labelled, "Post-join configuration", 1_900_000_000_300);
  const archive = archiveReplay(state, 1_900_000_000_400)!;
  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames[1].state.trainingAiDeck?.resourceId, "mixed-config");
  assert.equal(playback.frames[2].commandType, "JOIN_PLAYER");
  assert.equal(playback.frames.at(-1)?.state.stepLabel, "Joined and configured");
});
