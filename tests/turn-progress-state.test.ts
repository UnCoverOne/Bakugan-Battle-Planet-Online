import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  TURN_PHASES,
  TURN_STEPS,
  formatStepCountdown,
  remainingStepSeconds,
  resolveTurnProgress,
  turnStepsForPhase,
} from "../components/game-screen-v2/turnProgressState";

test("turn progress exposes concise phase and step names", () => {
  assert.deepEqual(
    TURN_PHASES.map((phase) => phase.label),
    ["Start", "Roll", "Brawl", "End"],
  );
  assert.deepEqual(
    TURN_STEPS.map((step) => step.label),
    [
      "Draw",
      "Energize",
      "Selection",
      "Rolling",
      "Power",
      "Victor",
      "Damage",
      "Retracting",
      "Play",
      "Charge",
      "Reset",
    ],
  );
  assert.ok(
    [...TURN_PHASES, ...TURN_STEPS].every((item) => !/\b(?:phase|step)\b/i.test(item.label)),
  );
});

test("the steps row contains only steps from the active phase", () => {
  assert.deepEqual(
    turnStepsForPhase("start").map((step) => step.key),
    ["draw", "energize"],
  );
  assert.deepEqual(
    turnStepsForPhase("roll").map((step) => step.key),
    ["selection", "rolling"],
  );
  assert.deepEqual(
    turnStepsForPhase("brawl").map((step) => step.key),
    ["power", "victor", "damage", "retracting"],
  );
  assert.deepEqual(
    turnStepsForPhase("end").map((step) => step.key),
    ["play", "charge", "reset"],
  );
});

test("step countdown rounds up, stops at zero, and formats as minutes and seconds", () => {
  const now = 1_000_000;
  assert.equal(remainingStepSeconds(now + 35_001, now), 36);
  assert.equal(remainingStepSeconds(now + 35_000, now), 35);
  assert.equal(remainingStepSeconds(now - 1, now), 0);
  assert.equal(remainingStepSeconds(Number.NaN, now), 0);

  assert.equal(formatStepCountdown(0), "00:00");
  assert.equal(formatStepCountdown(9), "00:09");
  assert.equal(formatStepCountdown(65), "01:05");
  assert.equal(formatStepCountdown(125), "02:05");
  assert.equal(formatStepCountdown(-10), "00:00");
});

test("turn progress follows live engine phases and step labels", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("TRACKER", "bo1", [player, opponent]);
  match.turn = 1;

  const cases = [
    ["energize", "Turn 1 • Energize Step", "start", "energize"],
    ["selection", "Roll Phase • Selection Step", "roll", "selection"],
    ["target", "Roll Phase • Secret target selection", "roll", "rolling"],
    ["power", "Brawl Phase • Power Step", "brawl", "power"],
    ["victor", "Brawl Phase • Victor Step", "brawl", "victor"],
    ["damage", "Damage Step • 5 incoming", "brawl", "damage"],
    ["postDamage", "Damage Step • Post-damage priority", "brawl", "retracting"],
    ["endPlay", "End Phase • Play Step", "end", "play"],
    ["endPlay", "End Phase • Charge Step", "end", "charge"],
    ["handLimit", "End Phase • Discard to seven", "end", "reset"],
  ] as const;

  for (const [phase, stepLabel, expectedPhase, expectedStep] of cases) {
    match.phase = phase;
    match.stepLabel = stepLabel;
    const progress = resolveTurnProgress(match);
    assert.ok(progress);
    assert.equal(progress.phaseKey, expectedPhase);
    assert.equal(progress.stepKey, expectedStep);
    assert.ok(progress.phaseIndex >= 0);
    assert.ok(progress.stepIndex >= 0);
    assert.ok(
      turnStepsForPhase(progress.phaseKey).some((step) => step.key === progress.stepKey),
      "the active step must be present in the current phase row",
    );
  }

  match.turn = 0;
  assert.equal(resolveTurnProgress(match), null);
});
