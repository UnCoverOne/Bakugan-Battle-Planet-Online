import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, nextTurn, type GameCard, type MatchState } from "../lib/game";
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
