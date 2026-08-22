import assert from "node:assert/strict";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { projectMatchLog } from "../lib/engine/log-projection";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import {
  applyReplayStatePatch,
  createReplayStatePatch,
  isReplayStatePatch,
  replayPresentationState,
} from "../lib/engine/replay-transition";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "../lib/engine/types";
import { buildReplayArchiveFromRows, type ReplayCommandRow } from "../lib/replay-archive-server";

function commandEnvelope(
  state: EngineBackedMatchState,
  actorId: string,
  command: GameCommand,
  index: number,
): CommandEnvelope {
  return {
    commandId: `history-overhaul-${index}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_910_000_000_000 + index * 1_000,
    randomSeed: `history-overhaul-seed-${index}`,
    requestHash: `history-overhaul-request-${index}`,
    command,
  };
}

function gameplaySnapshot(code: string) {
  const first = makePlayer(`${code}-a`, "Alpha", STARTER_DECKS[0]);
  const second = makePlayer(`${code}-b`, "Beta", STARTER_DECKS[1]);
  let state = initializeMatch(code, "bo1", [first, second], {
    commandId: `${code}-create`,
    actorId: first.id,
    issuedAt: 1_910_000_000_000,
    randomSeed: `${code}-create-seed`,
    requestHash: `${code}-create-request`,
  }).state;
  let index = 0;
  const apply = (actorId: string, command: GameCommand) => {
    index += 1;
    const envelope = commandEnvelope(state, actorId, command, index);
    state = reduceMatch(state, envelope).state;
  };
  apply(first.id, { type: "SET_LOBBY_READY", ready: true });
  apply(second.id, { type: "SET_LOBBY_READY", ready: true });
  apply(first.id, { type: "START_MATCH" });
  return { state, first, second, nextIndex: index + 1 };
}

test("MatchState.log is projected from authoritative LOG_ENTRY_ADDED engine events", () => {
  const first = makePlayer("history-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("history-b", "Beta", STARTER_DECKS[1]);
  const initialized = initializeMatch("HIST01", "bo1", [first], {
    commandId: "history-create",
    actorId: first.id,
    issuedAt: 1_910_000_000_000,
    randomSeed: "history-create-seed",
    requestHash: "history-create-request",
  });

  assert.deepEqual(initialized.state.log, projectMatchLog([], initialized.events));
  assert.ok(initialized.events.some((event) => event.type === "LOG_ENTRY_ADDED"));

  const join = commandEnvelope(initialized.state, second.id, { type: "JOIN_PLAYER", player: second }, 1);
  const joined = reduceMatch(initialized.state, join);
  const logEvent = joined.events.find((event) => event.type === "LOG_ENTRY_ADDED");
  assert.ok(logEvent);
  assert.equal((logEvent.payload.presentation as { template?: string }).template, "literal");
  assert.deepEqual(joined.state.log, projectMatchLog(initialized.state.log, joined.events));
  assert.equal(joined.state.log.at(-1)?.message, "Beta joined the room.");
});

test("authoritative replay patches round-trip nested card-zone transitions", () => {
  const { state: snapshot } = gameplaySnapshot("HISTP1");
  const next = structuredClone(snapshot);
  const player = next.players[0];
  const moved = player.deckCards.shift();
  assert.ok(moved);
  player.hand.push(moved);
  player.deck = player.deckCards.length;
  next.version += 1;

  const patch = createReplayStatePatch(snapshot, next);
  assert.ok(patch.some((operation) => operation.op === "splice" && operation.path.includes("/deckCards")));
  assert.ok(patch.some((operation) => operation.op === "splice" && operation.path.includes("/hand")));
  const reconstructed = applyReplayStatePatch(replayPresentationState(snapshot), patch);
  assert.deepEqual(reconstructed, replayPresentationState(next));
});

test("server replay finalization uses recorded authoritative transitions instead of re-running rules", () => {
  const { state: gameplay, first, second, nextIndex } = gameplaySnapshot("HIST02");
  const snapshot = structuredClone(gameplay);
  const overridden = snapshot.players[0].deckCards[0];
  assert.ok(overridden);
  overridden.displayName = "Runtime Snapshot Definition";
  overridden.effect = "This runtime-authored definition intentionally differs from the bundled catalogue.";

  const concede = commandEnvelope(snapshot, second.id, { type: "CONCEDE" }, nextIndex);
  const conceded = reduceMatch(snapshot, concede);
  const completed = conceded.state;
  const accepted = conceded.events.find((event) => event.type === "COMMAND_ACCEPTED");
  assert.ok(accepted);
  assert.ok(isReplayStatePatch(accepted.payload.replayStatePatch));
  assert.deepEqual(
    applyReplayStatePatch(replayPresentationState(snapshot), accepted.payload.replayStatePatch),
    replayPresentationState(completed),
  );

  // Simulate command semantics becoming incompatible after the match. A replay
  // built from the recorded transition remains correct because it never reduces
  // this command again; the compact command is audit/label metadata only.
  const persistedPayload = structuredClone(accepted.payload);
  persistedPayload.command = { type: "PASS_PRIORITY" };
  const row: ReplayCommandRow = {
    command_id: concede.commandId,
    actor_id: String(concede.actorId),
    expected_version: concede.expectedVersion,
    result_version: completed.version,
    payload_json: JSON.stringify(persistedPayload),
    created_at: concede.issuedAt,
  };
  const snapshotAt = concede.issuedAt - 500;
  const archive = buildReplayArchiveFromRows(
    snapshot,
    snapshot.version,
    [row],
    completed,
    concede.issuedAt + 1_000,
    snapshotAt,
  );

  assert.equal(archive.playback?.schemaVersion, 1);
  assert.equal(archive.playback?.initialFrame.label, "Gameplay begins");
  assert.equal(archive.playback?.initialFrame.at, snapshotAt);
  assert.equal(archive.playback?.steps.length, 1);
  assert.equal(
    archive.playback?.initialFrame.state.players[0].deckCards[0].displayName,
    "Runtime Snapshot Definition",
  );
  assert.equal(buildReplayFrames(archive).frames.at(-1)?.state.winner, first.id);
  assert.notEqual(buildReplayFrames(archive).frames[0]?.label, "Recovered final battlefield");

  // Frozen playback, not the compact catalogue recipe, is the permanent viewer source.
  archive.recording.genesis.players[0].d[0].c = "catalogue-entry-that-does-not-exist";
  assert.equal(buildReplayFrames(archive).frames.at(-1)?.state.winner, first.id);
});
