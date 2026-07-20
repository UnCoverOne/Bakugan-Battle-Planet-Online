import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type MatchState } from "../lib/game";
import { passPriorityWithManualDamage } from "../lib/manualDamage";
import {
  drawTurnCard,
  playerHasDrawnTurnCard,
  turnDrawCount,
  type TurnStartMatchState,
} from "../lib/turnStart";

function strataCard(instanceId = "strata-test") {
  const card = CARDS.find((candidate) => candidate.name === "Strata");
  assert.ok(card, "Strata must exist in the Battle Planet catalog");
  return { ...structuredClone(card), id: instanceId };
}

function matchWithPlayers() {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  return {
    player,
    opponent,
    match: createMatch("STRATA", "bo1", [player, opponent]),
  };
}

test("resolving Strata does not immediately draw cards", () => {
  const { player, opponent, match } = matchWithPlayers();
  const strata = strataCard();
  match.phase = "power";
  match.stepLabel = "Brawl Phase • Power Step";
  match.startingPlayer = player.id;
  match.priority = player.id;
  match.passes = [opponent.id];
  match.batch = [{
    id: "strata-pending",
    controllerId: player.id,
    card: strata,
    choices: {},
    kind: "card",
  }];

  const before = new Map(match.players.map((candidate) => [candidate.id, {
    hand: candidate.hand.length,
    deck: candidate.deckCards.length,
  }]));
  const resolved = passPriorityWithManualDamage(match, player.id);

  assert.ok(resolved.players[0].heroes.some((hero) => hero.id === strata.id));
  for (const candidate of resolved.players) {
    assert.equal(candidate.hand.length, before.get(candidate.id)!.hand);
    assert.equal(candidate.deckCards.length, before.get(candidate.id)!.deck);
  }
});

test("one Draw action draws the normal card plus Strata's additional card", () => {
  const { player, opponent, match } = matchWithPlayers();
  player.heroes.push(strataCard("strata-in-play"));
  const drawState = match as TurnStartMatchState;
  drawState.turn = 2;
  drawState.phase = "retract";
  drawState.stepLabel = "Turn 2 • Draw Step";
  drawState.drawPreparedTurn = 2;
  drawState.drawReadyAt = 0;
  drawState.drawDeadline = Date.now() + 35_000;
  drawState.drawnPlayerIds = [];

  assert.equal(turnDrawCount(drawState), 2);
  const playerHand = player.hand.length;
  const playerDeck = player.deckCards.length;
  const afterPlayer = drawTurnCard(drawState as MatchState, player.id, Date.now());
  const drawnPlayer = afterPlayer.players.find((candidate) => candidate.id === player.id)!;
  assert.equal(drawnPlayer.hand.length, playerHand + 2);
  assert.equal(drawnPlayer.deckCards.length, playerDeck - 2);
  assert.equal(playerHasDrawnTurnCard(afterPlayer, player.id), true);
  assert.equal(afterPlayer.phase, "retract", "the opponent must still press Draw");

  const opponentBefore = afterPlayer.players.find((candidate) => candidate.id === opponent.id)!;
  const opponentHand = opponentBefore.hand.length;
  const afterOpponent = drawTurnCard(afterPlayer, opponent.id, Date.now());
  const drawnOpponent = afterOpponent.players.find((candidate) => candidate.id === opponent.id)!;
  assert.equal(drawnOpponent.hand.length, opponentHand + 2);
  assert.equal(afterOpponent.phase, "energize");
});
