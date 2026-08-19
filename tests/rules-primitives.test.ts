import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard, type MatchState } from "../lib/game";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { copyRuleObject, createRuleObject } from "../lib/rules/objects";
import {
  evaluateAmountExpression,
  playerIdsForScope,
  zoneOwnerIdsFor,
  type AmountExpression,
} from "../lib/rules/primitives";
import type { ChoiceSpec } from "../lib/rules/model";

function stateWithPlayers(count = 2): MatchState {
  const players = [
    makePlayer("first", "First", STARTER_DECKS[0]),
    makePlayer("second", "Second", STARTER_DECKS[1]),
    makePlayer("third", "Third", STARTER_DECKS[2]),
  ].slice(0, count);
  const state = createMatch("PRIMITIVES", "bo1", players.slice(0, 2));
  if (count > 2) state.players.push(players[2]);
  return state;
}

function instance(card: GameCard, id: string): GameCard {
  return { ...card, id };
}

test("player scope is independent of two-player opponent assumptions", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(playerIdsForScope(state, "controller", { controllerId: "first" }), ["first"]);
  assert.deepEqual(playerIdsForScope(state, "opponent", { controllerId: "first" }), ["second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "each-player", { controllerId: "first" }), ["first", "second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "chosen-player", { controllerId: "first", chosenPlayerId: "third" }), ["third"]);
});

test("zone ownership can follow the chooser or a separately chosen player", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(zoneOwnerIdsFor(state, "chooser", { controllerId: "first", chooserId: "second" }), ["second"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "chosen-player", { controllerId: "first", choices: { targetPlayerId: "third" } }), ["third"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "opponent", { controllerId: "first" }), ["second", "third"]);
});

test("dynamic amount expressions evaluate typed counts and arithmetic", () => {
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-a"), instance(CARDS.find((card) => card.type === "Hero")!, "hero-b")];
  const expression: AmountExpression = {
    kind: "product",
    factors: [
      { kind: "constant", value: 100 },
      { kind: "count", source: "hero", owner: "controller" },
    ],
  };
  assert.equal(evaluateAmountExpression(state, expression, { controllerId: "first" }), 200);
  assert.equal(evaluateAmountExpression(state, { kind: "choice-value", choiceId: "xValue" }, { controllerId: "first", choices: { xValue: 4 } }), 4);
});

test("chooser ownership and hidden-zone ownership are independent", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Opponent chooses from controller hand",
    minimum: 1,
    maximum: 1,
    chooser: "opponent",
    owner: "controller",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0].chooserId, "second");
  assert.deepEqual(schema.fields[0].options.map((option) => [option.id, option.ownerId]), [["first-hand", "first"]]);
});

test("each-player choices build a distinct legal option pool from each chooser's own zone", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Each player discards",
    minimum: 1,
    maximum: 1,
    chooser: "each-player",
    owner: "chooser",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.simultaneous, true);
  assert.deepEqual(schema.fields.map((field) => [field.chooserId, field.options.map((option) => option.id)]), [
    ["first", ["first-hand"]],
    ["second", ["second-hand"]],
  ]);
});

test("catalogue primitives compile player scope, copy and typed dynamic amounts", () => {
  const base = CARDS[0];
  const drawCard = { ...base, effect: "Each player draws two cards." };
  const draw = parseAtomicEffects(drawCard, drawCard.effect).find((action) => action.kind === "draw");
  assert.ok(draw && draw.kind === "draw");
  assert.equal(draw.playerScope, "each-player");
  assert.equal(draw.amount, 2);

  const scaleCard = { ...base, effect: "+100 [B] for each Hero you have in play." };
  const stat = parseAtomicEffects(scaleCard, scaleCard.effect).find((action) => action.kind === "modify-stat");
  assert.ok(stat && stat.kind === "modify-stat" && stat.amountExpression);
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-scale")];
  assert.equal(evaluateAmountExpression(state, stat.amountExpression, { controllerId: "first" }), 100);

  const copyCard = { ...base, effect: "Copy the effect of an Action card." };
  const copy = parseAtomicEffects(copyCard, copyCard.effect).find((action) => action.kind === "copy");
  assert.deepEqual(copy, {
    kind: "copy",
    target: "batch-action",
    independentChoices: true,
    targetChoiceId: "targetEffectId",
    count: { kind: "constant", value: 1 },
    controller: "controller",
  });
});

test("copy objects keep source identity while supporting independent or inherited selections", () => {
  const card = CARDS.find((candidate) => candidate.type === "Action")!;
  const ability = ruleDefinitionForCard(card).abilities.find((candidate) => candidate.kind !== "triggered")!;
  const source = createRuleObject({ controllerId: "first", card: instance(card, "copy-source"), ability, choices: { targetBakuganId: "bakugan-a" } });
  source.resolvedChoices = { "0": { targetBakuganId: "bakugan-a" } };

  const independent = copyRuleObject(source, "second");
  assert.equal(independent.copiedFromObjectId, source.id);
  assert.deepEqual(independent.choices, {});
  assert.deepEqual(independent.resolvedChoices, {});
  assert.notEqual(independent.independentChoiceSetId, source.independentChoiceSetId);

  const inherited = copyRuleObject(source, "second", { independentChoices: false });
  assert.deepEqual(inherited.choices, source.choices);
  assert.deepEqual(inherited.resolvedChoices, source.resolvedChoices);
});

test("Absorb compiles its optional negate-and-copy sentence as one generalized operation", () => {
  const absorb = CARDS.find((card) => card.catalogId === "bb-1")!;
  const definition = ruleDefinitionForCard(absorb);
  const instruction = definition.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.effects.some((effect) => effect.kind === "negate" && effect.copy));
  assert.ok(instruction);
  const negate = instruction.effects.find((action) => action.kind === "negate");
  assert.ok(negate && negate.kind === "negate" && negate.copy);
  assert.ok(instruction.choices.some((choice) => choice.id === "targetEffectId"));
  assert.ok(instruction.choices.some((choice) => choice.id === "confirmed"));
});
