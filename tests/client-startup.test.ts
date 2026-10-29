import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gameplay = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
const placementStyles = readFileSync(new URL("../components/game-screen-v2/CorePlacementLayer.module.css", import.meta.url), "utf8");

test("BakuCore placement is an exclusive opaque phase screen", () => {
  const placementBranch = gameplay.indexOf("if (placementActive)");
  const gameScreen = gameplay.indexOf("<GameScreen");

  assert.match(gameplay, /const placementActive = storedState\.match != null/);
  assert.ok(placementBranch >= 0, "placement phase branch is present");
  assert.ok(gameScreen > placementBranch, "placement returns before gameplay is rendered");
  assert.equal((gameplay.match(/<CorePlacementLayer/g) ?? []).length, 1);
  assert.match(
    gameplay.slice(placementBranch, gameScreen),
    /return \(\s*<CorePlacementLayer/,
  );
  assert.doesNotMatch(
    gameplay.slice(placementBranch, gameScreen),
    /<GameScreen|<MatchHudLayer|<CardHandLayer/,
  );
  assert.match(placementStyles, /rgb\(82, 9, 13\), rgb\(0, 0, 0\)/);
  assert.match(placementStyles, /rgb\(168,22,29\), #010203 64%/);
});

