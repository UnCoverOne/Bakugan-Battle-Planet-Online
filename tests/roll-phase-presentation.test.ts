import assert from "node:assert/strict";
import test from "node:test";
import {
  describeTurnTransition,
  phaseTransitionIsBlocked,
  phaseTransitionShouldPresent,
  presentedTurnProgress,
  turnProgressSnapshot,
} from "../components/game-screen-v2/turnProgressState";

test("Tips stay hidden while Roll Results or the Brawl Preview is visible", () => {
  assert.equal(phaseTransitionIsBlocked(true, false, false), true);
  assert.equal(phaseTransitionIsBlocked(false, true, false), true);
  assert.equal(phaseTransitionIsBlocked(false, false, true), true);
  assert.equal(phaseTransitionIsBlocked(false, false, false), false);
});

test("a pending roll presentation cannot fall back to the Selection Step", () => {
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

  assert.equal(presented?.phaseKey, "roll");
  assert.equal(presented?.stepKey, "rolling");
  assert.equal(presented?.signature, "3:roll:rolling");
});

test("Power is presented normally after the roll animation settles", () => {
  const power = turnProgressSnapshot({
    phase: "power",
    stepLabel: "Brawl Phase • Power Step",
    turn: 3,
  });

  assert.equal(presentedTurnProgress(power, null, false)?.stepKey, "power");
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
