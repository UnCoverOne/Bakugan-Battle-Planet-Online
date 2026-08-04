import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tracker = readFileSync(
  new URL("../components/game-screen-v2/TurnProgressTracker.tsx", import.meta.url),
  "utf8",
);

test("the round progress HUD uses the official Phase Transition icons", () => {
  assert.match(tracker, /import \{ PhaseTransitionStepIcon \} from "\.\/PhaseTransitionStepIcon"/);
  assert.match(tracker, /start: "draw"/);
  assert.match(tracker, /roll: "rolling"/);
  assert.match(tracker, /brawl: "power"/);
  assert.match(tracker, /end: "charge"/);
  assert.match(tracker, /<PhaseTransitionStepIcon[\s\S]*step=\{iconStepForItem\(item\)\}[\s\S]*className=\{styles\.glyph\}/);
  assert.match(tracker, /iconStepForItem=\{\(item\) => item\.key\}/);
  assert.doesNotMatch(tracker, />\{item\.glyph\}<\/span>/);
});
