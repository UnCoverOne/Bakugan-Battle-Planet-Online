import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type MatchState } from "../lib/game";
import {
  flipTieBreakCard,
  manualTieBreakState,
  passPriorityWithTieBreak,
  playerCanFlipTieBreak,
  tieBreakCardCost,
} from "../lib/manualTieBreak";

function tiedPowerState() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("TIEPWR", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = second.id;
  state.passes = [first.id];
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  first.bakugan[0].bPower = 500;
  second.bakugan[0].bPower = 500;
  first.bakugan[0].character.bPower = 500;
  second.bakugan[0].character.bPower = 500;
  return state;
}

function setTopCosts(state: MatchState, firstCosts: number[], secondCosts: number[]) {
  firstCosts.forEach((cost, index) => { state.players[0].deckCards[index].cost = cost; });
  secondCosts.forEach((cost, index) => { state.players[1].deckCards[index].cost = cost; });
}

test("a tied Power Step pauses for both players to flip manually", () => {
  const input = tiedPowerState();
  const state = passPriorityWithTieBreak(input, input.players[1].id);
  const tieBreak = manualTieBreakState(state);

  assert.equal(state.phase, "power");
  assert.equal(state.priority, "");
  assert.equal(tieBreak?.status, "waiting");
  assert.equal(tieBreak?.round, 1);
  assert.equal(playerCanFlipTieBreak(state, state.players[0].id), true);
  assert.equal(playerCanFlipTieBreak(state, state.players[1].id), true);
});

test("the higher Energy card is shown before the Brawl advances", () => {
  let state = tiedPowerState();
  setTopCosts(state, [2], [5]);
  state = passPriorityWithTieBreak(state, state.players[1].id);
  const firstCardId = state.players[0].deckCards[0].id;
  const secondCardId = state.players[1].deckCards[0].id;

  state = flipTieBreakCard(state, state.players[0].id);
  assert.equal(state.players[0].discard.at(-1)?.id, firstCardId);
  assert.equal(state.phase, "power");

  state = flipTieBreakCard(state, state.players[1].id);
  assert.equal(state.players[1].discard.at(-1)?.id, secondCardId);
  assert.equal(state.phase, "power");
  assert.equal(state.priority, "");
  assert.equal(manualTieBreakState(state)?.status, "resolved");
  assert.equal(manualTieBreakState(state)?.winnerId, state.players[1].id);
  assert.equal(manualTieBreakState(state)?.lastRound?.reveals[state.players[1].id].cost, 5);

  state = passPriorityWithTieBreak(state, state.players[1].id);
  assert.equal(state.phase, "victor");
  assert.equal(state.brawlWinner, state.players[1].id);
});

test("equal Energy costs retain the comparison and start another manual round", () => {
  let state = tiedPowerState();
  setTopCosts(state, [3, 1], [3, 4]);
  state = passPriorityWithTieBreak(state, state.players[1].id);
  state = flipTieBreakCard(state, state.players[0].id);
  state = flipTieBreakCard(state, state.players[1].id);

  assert.equal(manualTieBreakState(state)?.round, 2);
  assert.equal(manualTieBreakState(state)?.lastRound?.tied, true);
  assert.deepEqual(manualTieBreakState(state)?.current, {});
  assert.equal(state.phase, "power");

  state = flipTieBreakCard(state, state.players[0].id);
  state = flipTieBreakCard(state, state.players[1].id);
  assert.equal(manualTieBreakState(state)?.status, "resolved");
  state = passPriorityWithTieBreak(state, state.players[1].id);
  assert.equal(state.phase, "victor");
  assert.equal(state.brawlWinner, state.players[1].id);
});

test("X has zero Energy during a tie-break", () => {
  assert.equal(tieBreakCardCost({ cost: "X" }), 0);
  assert.equal(tieBreakCardCost({ cost: 7 }), 7);
});

test("the gameplay client mounts the two-slot tie popup and reuses the deck flip action", () => {
  const gameplay = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
  const layer = readFileSync(new URL("../components/game-screen-v2/TieBreakLayer.tsx", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../lib/rules/runtime.ts", import.meta.url), "utf8");

  assert.match(gameplay, /<TieBreakLayer[\s\S]*onFlipTieBreakCard=\{flipTieBreak\}/);
  assert.match(gameplay, /"flip-damage"[\s\S]*flipTieBreakCard/);
  assert.match(layer, /match\.players\.map/);
  assert.match(layer, /HIGHER COST/);
  assert.match(layer, /EQUAL COST/);
  assert.match(layer, /finishAction/);
  assert.match(runtime, /manualTieBreakState[\s\S]*flipTieBreakCard/);
});
