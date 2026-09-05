import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gameScreen = readFileSync(
  new URL("../components/game-screen-v2/GameScreen.tsx", import.meta.url),
  "utf8",
);
const gameScreenStyles = readFileSync(
  new URL("../components/game-screen-v2/GameScreen.module.css", import.meta.url),
  "utf8",
);
const gameplayClient = readFileSync(
  new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url),
  "utf8",
);
const gameplayRuntime = readFileSync(
  new URL("../components/game-screen-v2/GameplayRuntime.tsx", import.meta.url),
  "utf8",
);
const discardLayer = readFileSync(
  new URL("../components/game-screen-v2/DiscardFlipAnimationLayer.tsx", import.meta.url),
  "utf8",
);
const discardStyles = readFileSync(
  new URL("../components/game-screen-v2/DiscardFlipAnimationLayer.module.css", import.meta.url),
  "utf8",
);

test("the local main deck is an accessible Draw action only while drawing is legal", () => {
  assert.match(gameplayClient, /onDrawCard=\{completed \? undefined : drawCard\}/);
  assert.match(gameScreen, /playerCanDrawTurnCard\(match, localPlayerId, drawClock\)/);
  assert.match(gameScreen, /data-draw-available=\{canDrawDeck \? "true" : undefined\}/);
  assert.match(gameScreen, /role=\{interactive \? "button" : undefined\}/);
  assert.match(gameScreen, /event\.key !== "Enter" && event\.key !== " "/);
});

test("an available deck draw uses a soft white glow", () => {
  assert.match(gameScreenStyles, /\.cardStackZoneDrawReady\s*\{/);
  assert.match(gameScreenStyles, /rgba\(255, 255, 255/);
  assert.match(gameScreenStyles, /@keyframes deck-draw-ready/);
  assert.match(gameScreenStyles, /prefers-reduced-motion/);
});

test("deck-to-discard moves mount a face-revealing flight layer", () => {
  assert.match(gameplayRuntime, /<DiscardFlipAnimationLayer \/>/);
  assert.match(discardLayer, /discardFlipTransitions\(previous, match\)/);
  assert.match(discardLayer, /data-card-type=\{flight\.card\.type\}/);
  assert.match(discardStyles, /@keyframes discard-card-flight/);
  assert.match(discardStyles, /@keyframes discard-card-turn/);
  assert.match(discardStyles, /rotateY\(180deg\)/);
  assert.doesNotMatch(discardStyles, /data-art-orientation/);
  assert.match(discardLayer, /<CardArt[\s\S]*cardType=\{flight\.card\.type\}/);
});
