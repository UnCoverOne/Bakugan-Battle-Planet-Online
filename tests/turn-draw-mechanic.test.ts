import { drawTurnCard, playerHasDrawnTurnCard, type TurnStartMatchState } from "../lib/turnStart";
import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, nextTurn, passPriority, type GameCard, type MatchState } from "../lib/game";
import {
  activeExtraTurnDrawModifiers,
  extraTurnDrawModifiersForCard,
  turnDrawCounts,
} from "../lib/rules/turn-draw";

function cardInstance(card: GameCard, suffix: string): GameCard {
  return { ...card, id: `${card.catalogId}-${suffix}` };
}

function resetState(): MatchState {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("DRAWMECH", "bo1", [first, second]);
  state.turn = 0;
  state.phase = "reset";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.batch = [];
  state.triggerOrders = [];
  state.pendingChoice = undefined;
  return state;
}

const bbStrata = CARDS.find((card) => (
  card.type === "Hero"
  && card.catalogId.startsWith("bb-")
  && card.displayName === "Strata"
  && /all players draw an additional card each turn/i.test(card.effect)
));
const brStrata = CARDS.find((card) => (
  card.type === "Hero"
  && card.catalogId.startsWith("br-")
  && card.displayName === "Strata"
));

assert.ok(bbStrata, "Battle Brawlers Strata must exist in the catalogue");
assert.ok(brStrata, "Bakugan Resurgence Strata must exist in the catalogue");

test("extra-turn draw is a generic rules-text mechanic, not a Strata name check", () => {
  const controllerOnly: GameCard = {
    ...bbStrata,
    id: "generic-controller-draw",
    catalogId: "ex-1",
    displayName: "Generic Draw Source",
    name: "Generic Draw Source",
    effect: "You draw an additional card each turn.",
  };
  const opponentOnly: GameCard = {
    ...bbStrata,
    id: "generic-opponent-draw",
    catalogId: "ex-2",
    displayName: "Generic Opponent Draw Source",
    name: "Generic Opponent Draw Source",
    effect: "Your opponent draws two additional cards each turn.",
  };

  assert.deepEqual(extraTurnDrawModifiersForCard(controllerOnly, "first").map(({ target, amount }) => ({ target, amount })), [
    { target: "controller", amount: 1 },
  ]);
  assert.deepEqual(extraTurnDrawModifiersForCard(opponentOnly, "first").map(({ target, amount }) => ({ target, amount })), [
    { target: "opponent", amount: 2 },
  ]);
  assert.deepEqual(extraTurnDrawModifiersForCard(brStrata, "first"), []);
});

test("Battle Brawlers Strata adds one draw to every player while in play", () => {
  const state = resetState();
  state.players[0].heroes.push(cardInstance(bbStrata, "copy-1"));

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 2,
    [state.players[1].id]: 2,
  });

  const next = nextTurn(state);
  assert.deepEqual(next.drawRemainingByPlayer, {
    [next.players[0].id]: 2,
    [next.players[1].id]: 2,
  });
});

test("multiple Battle Brawlers Strata copies stack independently", () => {
  const state = resetState();
  state.players[0].heroes.push(
    cardInstance(bbStrata, "copy-1"),
    cardInstance(bbStrata, "copy-2"),
  );

  assert.equal(activeExtraTurnDrawModifiers(state).length, 2);
  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 3,
    [state.players[1].id]: 3,
  });
});

test("Battle Brawlers Strata copies controlled by different players also stack", () => {
  const state = resetState();
  state.players[0].heroes.push(cardInstance(bbStrata, "first-copy"));
  state.players[1].heroes.push(cardInstance(bbStrata, "second-copy"));

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 3,
    [state.players[1].id]: 3,
  });
});

test("Bakugan Resurgence Strata does not activate extra-turn draw", () => {
  const state = resetState();
  state.players[0].heroes.push(
    cardInstance(brStrata, "br-copy-1"),
    cardInstance(brStrata, "br-copy-2"),
  );

  assert.equal(activeExtraTurnDrawModifiers(state).length, 0);
  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 1,
    [state.players[1].id]: 1,
  });

  const next = nextTurn(state);
  assert.deepEqual(next.drawRemainingByPlayer, {
    [next.players[0].id]: 1,
    [next.players[1].id]: 1,
  });
});

test("single-player extra-turn draw targets remain asymmetric", () => {
  const state = resetState();
  const controllerOnly: GameCard = {
    ...bbStrata,
    id: "generic-controller-draw",
    catalogId: "ex-1",
    displayName: "Generic Draw Source",
    name: "Generic Draw Source",
    effect: "You draw an additional card each turn.",
  };
  state.players[0].heroes.push(controllerOnly);

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 2,
    [state.players[1].id]: 1,
  });
});

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
