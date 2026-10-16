import test from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../lib/game";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { recordTrainingAiTrace, trainingAiTraceForExport } from "../lib/training-ai-trace";

test("AI trace is match-scoped, bounded, and export snapshots are independent", () => {
  const a = createMatch("TRACE-A", "bo1", [
    makePlayer("trace-player", "Player", STARTER_DECKS[0]),
    makePlayer("training-bot", "Bot", STARTER_DECKS[1]),
  ]);
  for (let i = 0; i < 155; i += 1) {
    a.version = i;
    recordTrainingAiTrace(a, "request");
  }
  const first = trainingAiTraceForExport(a.id);
  assert.equal(first.events.length, 150);
  assert.equal(first.droppedEvents, 5);
  assert.equal(first.events[0].matchVersion, 5);
  recordTrainingAiTrace(a, "dispatch-success", { command: "PASS_PRIORITY", nextVersion: 156 });
  assert.equal(first.events.length, 150);

  const b = createMatch("TRACE-B", "bo1", [
    makePlayer("other", "Player", STARTER_DECKS[0]),
    makePlayer("training-bot", "Bot", STARTER_DECKS[1]),
  ]);
  recordTrainingAiTrace(b, "scheduled");
  assert.equal(trainingAiTraceForExport(b.id).events.length, 1);
  assert.equal(trainingAiTraceForExport(a.id).events.length, 0);
});
