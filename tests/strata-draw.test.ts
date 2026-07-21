import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority } from "../lib/game";
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
  const resolved = passPriority(match, player.id);

  assert.ok(resolved.players[0].heroes.some((hero) => hero.id === strata.id));
  for (const candidate of resolved.players) {
    assert.equal(candidate.hand.length, before.get(candidate.id)!.hand);
    assert.equal(candidate.deckCards.length, before.get(candidate.id)!.deck);
  }
});

test("Strata adds another separate Draw action for every player", () => {
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
  drawState.drawRemainingByPlayer = {
    [player.id]: 2,
    [opponent.id]: 2,
  };

  assert.equal(turnDrawCount(drawState), 2);
  const playerHand = player.hand.length;
  const playerDeck = player.deckCards.length;
  const afterFirstPlayerDraw = drawTurnCard(drawState, player.id, Date.now());
  const firstPlayer = afterFirstPlayerDraw.players.find((candidate) => candidate.id === player.id)!;
  assert.equal(firstPlayer.hand.length, playerHand + 1);
  assert.equal(firstPlayer.deckCards.length, playerDeck - 1);
  assert.equal(playerHasDrawnTurnCard(afterFirstPlayerDraw, player.id), false);

  const afterSecondPlayerDraw = drawTurnCard(afterFirstPlayerDraw, player.id, Date.now());
  const secondPlayer = afterSecondPlayerDraw.players.find((candidate) => candidate.id === player.id)!;
  assert.equal(secondPlayer.hand.length, playerHand + 2);
  assert.equal(playerHasDrawnTurnCard(afterSecondPlayerDraw, player.id), true);
  assert.equal(afterSecondPlayerDraw.phase, "retract", "the opponent still has two Draw actions");

  const opponentBefore = afterSecondPlayerDraw.players.find((candidate) => candidate.id === opponent.id)!;
  const opponentHand = opponentBefore.hand.length;
  const afterFirstOpponentDraw = drawTurnCard(afterSecondPlayerDraw, opponent.id, Date.now());
  assert.equal(afterFirstOpponentDraw.phase, "retract");
  const afterSecondOpponentDraw = drawTurnCard(afterFirstOpponentDraw, opponent.id, Date.now());
  const drawnOpponent = afterSecondOpponentDraw.players.find((candidate) => candidate.id === opponent.id)!;
  assert.equal(drawnOpponent.hand.length, opponentHand + 2);
  assert.equal(afterSecondOpponentDraw.phase, "energize");
});
