import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import {
  HEX_CELLS,
  createMatch,
  resolveRollOutcome,
  rotationPhaseOpenCell,
  type MatchState,
} from "../lib/game";

function cell(q: number, r: number) {
  const found = HEX_CELLS.find((candidate) => candidate.q === q && candidate.r === r);
  assert.ok(found, `Missing axial cell ${q},${r}`);
  return found.id;
}

function rollMatch(cells: readonly string[], target = cells.at(-1)!) {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("ROLL02", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "target";
  match.selected[player.id] = player.bakugan[0].id;
  match.selected[opponent.id] = opponent.bakugan[0].id;
  match.targets[player.id] = target;
  match.placements = cells.map((cellId, index) => {
    const owner = match.players[index % 2];
    return {
      playerId: owner.id,
      core: owner.cores[Math.floor(index / 2) % owner.cores.length],
      cell: cellId,
      order: index + 1,
    };
  });
  return match;
}

function fixedRoll(values: readonly number[]) {
  let index = 0;
  return (maximum: number) => {
    const value = values[index++] ?? 0;
    assert.ok(value >= 0 && value < maximum, `${value} is not inside 0..${maximum - 1}`);
    return value;
  };
}

function resolve(
  match: MatchState,
  accuracyRoll: number,
  deviationRoll: number,
  doubleRoll = 100,
  secondCoreRoll = 1,
) {
  return resolveRollOutcome(
    match,
    match.players[0],
    fixedRoll([
      accuracyRoll - 1,
      deviationRoll - 1,
      doubleRoll - 1,
      secondCoreRoll - 1,
    ]),
  );
}

test("four-Core magnet phase opens on cores 1, 3 and 1 when aiming at 5, 7 and 9", () => {
  const orderedRow = [4, 3, 2, 1, 0, -1, -2, -3, -4].map((r) => cell(0, r));
  const cases = [
    { count: 5, openedIndex: 0 },
    { count: 7, openedIndex: 2 },
    { count: 9, openedIndex: 0 },
  ];
  for (const { count, openedIndex } of cases) {
    const row = orderedRow.slice(0, count);
    const match = rollMatch(row);
    assert.equal(rotationPhaseOpenCell(match, "player-a", row.at(-1)!), row[openedIndex]);
    const outcome = resolve(match, 1, 1);
    assert.equal(outcome.result, "path-intercept");
    assert.deepEqual(outcome.cores, [row[openedIndex]]);
  }
});

test("the lightweight resolver supports every deviation outcome and records a displayable path", () => {
  const before = cell(0, 1);
  const target = cell(0, 0);
  const after = cell(0, -1);
  const left = cell(-1, 0);
  const right = cell(1, 0);
  const match = rollMatch([before, target, after, left, right], target);
  const examples = [
    { deviation: 1, result: "miss-closed", core: undefined },
    { deviation: 3001, result: "open-no-core", core: undefined },
    { deviation: 5001, result: "undershoot", core: before },
    { deviation: 6501, result: "overshoot", core: after },
    { deviation: 7501, result: "skew-left", core: left },
    { deviation: 8751, result: "skew-right", core: right },
  ] as const;
  for (const example of examples) {
    const outcome = resolve(match, 100, example.deviation);
    assert.equal(outcome.result, example.result);
    assert.equal(outcome.cores[0], example.core);
    assert.ok(outcome.path.length >= 3);
    assert.notDeepEqual(outcome.path[0], outcome.path.at(-1));
  }
});

test("a second-Core success keeps the primary result and uses 40/40/20 positional weighting", () => {
  const before = cell(0, 1);
  const target = cell(0, 0);
  const after = cell(0, -1);
  const sideA = cell(1, 0);
  const sideB = cell(-1, 0);
  const match = rollMatch([before, target, after, sideA, sideB], target);
  const cases = [
    { roll: 1, expected: before },
    { roll: 4001, expected: after },
    { roll: 8001, expected: sideA },
  ];
  for (const example of cases) {
    const outcome = resolve(match, 1, 1, 1, example.roll);
    assert.equal(outcome.result, "intended-core");
    assert.equal(outcome.doubleCore, true);
    assert.deepEqual(outcome.cores, [target, example.expected]);
    assert.equal(outcome.path.length, 4);
  }
});

test("Accuracy remains the majority gate for the intended result", () => {
  const target = cell(0, 0);
  const match = rollMatch([target], target);
  match.players[0].bakugan[0].rollAccuracy = 90;
  const results = Array.from({ length: 100 }, (_, index) => resolve(match, index + 1, 1));
  assert.equal(results.filter((outcome) => outcome.result === "intended-core").length, 90);
  assert.equal(results.filter((outcome) => outcome.result !== "intended-core").length, 10);
});
