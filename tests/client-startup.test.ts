import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const gameplay = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
const placement = readFileSync(new URL("../components/game-screen-v2/CorePlacementLayer.tsx", import.meta.url), "utf8");
const placementStyles = readFileSync(new URL("../components/game-screen-v2/CorePlacementLayer.module.css", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/game/route.ts", import.meta.url), "utf8");
const deadlines = readFileSync(new URL("../lib/deadlines.ts", import.meta.url), "utf8");

test("the setup shell publishes route and match changes to the gameplay store", () => {
  assert.match(page, /readMatchStore/);
  assert.match(page, /addEventListener\(MATCH_UPDATE_EVENT/);
  assert.match(page, /dispatchEvent\(new Event\(MATCH_UPDATE_EVENT\)\)/);
});

test("the starting-player transition retries and exposes a manual recovery control", () => {
  assert.match(gameplay, /attempt\(2\)/);
  assert.match(gameplay, /setStartupError/);
  assert.match(placement, />Retry<\/button>/);
  assert.match(route, /resolveExpiredDeadline/);
  assert.match(deadlines, /input\.phase === "startingPlayer" && now >= input\.startingPlayerRevealedAt/);
});


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
