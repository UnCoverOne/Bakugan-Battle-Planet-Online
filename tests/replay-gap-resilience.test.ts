import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "../lib/engine/types";
import {
  appendLocalEngineHistoryTransition,
  compileLocalReplayHistory,
  createLocalEngineHistoryDraft,
  createLocalEngineHistoryTransition,
} from "../lib/local-replay-history";
import { buildSegmentedReplayArchiveFromRows } from "../lib/replay-segmented-archive";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function commandEnvelope(
  state: EngineBackedMatchState,
  actorId: string,
  index: number,
  command: GameCommand,
): CommandEnvelope {
  return {
    commandId: `gap-command-${index}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_910_000_000_000 + index,
    randomSeed: `gap-seed-${index}`,
    requestHash: `gap-request-${index}`,
    command,
  };
}

function initializedMatch(code: string) {
  const first = makePlayer(`${code}-a`, "Alpha", STARTER_DECKS[0]);
  const second = makePlayer(`${code}-b`, "Beta", STARTER_DECKS[1]);
  const state = initializeMatch(code, "bo1", [first, second], {
    commandId: `${code}-create`,
    actorId: first.id,
    issuedAt: 1_910_000_000_000,
    randomSeed: `${code}-create-seed`,
    requestHash: `${code}-create-request`,
  }).state;
  return { first, second, state };
}

test("core-return reconciliation treats a completed engine command as authoritative", async () => {
  const [coreReturns, reducer] = await Promise.all([
    source("lib/coreReturns.ts"),
    source("lib/engine/reducer.ts"),
  ]);
  assert.match(coreReturns, /afterCommandId && afterCommandId !== beforeCommandId/);
  assert.match(coreReturns, /if \(alreadyReconciledByEngine\(before, after\)\) return after/);
  assert.match(reducer, /withDeterministicRuntime[\s\S]*captureCoreReturns\(before, dispatched\)/);
});

test("local engine history resynchronizes after a same-version hash gap and keeps later commands", () => {
  const { first, second, state: initialized } = initializedMatch("GAPLOCAL");
  let state = initialized;
  const draft = createLocalEngineHistoryDraft(state, first.id, 1_910_000_000_000);

  const firstEnvelope = commandEnvelope(state, first.id, 1, { type: "SET_LOBBY_READY", ready: true });
  const firstResult = reduceMatch(state, firstEnvelope);
  appendLocalEngineHistoryTransition(
    draft,
    createLocalEngineHistoryTransition(state, firstResult.state, firstEnvelope, firstResult.events),
    state,
    firstEnvelope.issuedAt,
  );
  state = firstResult.state;

  // Reproduce the class of bug that caused the reported replay gap: gameplay
  // consumes a replay-relevant mutation at the same engine version after the
  // previous journal transition was hashed.
  const diverged = structuredClone(state);
  diverged.stepLabel = `${diverged.stepLabel} • coordinator drift`;

  const secondEnvelope = commandEnvelope(diverged, second.id, 2, { type: "CHAT", message: "second" });
  const secondResult = reduceMatch(diverged, secondEnvelope);
  appendLocalEngineHistoryTransition(
    draft,
    createLocalEngineHistoryTransition(diverged, secondResult.state, secondEnvelope, secondResult.events),
    diverged,
    secondEnvelope.issuedAt,
  );
  state = secondResult.state;

  const thirdEnvelope = commandEnvelope(state, first.id, 3, { type: "CHAT", message: "third" });
  const thirdResult = reduceMatch(state, thirdEnvelope);
  appendLocalEngineHistoryTransition(
    draft,
    createLocalEngineHistoryTransition(state, thirdResult.state, thirdEnvelope, thirdResult.events),
    state,
    thirdEnvelope.issuedAt,
  );
  state = thirdResult.state;

  draft.finalState = state;
  draft.completedAt = 1_910_000_010_000;

  assert.equal(draft.transitions.length, 3);
  assert.equal(draft.integrityFault?.commandId, secondEnvelope.commandId);
  assert.ok(draft.checkpoints?.some((checkpoint) => checkpoint.reason === "integrity-resync"));

  const archive = compileLocalReplayHistory(draft);
  const playback = buildReplayFrames(archive);
  assert.equal(archive.recording.commands.length, 3);
  assert.equal(playback.frames.at(-1)?.state.version, state.version);
  assert.ok(playback.frames.some((frame) => frame.label.includes("resumed from engine checkpoint")));
  assert.ok(playback.frames.some((frame) => frame.commandType === "CHAT" && frame.state.version === secondResult.state.version));
  assert.ok(playback.frames.some((frame) => frame.commandType === "CHAT" && frame.state.version === thirdResult.state.version));
});

test("server replay recovery skips a damaged command and resumes exact history after a snapshot", () => {
  const { first, state: initialized } = initializedMatch("GAPSERVER");
  let state = initialized;
  const genesis = structuredClone(state);
  const rows = [];
  let checkpoint: { version: number; state_json: string; created_at: number } | undefined;

  for (let index = 1; index <= 4; index += 1) {
    const envelope = commandEnvelope(state, first.id, index, {
      type: "CHAT",
      message: `message-${index}`,
    });
    const result = reduceMatch(state, envelope);
    const accepted = result.events.find((event) => event.type === "COMMAND_ACCEPTED");
    assert.ok(accepted);
    rows.push({
      command_id: envelope.commandId,
      actor_id: first.id,
      expected_version: envelope.expectedVersion,
      result_version: result.state.version,
      payload_json: JSON.stringify(accepted.payload),
      created_at: envelope.issuedAt,
    });
    state = result.state;
    if (index === 2) {
      checkpoint = {
        version: state.version,
        state_json: JSON.stringify(state),
        created_at: envelope.issuedAt,
      };
    }
  }
  assert.ok(checkpoint);

  const damagedRows = rows.map((row, index) => index === 1 ? { ...row, payload_json: "{}" } : row);
  const archive = buildSegmentedReplayArchiveFromRows(
    genesis,
    damagedRows,
    [checkpoint],
    state,
    1_910_000_010_000,
    1_910_000_000_000,
  );
  const playback = buildReplayFrames(archive);

  assert.equal(archive.recording.commands.length, 3);
  assert.equal(playback.frames.at(-1)?.state.version, state.version);
  assert.ok(playback.frames.some((frame) => frame.label.includes(`checkpoint v${checkpoint.version}`)));
  assert.ok(playback.frames.some((frame) => frame.commandType === "CHAT" && frame.state.version === rows[2].result_version));
  assert.ok(playback.frames.some((frame) => frame.commandType === "CHAT" && frame.state.version === rows[3].result_version));
});
