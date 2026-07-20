import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const gameplay = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
const placement = readFileSync(new URL("../components/game-screen-v2/CorePlacementLayer.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/game/route.ts", import.meta.url), "utf8");

test("the setup shell publishes route and match changes to the gameplay store", () => {
  assert.match(page, /readMatchStore/);
  assert.match(page, /addEventListener\(MATCH_UPDATE_EVENT/);
  assert.match(page, /dispatchEvent\(new Event\(MATCH_UPDATE_EVENT\)\)/);
});

test("the starting-player transition retries and exposes a manual recovery control", () => {
  assert.match(gameplay, /attempt\(2\)/);
  assert.match(gameplay, /setStartupError/);
  assert.match(placement, />Retry<\/button>/);
  assert.match(route, /input\.phase === "startingPlayer" && now >= input\.startingPlayerRevealedAt/);
});
