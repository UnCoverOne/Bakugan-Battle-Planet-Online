import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope } from "../lib/engine/types";
import {
  appendLocalEngineHistoryTransition,
  createLocalEngineHistoryDraft,
  createLocalEngineHistoryTransition,
} from "../lib/local-replay-history";
import { buildLocalReplayJournalDiagnostic } from "../lib/replay-debug-diagnostic";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function readyEnvelope(
  state: ReturnType<typeof initializeMatch>["state"],
  actorId: string,
  index: number,
): CommandEnvelope {
  return {
    commandId: `debug-ready-${index}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_900_000_000_000 + index,
    randomSeed: `debug-seed-${index}`,
    requestHash: `debug-request-${index}`,
    command: { type: "SET_LOBBY_READY", ready: true },
  };
}

test("local replay diagnostic exposes engine-history hashes and transition samples", () => {
  const first = makePlayer("debug-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("debug-b", "Training AI", STARTER_DECKS[1]);
  let state = initializeMatch("DEBUG1", "bo1", [first, second], {
    commandId: "debug-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "debug-create-seed",
    requestHash: "debug-create-request",
  }).state;
  const genesisVersion = state.version;
  const draft = createLocalEngineHistoryDraft(state, first.id, 1_900_000_000_000);

  for (const [index, actorId] of [first.id, second.id].entries()) {
    const envelope = readyEnvelope(state, actorId, index + 1);
    const result = reduceMatch(state, envelope);
    assert.equal(result.changed, true);
    const transition = createLocalEngineHistoryTransition(state, result.state, envelope, result.events);
    appendLocalEngineHistoryTransition(draft, transition, envelope.issuedAt);
    state = result.state;
  }
  draft.finalState = structuredClone(state);
  draft.completedAt = 1_900_000_010_000;

  const diagnostic = buildLocalReplayJournalDiagnostic(draft);
  assert.ok(diagnostic);
  assert.equal(diagnostic.kind, "engine-history");
  assert.equal(diagnostic.schemaVersion, 3);
  assert.equal(diagnostic.transitionCount, 2);
  assert.equal(diagnostic.genesisVersion, genesisVersion);
  assert.equal(diagnostic.finalVersion, state.version);
  assert.equal(diagnostic.headStateHash, draft.transitions[1].resultStateHash);
  assert.equal(diagnostic.integrityFault, null);
  assert.equal(diagnostic.firstTransitions.length, 2);
  assert.equal(diagnostic.lastTransitions.length, 2);
  assert.equal(diagnostic.firstTransitions[0].expectedVersion, genesisVersion);
  assert.equal(diagnostic.firstTransitions[0].resultVersion, draft.transitions[0].resultVersion);
  assert.equal(diagnostic.firstTransitions[0].beforeStateHash, draft.transitions[0].beforeStateHash);
  assert.equal(diagnostic.firstTransitions[0].resultStateHash, draft.transitions[0].resultStateHash);
  assert.equal(diagnostic.firstTransitions[0].hasReplayStatePatch, true);
  assert.ok(diagnostic.firstTransitions[0].eventTypes.includes("COMMAND_ACCEPTED"));
});

test("local replay diagnostic surfaces a persisted integrity fault", () => {
  const first = makePlayer("debug-fault-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("debug-fault-b", "Training AI", STARTER_DECKS[1]);
  const state = initializeMatch("DEBUG2", "bo1", [first, second], {
    commandId: "debug-fault-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "debug-fault-create-seed",
    requestHash: "debug-fault-create-request",
  }).state;
  const draft = createLocalEngineHistoryDraft(state, first.id, 1_900_000_000_000);
  const envelope = readyEnvelope(state, first.id, 1);
  const result = reduceMatch(state, envelope);
  const transition = createLocalEngineHistoryTransition(state, result.state, envelope, result.events);

  assert.throws(
    () => appendLocalEngineHistoryTransition(
      draft,
      { ...transition, beforeStateHash: "0000000000000000" },
      envelope.issuedAt,
    ),
    /integrity mismatch/,
  );

  const diagnostic = buildLocalReplayJournalDiagnostic(draft);
  assert.ok(diagnostic);
  assert.equal(diagnostic.kind, "engine-history");
  assert.equal(diagnostic.transitionCount, 0);
  assert.equal(diagnostic.integrityFault?.commandId, envelope.commandId);
  assert.equal(diagnostic.integrityFault?.recordedBeforeStateHash, "0000000000000000");
  assert.equal(diagnostic.integrityFault?.expectedBeforeStateHash, draft.headStateHash);
});

test("administrator local replay export includes the raw journal and concise summary", async () => {
  const theatre = await source("components/replay/ReplayTheatre.tsx");
  assert.match(theatre, /flushLocalReplayJournalAndWait/);
  assert.match(theatre, /loadLocalReplayHistory/);
  assert.match(theatre, /schemaVersion:\s*2/);
  assert.match(theatre, /journalFlushError/);
  assert.match(theatre, /localJournalSummary:\s*buildLocalReplayJournalDiagnostic\(localJournal\)/);
  assert.match(theatre, /\n\s*localJournal,\n/);
});
