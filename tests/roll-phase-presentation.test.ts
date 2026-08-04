import assert from "node:assert/strict";
import test from "node:test";
import {
  describeTurnTransition,
  phaseTransitionIsBlocked,
  phaseTransitionShouldPresent,
  presentedTurnProgress,
  turnProgressSnapshot,
  turnStepsForPhase,
} from "../components/game-screen-v2/turnProgressState";

test("Tips stay hidden while Roll Results or the Brawl Preview is visible", () => {
  assert.equal(phaseTransitionIsBlocked(true, false, false), true);
  assert.equal(phaseTransitionIsBlocked(false, true, false), true);
  assert.equal(phaseTransitionIsBlocked(false, false, true), true);
  assert.equal(phaseTransitionIsBlocked(false, false, false), false);
});

test("a pending roll presentation does not rewind authoritative Power progress", () => {
  const staleSelection = turnProgressSnapshot({
    phase: "preRoll",
    stepLabel: "Roll Phase • Selection Step • Priority",
    turn: 3,
  });
  const authoritativePower = turnProgressSnapshot({
    phase: "power",
    stepLabel: "Brawl Phase • Power Step",
    turn: 3,
  });

  const presented = presentedTurnProgress(
    authoritativePower,
    staleSelection,
    true,
  );

  assert.equal(presented?.phaseKey, "brawl");
  assert.equal(presented?.stepKey, "power");
  assert.equal(presented?.signature, "3:brawl:power");
});

test("Power is presented normally after the roll animation settles", () => {
  const power = turnProgressSnapshot({
    phase: "power",
    stepLabel: "Brawl Phase • Power Step",
    turn: 3,
  });

  assert.equal(presentedTurnProgress(power, null, false)?.stepKey, "power");
});

test("the End Phase HUD tracks Play, Charge, and Reset as distinct live steps", () => {
  assert.deepEqual(turnStepsForPhase("end").map((step) => step.key), ["play", "charge", "reset"]);
  assert.equal(turnProgressSnapshot({ phase: "endPlay", stepLabel: "End Phase • Play Step", turn: 5 })?.stepKey, "play");
  assert.equal(turnProgressSnapshot({ phase: "charge", stepLabel: "End Phase • Charge Step", turn: 5 })?.stepKey, "charge");
  assert.equal(turnProgressSnapshot({ phase: "reset", stepLabel: "End Phase • Reset Step", turn: 5 })?.stepKey, "reset");
  assert.equal(turnProgressSnapshot({ phase: "handLimit", stepLabel: "End of turn • Discard to seven", turn: 5 })?.stepKey, "reset");
});

test("a blocked live transition is consumed instead of appearing after presentation settles", () => {
  const rolling = turnProgressSnapshot({
    phase: "target",
    stepLabel: "Roll Phase • Rolling Step",
    turn: 3,
  });
  const power = turnProgressSnapshot({
    phase: "power",
    stepLabel: "Brawl Phase • Power Step",
    turn: 3,
  });
  const transition = describeTurnTransition(rolling, power);
  assert.ok(transition && power);

  const seen = new Set<string>();
  assert.equal(phaseTransitionShouldPresent(transition, power, true, seen), false);
  seen.add(transition.signature);
  assert.equal(phaseTransitionShouldPresent(transition, power, false, seen), false);
});

test("Transition callouts reject stale, blocked, and already presented steps", () => {
  const draw = turnProgressSnapshot({
    phase: "draw",
    stepLabel: "Start Phase • Draw Step",
    turn: 4,
  });
  const energize = turnProgressSnapshot({
    phase: "energize",
    stepLabel: "Start Phase • Energize Step",
    turn: 4,
  });
  const selection = turnProgressSnapshot({
    phase: "selection",
    stepLabel: "Roll Phase • Selection Step",
    turn: 4,
  });
  const transition = describeTurnTransition(draw, energize);

  assert.ok(transition && energize && selection);
  assert.equal(phaseTransitionShouldPresent(transition, energize, false, new Set()), true);
  assert.equal(phaseTransitionShouldPresent(transition, energize, true, new Set()), false);
  assert.equal(phaseTransitionShouldPresent(transition, selection, false, new Set()), false);
  assert.equal(
    phaseTransitionShouldPresent(transition, energize, false, new Set([transition.signature])),
    false,
  );
});
