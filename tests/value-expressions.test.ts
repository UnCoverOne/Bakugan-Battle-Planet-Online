import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard, type MatchState } from "../lib/game";
import { conditionFor, parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { ruleConditionActive } from "../lib/rules/modifiers";
import type { ChoiceSpec } from "../lib/rules/model";
import {
  captureNumberValue,
  evaluateBooleanValue,
  evaluateNumberValue,
  type NumberExpression,
} from "../lib/rules/values";

function stateWithPlayers(): MatchState {
  return createMatch("VALUES", "bo1", [
    makePlayer("first", "First", STARTER_DECKS[0]),
    makePlayer("second", "Second", STARTER_DECKS[1]),
  ]);
}

function instance(card: GameCard, id: string): GameCard {
  return { ...card, id };
}

test("number expressions compose arithmetic, counts, choice values and clamps", () => {
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  const expression: NumberExpression = {
    kind: "clamp",
    minimum: 0,
    maximum: 1000,
    value: {
      kind: "subtract",
      left: {
        kind: "product",
        factors: [100, { kind: "count", source: "hero", owner: "controller" }],
      },
      right: { kind: "choice-value", choiceId: "xValue" },
    },
  };
  assert.equal(evaluateNumberValue(state, expression, { controllerId: "first", choices: { xValue: 25 } }), 175);
  assert.equal(evaluateNumberValue(state, { kind: "divide", numerator: 9, denominator: 2 }, { controllerId: "first" }), 4.5);
  assert.equal(evaluateNumberValue(state, { kind: "divide", numerator: 9, denominator: 0 }, { controllerId: "first" }), 0);
});

test("entity properties and boolean comparisons can compare two live players", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 3;
  state.players[1].cardsPlayedThisTurn = 1;
  assert.equal(evaluateBooleanValue(state, {
    kind: "compare-number",
    left: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "cards-played" },
    operator: ">",
    right: { kind: "property", subject: { kind: "player", owner: "opponent" }, property: "cards-played" },
  }, { controllerId: "first" }), true);
});

test("generic expression conditions run through ruleConditionActive", () => {
  const state = stateWithPlayers();
  state.players[0].discard = [instance(CARDS[0], "discard-a"), instance(CARDS[1], "discard-b")];
  assert.equal(ruleConditionActive(state, state.players[0], {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "discard", owner: "controller" },
      operator: ">=",
      right: 2,
    },
  }), true);
});

test("choice minimum and maximum values are evaluated from the current game state", () => {
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  state.players[0].hand = [instance(CARDS[0], "hand-a"), instance(CARDS[1], "hand-b"), instance(CARDS[2], "hand-c")];
  const source = instance(CARDS[3], "source");
  const spec: ChoiceSpec = {
    id: "handCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Choose up to one card for each Hero",
    chooser: "controller",
    owner: "controller",
    optional: true,
    minimum: 0,
    maximum: { kind: "count", source: "hero", owner: "controller" },
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.fields[0].minimum, 0);
  assert.equal(schema.fields[0].maximum, 2);
});

test("captured expressions freeze at their requested timing boundary", () => {
  const state = stateWithPlayers();
  state.players[0].cardsPlayedThisTurn = 2;
  const value: NumberExpression = {
    kind: "captured",
    key: "played-at-announce",
    at: "announce",
    value: { kind: "count", source: "cards-played", owner: "controller" },
  };
  const snapshots = captureNumberValue(state, value, { controllerId: "first", moment: "announce" });
  state.players[0].cardsPlayedThisTurn = 5;
  assert.equal(evaluateNumberValue(state, value, { controllerId: "first", moment: "resolve", capturedValues: snapshots }), 2);
});

test("catalogue compiler emits dynamic values in ordinary numeric action slots", () => {
  const base = CARDS[0];
  const card = { ...base, effect: "+100 [B] for each Hero you have in play." };
  const action = parseAtomicEffects(card, card.effect).find((candidate) => candidate.kind === "modify-stat");
  assert.ok(action && action.kind === "modify-stat");
  assert.equal(typeof action.amount, "object");
  assert.equal(action.amountExpression, undefined);

  const state = stateWithPlayers();
  const hero = CARDS.find((candidate) => candidate.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-scale")];
  assert.equal(evaluateNumberValue(state, action.amount, { controllerId: "first" }), 100);
});

test("catalogue count conditions compile to generic boolean expressions", () => {
  const condition = conditionFor("If you have two or more Hero cards in play, draw a card.");
  assert.equal(condition.kind, "expression");
  const state = stateWithPlayers();
  const hero = CARDS.find((card) => card.type === "Hero")!;
  state.players[0].heroes = [instance(hero, "hero-a"), instance(hero, "hero-b")];
  assert.equal(ruleConditionActive(state, state.players[0], condition), true);
});
