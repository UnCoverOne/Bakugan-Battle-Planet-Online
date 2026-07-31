import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  redactForPlayer,
  resolveStructuredEffect,
  submitCardChoice,
  type GameCard,
  type MatchState,
  type PendingEffect,
} from "../lib/game";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { compileCardEffect } from "../lib/rules/effects";

function catalogueCard(catalogId: string, instance = `test-${catalogId}`) {
  const source = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id: instance };
}

function deckCard(source: GameCard, index: number) {
  return { ...source, id: `deck-window-${index}` };
}

function matchWithKnownDeck() {
  const alpha = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const beta = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const state = createMatch("TOPDEK", "bo1", [alpha, beta]);
  const cards = CARDS.filter((card) => card.type === "Action").slice(0, 5).map(deckCard);
  state.players[0].deckCards = cards;
  state.players[0].deck = cards.length;
  state.phase = "power";
  state.turn = 2;
  state.startingPlayer = "a";
  state.priority = "a";
  state.stepLabel = "Brawl Phase • Power Step";
  return state;
}

function pendingEffect(card: GameCard): PendingEffect {
  return {
    id: `effect-${card.id}`,
    controllerId: "a",
    card,
    choices: {},
    kind: "card",
  };
}

test("The Sky's Hymn opens one private top-three ordering window", () => {
  const state = matchWithKnownDeck();
  const card = catalogueCard("bb-78", "sky-hymn-instance");
  const instruction = compileCardEffect(card).instructions.find((candidate) => (
    /look at the top three cards/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);
  assert.match(instruction.sourceText, /put them on top of your deck in any order/i);
  assert.ok(instruction.effects.some((effect) => effect.kind === "reorder-deck" && effect.amount === 3));

  const schema = buildChoiceSchemaFromSpecs(state, "a", card, instruction.choices, "resolve");
  const field = schema.fields.find((candidate) => candidate.id === "orderedCardIds");
  assert.ok(field);
  assert.equal(field.kind, "deck-order");
  assert.equal(field.visibility, "private");
  assert.equal(field.minimum, 3);
  assert.equal(field.maximum, 3);
  assert.deepEqual(field.options.map((option) => option.id), state.players[0].deckCards.slice(0, 3).map((deck) => deck.id));
  assert.ok(field.options.every((option) => option.card?.art && option.card.id === option.id));

  state.pendingChoice = {
    id: "private-look-choice",
    kind: "resolution",
    controllerId: "a",
    cardId: card.id,
    schema,
    answers: {},
    createdVersion: state.version,
  };
  const opponentView = redactForPlayer(state, "b");
  assert.equal(opponentView.pendingChoice?.schema.fields.find((candidate) => candidate.id === "orderedCardIds")?.options.length, 0);
});

test("submitting the dragged order changes only the inspected top cards", () => {
  const initial = matchWithKnownDeck();
  const before = initial.players[0].deckCards.map((card) => card.id);
  const sky = catalogueCard("bb-78", "sky-hymn-resolution");
  let state = resolveStructuredEffect(initial, pendingEffect(sky));
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "orderedCardIds");
  assert.ok(field);
  const reordered = [field.options[2].id, field.options[0].id, field.options[1].id];
  state = submitCardChoice(state, "a", { orderedCardIds: reordered });
  assert.deepEqual(state.players[0].deckCards.slice(0, 3).map((card) => card.id), reordered);
  assert.deepEqual(state.players[0].deckCards.slice(3).map((card) => card.id), before.slice(3));
  assert.equal(state.pendingChoice, undefined);
});

test("Dan Kouzo reveals the top card publicly while retaining the optional play choice", () => {
  const state = matchWithKnownDeck();
  const dan = catalogueCard("bb-207", "dan-kouzo-instance");
  const instruction = compileCardEffect(dan).instructions.find((candidate) => (
    /reveal the top card of your deck/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);
  assert.match(instruction.sourceText, /may play it for free/i);
  assert.ok(instruction.effects.some((effect) => effect.kind === "reveal" && effect.object === "deck-top"));
  assert.ok(instruction.effects.some((effect) => (
    effect.kind === "conditional"
    && effect.whenTrue.some((nested) => nested.kind === "play" && nested.source === "revealed-deck")
  )));

  const schema = buildChoiceSchemaFromSpecs(state, "a", dan, instruction.choices, "resolve");
  const reveal = schema.fields.find((candidate) => candidate.id === "orderedCardIds");
  assert.ok(reveal);
  assert.equal(reveal.visibility, "public");
  assert.equal(reveal.minimum, 1);
  assert.equal(reveal.options.length, 1);
  assert.equal(reveal.options[0].card?.id, state.players[0].deckCards[0].id);
  assert.ok(schema.fields.some((candidate) => candidate.id === "confirmed"));

  state.pendingChoice = {
    id: "public-reveal-choice",
    kind: "resolution",
    controllerId: "a",
    cardId: dan.id,
    schema,
    answers: {},
    createdVersion: state.version,
  };
  const opponentView = redactForPlayer(state, "b");
  const publicField = opponentView.pendingChoice?.schema.fields.find((candidate) => candidate.id === "orderedCardIds");
  assert.equal(publicField?.options.length, 1);
  assert.equal(publicField?.options[0].card?.displayName, state.players[0].deckCards[0].displayName);
});

test("the gameplay shell mounts distinct draggable look and reveal presentations", async () => {
  const [layer, styles, layout] = await Promise.all([
    readFile(new URL("../components/game-screen-v2/DeckInspectionLayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/DeckInspectionLayer.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layer, /data-deck-inspection-mode/);
  assert.match(layer, /draggable=\{allowReorder/);
  assert.match(layer, /onDrop=\{\(event\) => dropCard/);
  assert.match(layer, /deckCardId: selectedId/);
  assert.match(layer, /PUBLIC DECK REVEAL/);
  assert.match(layer, /PRIVATE DECK VIEW/);
  assert.match(styles, /\.revealPanel/);
  assert.match(styles, /\.moveControls/);
  assert.match(layout, /<DeckInspectionLayer \/>/);
});
