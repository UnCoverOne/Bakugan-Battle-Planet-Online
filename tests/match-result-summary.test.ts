import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchRoundCount } from "../lib/match-result-summary";

test("match result round count falls back to the current turn", () => {
  assert.equal(matchRoundCount({ turn: 4, log: [] }), 4);
});

test("match result round count includes every game in a series", () => {
  assert.equal(matchRoundCount({
    turn: 2,
    log: [
      { message: "Turn 1 began. Alpha has 1 explicit Draw action; Beta has 1 explicit Draw action." },
      { message: "Turn 2 began. Alpha has 1 explicit Draw action; Beta has 1 explicit Draw action." },
      { message: "Game 1 ended." },
      { message: "Turn 1 began. Alpha has 1 explicit Draw action; Beta has 1 explicit Draw action." },
      { message: "Turn 2 began. Alpha has 1 explicit Draw action; Beta has 1 explicit Draw action." },
      { message: "Turn 3 began. Alpha has 1 explicit Draw action; Beta has 1 explicit Draw action." },
      { message: "Random roll output." },
    ],
  }), 5);
});

test("match result round count ignores unrelated log entries", () => {
  assert.equal(matchRoundCount({
    turn: 0,
    log: [
      { message: "The twelve-Core Hide Matrix is complete." },
      { message: "Turn order changed." },
      { message: "Turn 1 began" },
    ],
  }), 0);
});

test("recovering a completed result uses the active lobby membership", () => {
  const page = readFileSync("app/(workspace)/play/result/page.tsx", "utf8");
  const result = readFileSync("components/routes/ManagedSeriesResult.jsx", "utf8");
  assert.match(page, /<ManagedSeriesResult \/>/);
  assert.match(result, /recoverResult\(\)/);
  assert.match(result, /result\?\.seriesId === seriesId/);
});
