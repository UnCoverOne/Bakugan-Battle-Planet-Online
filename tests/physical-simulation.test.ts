import assert from "node:assert/strict";
import test from "node:test";
import { CORES, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  HEX_CELLS,
  createMatch,
  type MatchState,
  type RollOutcome,
} from "../lib/game";
import {
  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
  PhysicalSimulationError,
  describePhysicalSimulationProfile,
  physicalRotationPhaseOpenCell,
  resolvePhysicalCoreCollisions,
  resolvePhysicalRollOutcome,
  simulatePhysicalRollStep,
  validatePhysicalSimulationProfile,
  type PhysicalRandomSource,
  type PhysicalSimulationProfile,
} from "../lib/rules/physical-simulation";
import { DIGITAL_ADAPTATION_VERSION } from "../lib/content/versions";

function targetState(): MatchState {
  const a = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const b = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const state = createMatch("PHYS26", "bo1", [a, b]);
  state.phase = "target";
  state.selected = { a: a.bakugan[0].id, b: b.bakugan[0].id };
  state.targets = { a: "h3-3", b: "h3-3" };
  state.placements = [
    { playerId: "a", core: { ...CORES[0], id: "core-intercept" }, cell: "h3-7", order: 0 },
    { playerId: "b", core: { ...CORES[1], id: "core-target" }, cell: "h3-3", order: 1 },
    { playerId: "a", core: { ...CORES[2], id: "core-side" }, cell: "h4-3", order: 2 },
  ];
  return state;
}

function queue(values: number[]): PhysicalRandomSource {
  let index = 0;
  return (maximum) => {
    assert.ok(index < values.length, `Random queue exhausted before a draw from 0..${maximum - 1}.`);
    const value = values[index++];
    assert.ok(value < maximum, `${value} does not fit a draw with maximum ${maximum}.`);
    return value;
  };
}

function outcome(playerId: string, accuracyRoll: number, coreCell = "h3-3"): RollOutcome {
  return {
    playerId,
    bakuganId: `${playerId}-bakugan`,
    target: coreCell,
    resolvedTarget: coreCell,
    result: "intended-core",
    cores: [coreCell],
    accuracyRoll,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 1,
    doubleCore: false,
    path: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
    note: "Fixture roll.",
    simulationProfileId: BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE.id,
    attempt: 1,
    collisionDecisions: [],
  };
}

test("the physical simulation profile is versioned and internally valid", () => {
  assert.equal(BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE.id, DIGITAL_ADAPTATION_VERSION);
  assert.deepEqual(validatePhysicalSimulationProfile(BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE), []);
  assert.ok(describePhysicalSimulationProfile().some((line) => line.includes("normalized accuracy")));
});

test("invalid physical profiles fail before consuming random values", () => {
  const profile = structuredClone(BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE) as PhysicalSimulationProfile;
  profile.rotation.openPeriodCoreLengths = 0;
  let draws = 0;
  assert.throws(
    () => simulatePhysicalRollStep(targetState(), HEX_CELLS, () => { draws += 1; return 0; }, profile),
    (error: unknown) => error instanceof PhysicalSimulationError && error.code === "INVALID_PROFILE",
  );
  assert.equal(draws, 0);
});

test("the four-Core rotation phase intercepts an earlier available Core", () => {
  const state = targetState();
  assert.equal(physicalRotationPhaseOpenCell(state, HEX_CELLS, "a", "h3-3"), "h3-7");
  const roll = resolvePhysicalRollOutcome(state, HEX_CELLS, state.players[0], queue([0, 0, 99, 0]));
  assert.equal(roll.result, "path-intercept");
  assert.deepEqual(roll.cores, ["h3-7"]);
  assert.equal(roll.simulationProfileId, DIGITAL_ADAPTATION_VERSION);
});

test("a seeded roll attempt is deterministic and does not mutate its source state", () => {
  const firstState = targetState();
  const secondState = structuredClone(firstState);
  const snapshot = structuredClone(firstState);
  const values = [0, 120, 99, 500, 0, 620, 99, 900];
  const first = simulatePhysicalRollStep(firstState, HEX_CELLS, queue([...values]));
  const second = simulatePhysicalRollStep(secondState, HEX_CELLS, queue([...values]));
  assert.deepEqual(first, second);
  assert.deepEqual(firstState, snapshot);
  assert.equal(first.attempts.length, 1);
  assert.equal(first.outcomes.length, 2);
});

test("all-closed physical attempts repeat as explicit replay-visible attempts", () => {
  const state = targetState();
  state.players.forEach((player) => {
    const selected = player.bakugan.find((bakugan) => bakugan.id === state.selected[player.id])!;
    selected.rollAccuracy = 0;
    selected.doubleCoreChance = 0;
  });
  const values = [
    99, 0, 99, 0,
    99, 0, 99, 0,
    99, 3_500, 99, 0,
    99, 0, 99, 0,
  ];
  const result = simulatePhysicalRollStep(state, HEX_CELLS, queue(values));
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].repeated, true);
  assert.equal(result.attempts[1].repeated, false);
  assert.ok(result.attempts[0].outcomes.every((roll) => roll.result === "miss-closed"));
  assert.ok(result.outcomes.some((roll) => roll.result === "open-no-core"));
  assert.ok(result.outcomes.every((roll) => roll.attempt === 2));
});

test("contested primary pickups use normalized accuracy and open the losing Bakugan without a Core", () => {
  const state = targetState();
  const aBakugan = state.players[0].bakugan.find((bakugan) => bakugan.id === state.selected.a)!;
  const bBakugan = state.players[1].bakugan.find((bakugan) => bakugan.id === state.selected.b)!;
  aBakugan.id = "a-bakugan";
  bBakugan.id = "b-bakugan";
  aBakugan.rollAccuracy = 80;
  bBakugan.rollAccuracy = 100;
  const resolved = resolvePhysicalCoreCollisions(state, [outcome("a", 20), outcome("b", 40)]);
  const alpha = resolved.outcomes.find((roll) => roll.playerId === "a")!;
  const beta = resolved.outcomes.find((roll) => roll.playerId === "b")!;
  assert.deepEqual(alpha.cores, ["h3-3"]);
  assert.equal(beta.result, "open-no-core");
  assert.deepEqual(beta.cores, []);
  assert.equal(resolved.collisionDecisions[0].kind, "primary-contested");
  assert.equal(resolved.collisionDecisions[0].winnerPlayerId, "a");
  assert.equal(resolved.collisionDecisions[0].affectedPlayerId, "b");
});

test("primary pickups take precedence over a Double Core secondary pickup", () => {
  const state = targetState();
  const aBakugan = state.players[0].bakugan.find((bakugan) => bakugan.id === state.selected.a)!;
  const bBakugan = state.players[1].bakugan.find((bakugan) => bakugan.id === state.selected.b)!;
  aBakugan.id = "a-bakugan";
  bBakugan.id = "b-bakugan";
  const alpha = outcome("a", 10, "h3-7");
  alpha.cores = ["h3-7", "h3-3"];
  alpha.doubleCore = true;
  alpha.path.push({ x: 3, y: 3 });
  const beta = outcome("b", 20, "h3-3");
  const resolved = resolvePhysicalCoreCollisions(state, [alpha, beta]);
  const afterAlpha = resolved.outcomes.find((roll) => roll.playerId === "a")!;
  assert.deepEqual(afterAlpha.cores, ["h3-7"]);
  assert.equal(afterAlpha.doubleCore, false);
  assert.ok(resolved.collisionDecisions.some((decision) => decision.kind === "secondary-yielded" && decision.winnerPlayerId === "b"));
});

test("out-of-range random sources are rejected", () => {
  const state = targetState();
  assert.throws(
    () => resolvePhysicalRollOutcome(state, HEX_CELLS, state.players[0], () => 100),
    (error: unknown) => error instanceof PhysicalSimulationError && error.code === "INVALID_RANDOM_VALUE",
  );
});
