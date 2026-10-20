import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, discardToHandLimit, nextTurn, passPriority, type GameCard, type MatchState } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { maximumHandSizeForPlayer } from "../lib/rules/hand-limit";
import { extraTurnDrawModifiersForCard, turnDrawCounts } from "../lib/rules/turn-draw";

const sophie = CARDS.find((card) => card.catalogId === "sv-99");
const strata = CARDS.find((card) => card.catalogId === "bb-192");
assert.ok(sophie, "SV_99 Sophie Judson Warfield must exist");
assert.ok(strata, "BB_192 Strata must exist");

function instance(card: GameCard, id: string): GameCard {
  return { ...structuredClone(card), id };
}

function resetState(): MatchState {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("SOPHIE", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "reset";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.batch = [];
  state.triggerOrders = [];
  state.pendingChoice = undefined;
  return state;
}

function growHand(state: MatchState, playerId: string, size: number) {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.hand.push(...player.deckCards.splice(0, Math.max(0, size - player.hand.length)));
  player.deck = player.deckCards.length;
  assert.equal(player.hand.length, size);
}

test("Sophie contributes a persistent draw modifier, not an immediate Draw action", () => {
  assert.deepEqual(extraTurnDrawModifiersForCard(sophie, "first").map(({ target, amount }) => ({ target, amount })), [
    { target: "all-players", amount: 1 },
  ]);
  const definition = ruleDefinitionForCard(sophie);
  assert.equal(definition.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.actions)
    .filter((action) => action.kind === "draw").length, 0);

  const state = resetState();
  const source = instance(sophie, "sophie-in-batch");
  state.phase = "power";
  state.priority = "first";
  state.passes = ["second"];
  state.batch = [{
    id: "sophie-pending",
    controllerId: "first",
    card: source,
    choices: {},
    kind: "card",
  }];
  const before = state.players.map((player) => ({ id: player.id, hand: player.hand.length, deck: player.deckCards.length }));
  const resolved = passPriority(state, "first");
  assert.ok(resolved.players[0].heroes.some((hero) => hero.id === source.id));
  for (const old of before) {
    const player = resolved.players.find((candidate) => candidate.id === old.id)!;
    assert.equal(player.hand.length, old.hand);
    assert.equal(player.deckCards.length, old.deck);
  }
});

test("Sophie grants both players one extra draw every turn, while active", () => {
  const state = resetState();
  state.players[0].heroes.push(instance(sophie, "sophie-1"));
  assert.deepEqual(turnDrawCounts(state), { first: 2, second: 2 });
  const next = nextTurn(state);
  assert.deepEqual(next.drawRemainingByPlayer, { first: 2, second: 2 });
  next.players[0].heroes = [];
  assert.deepEqual(turnDrawCounts(next), { first: 1, second: 1 });
});

test("Strata and Sophie stack, but disappear when removed", () => {
  const state = resetState();
  state.players[0].heroes.push(instance(sophie, "sophie-1"), instance(strata, "strata-1"));
  assert.deepEqual(turnDrawCounts(state), { first: 3, second: 3 });
  state.players[0].heroes.push(instance(sophie, "sophie-2"));
  assert.deepEqual(turnDrawCounts(state), { first: 4, second: 4 });
  state.players[0].heroes.splice(0, 1);
  assert.deepEqual(turnDrawCounts(state), { first: 3, second: 3 });
});

test("Sophie changes both hand limits and enforces them at Reset", () => {
  const state = resetState();
  state.players[0].heroes.push(instance(sophie, "sophie-1"));
  assert.equal(maximumHandSizeForPlayer(state, "first"), 8);
  assert.equal(maximumHandSizeForPlayer(state, "second"), 6);
  growHand(state, "first", 9);
  growHand(state, "second", 7);

  const discardFirst = nextTurn(state);
  assert.equal(discardFirst.phase, "handLimit");
  assert.equal(discardFirst.priority, "first");

  const first = discardToHandLimit(discardFirst, "first", [discardFirst.players[0].hand[0].id]);
  assert.equal(first.players[0].hand.length, 8);
  assert.equal(first.phase, "handLimit");
  assert.equal(first.priority, "second");

  const second = discardToHandLimit(first, "second", [first.players[1].hand[0].id]);
  assert.equal(second.players[1].hand.length, 6);
  assert.equal(second.phase, "draw");
});

test("multiple Sophies stack and opposing copies cancel their limits", () => {
  const state = resetState();
  state.players[0].heroes.push(instance(sophie, "sophie-1"), instance(sophie, "sophie-2"));
  assert.equal(maximumHandSizeForPlayer(state, "first"), 9);
  assert.equal(maximumHandSizeForPlayer(state, "second"), 5);
  state.players[1].heroes.push(instance(sophie, "opposing-sophie"));
  assert.equal(maximumHandSizeForPlayer(state, "first"), 8);
  assert.equal(maximumHandSizeForPlayer(state, "second"), 6);
  state.players[0].heroes = [];
  assert.equal(maximumHandSizeForPlayer(state, "first"), 6);
  assert.equal(maximumHandSizeForPlayer(state, "second"), 8);
});
