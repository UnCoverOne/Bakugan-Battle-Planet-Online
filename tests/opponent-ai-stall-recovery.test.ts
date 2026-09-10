import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  OPPONENT_AI_STALL_TIMEOUT_MS,
  opponentPriorityCanFallback,
  recoverStalledOpponentPriority,
} from "../lib/opponentAiRecovery";

test("stalled Training AI pre-roll priority can recover through a legal pass", () => {
  const human = makePlayer("player-1", "Player 1", STARTER_DECKS[0]);
  const bot = makePlayer("training-bot", "Mira Nova • Training AI", STARTER_DECKS[1]);
  const match = createMatch("STALL1", "bo1", [human, bot]);
  match.phase = "preRoll";
  match.stepLabel = "Roll Phase • Pre-roll priority";
  match.priority = bot.id;
  match.passes = [human.id];

  assert.equal(opponentPriorityCanFallback(match, bot.id), true);
  const recovered = recoverStalledOpponentPriority(match, bot.id);
  assert.ok(recovered);
  assert.equal(recovered.phase, "target");
  assert.deepEqual(recovered.passes, []);
  assert.ok(recovered.version > match.version);
});

test("AI stall recovery never passes priority for the wrong actor", () => {
  const human = makePlayer("player-1", "Player 1", STARTER_DECKS[0]);
  const bot = makePlayer("training-bot", "Mira Nova • Training AI", STARTER_DECKS[1]);
  const match = createMatch("STALL2", "bo1", [human, bot]);
  match.phase = "preRoll";
  match.priority = human.id;

  assert.equal(opponentPriorityCanFallback(match, bot.id), false);
  assert.equal(recoverStalledOpponentPriority(match, bot.id), null);
});

test("gameplay mounts a watchdog that restarts the AI worker after recovery", async () => {
  const watchdog = await readFile(new URL("../components/game-screen-v2/OpponentAiProgressWatchdog.tsx", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../components/game-screen-v2/GameplayRuntime.tsx", import.meta.url), "utf8");

  assert.equal(OPPONENT_AI_STALL_TIMEOUT_MS, 4_000);
  assert.match(watchdog, /recoverStalledOpponentPriority\(latest, "training-bot"\)/);
  assert.match(watchdog, /writeCoordinatedMatch\(recovered\)/);
  assert.match(watchdog, /onRecover\(\)/);
  assert.match(runtime, /OpponentAiProgressWatchdog onRecover=\{recoverGameplayClient\}/);
  assert.match(runtime, /<GameplayClient key=\{gameplayClientGeneration\}/);
});
