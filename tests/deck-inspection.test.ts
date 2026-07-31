import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  redactForPlayer,
  resolveStructuredEffect,
  submitCardChoice,
  type CardType,
  type GameCard,
  type PendingEffect,
} from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { enhanceDeckInspectionAbilities } from "../lib/rules/deck-inspection";
import { compileCardEffect } from "../lib/rules/effects";
import type { AbilityDefinition } from "../lib/rules/model";

function catalogueCard(catalogId: string, instance = `test-${catalogId}`) {
  const source = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id: instance };
}

function deckCard(source: GameCard, index: number) {
  return { ...source, id: `deck-window-${index}` };
}

function catalogueCardOfType(type: CardType, index = 0) {
  const source = CARDS.filter((card) => card.type === type)[index];
  assert.ok(source, `Missing ${type} catalogue card ${index}`);
  return source;
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

function matchWithMixedDeck() {
  const state = matchWithKnownDeck();
  const cards = [
    catalogueCardOfType("Action", 0),
    catalogueCardOfType("Hero", 0),
    catalogueCardOfType("Flip", 0),
    catalogueCardOfType("Evo", 0),
    catalogueCardOfType("Action", 1),
    catalogueCardOfType("Hero", 1),
  ].map(deckCard);
  state.players[0].deckCards = cards;
  state.players[0].deck = cards.length;
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

test("top-deck selection creates a bounded choice and an executable selected-card path", () => {
  const card = {
    ...catalogueCard("bb-78", "synthetic-top-selection"),
    effect: "Look at the top three cards of your deck. Put one of them into your hand.",
  };
  const empty = [{ kind: "sequence" as const, effects: [] }];
  const abilities: AbilityDefinition[] = [{
    id: "synthetic:spell",
    kind: "spell",
    instructions: [
      {
        id: "synthetic:look",
        condition: { kind: "always" },
        effects: empty,
        actions: empty,
        choices: [],
        sourceText: "Look at the top three cards of your deck.",
      },
      {
        id: "synthetic:select",
        condition: { kind: "always" },
        effects: empty,
        actions: empty,
        choices: [],
        sourceText: "Put one of them into your hand.",
      },
    ],
  }];
  const instruction = enhanceDeckInspectionAbilities(card, abilities)[0].instructions[0];
  assert.ok(instruction.choices.some((choice) => choice.id === "deckCardId" && choice.maximum === 1));
  assert.ok(instruction.effects.some((effect) => effect.kind === "reorder-deck" && effect.amount === 3));
  assert.ok(instruction.effects.some((effect) => effect.kind === "draw" && effect.amount === 1));
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

test("Toshi opens a private full-deck browser while limiting selection to Action cards", () => {
  const state = matchWithMixedDeck();
  const toshi = catalogueCard("bb-193", "toshi-search-instance");
  const instruction = compileCardEffect(toshi).instructions.find((candidate) => (
    /search your deck for an Action card/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);

  const viewerSpec = instruction.choices.find((choice) => choice.id === "orderedCardIds");
  const selectionSpec = instruction.choices.find((choice) => choice.id === "deckCardId");
  assert.ok(viewerSpec);
  assert.ok(selectionSpec);
  assert.equal(viewerSpec.minimum, 0);
  assert.equal(viewerSpec.maximum, 0);
  assert.match(viewerSpec.label, /search all cards in your deck/i);
  assert.equal(selectionSpec.cardType, "Action");
  assert.equal(ruleDefinitionForCard(toshi).play.choices.some((choice) => (
    choice.id === "orderedCardIds" || choice.id === "deckCardId"
  )), false);

  const schema = buildChoiceSchemaFromSpecs(state, "a", toshi, instruction.choices, "resolve");
  const viewer = schema.fields.find((field) => field.id === "orderedCardIds");
  const selection = schema.fields.find((field) => field.id === "deckCardId");
  assert.ok(viewer);
  assert.ok(selection);
  assert.equal(viewer.kind, "deck-order");
  assert.equal(viewer.visibility, "private");
  assert.equal(viewer.minimum, 0);
  assert.equal(viewer.maximum, 0);
  assert.deepEqual(
    viewer.options.map((option) => option.id),
    state.players[0].deckCards.map((card) => card.id),
  );
  assert.ok(viewer.options.every((option) => option.card?.id === option.id));
  assert.ok(selection.options.length > 0);
  assert.ok(selection.options.every((option) => option.card?.type === "Action"));

  state.pendingChoice = {
    id: "private-full-deck-search",
    kind: "resolution",
    controllerId: "a",
    cardId: toshi.id,
    schema,
    answers: {},
    createdVersion: state.version,
  };
  const opponentView = redactForPlayer(state, "b");
  assert.equal(opponentView.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds")?.options.length, 0);
  assert.equal(opponentView.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId")?.options.length, 0);
});

test("Lia search moves the selected Hero to hand and leaves every other card in the shuffled deck", () => {
  const initial = matchWithMixedDeck();
  const lia = catalogueCard("bb-202", "lia-search-resolution");
  const deckBefore = initial.players[0].deckCards.map((card) => card.id);
  const handBefore = initial.players[0].hand.length;
  const epochBefore = initial.informationEpoch;

  const instruction = compileCardEffect(lia).instructions.find((candidate) => (
    /search your deck for a Hero card/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);
  const effect = pendingEffect(lia);
  effect.effect = instruction.sourceText;
  let state = resolveStructuredEffect(initial, effect);
  const viewer = state.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds");
  const selection = state.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId");
  assert.ok(viewer);
  assert.ok(selection);
  assert.equal(viewer.options.length, deckBefore.length);
  assert.ok(selection.options.every((option) => option.card?.type === "Hero"));

  const selected = selection.options[0];
  assert.ok(selected);
  state = submitCardChoice(state, "a", { deckCardId: selected.id });

  const player = state.players[0];
  assert.equal(state.pendingChoice, undefined);
  assert.equal(player.hand.length, handBefore + 1);
  assert.equal(player.hand.at(-1)?.id, selected.id);
  assert.equal(player.deckCards.some((card) => card.id === selected.id), false);
  assert.equal(player.deck, deckBefore.length - 1);
  assert.deepEqual(
    new Set(player.deckCards.map((card) => card.id)),
    new Set(deckBefore.filter((id) => id !== selected.id)),
  );
  assert.ok(state.informationEpoch > epochBefore);
  assert.ok(state.log.some((entry) => (
    entry.message.includes("searched, revealed")
    && entry.message.includes("then shuffled")
  )));
});

test("the gameplay runtime mounts distinct draggable, reveal, and full-deck search presentations", async () => {
  const [layer, styles, searchStyles, runtime, genericChoices, engine] = await Promise.all([
    readFile(new URL("../components/game-screen-v2/DeckInspectionLayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/DeckInspectionLayer.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/DeckSearchLayer.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/GameplayRuntime.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/game-screen-v2/ChoiceQueueLayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/game.ts", import.meta.url), "utf8"),
  ]);
  assert.match(layer, /data-deck-inspection-mode/);
  assert.match(layer, /draggable=\{allowReorder/);
  assert.match(layer, /onDrop=\{\(event\) => dropCard/);
  assert.match(layer, /deckCardId: selectedId/);
  assert.match(layer, /resolvedOrder/);
  assert.match(layer, /PUBLIC DECK REVEAL/);
  assert.match(layer, /PRIVATE DECK VIEW/);
  assert.match(layer, /PRIVATE DECK SEARCH/);
  assert.match(layer, /isFullDeckSearchField/);
  assert.match(layer, /eligibleIds/);
  assert.match(styles, /\.revealPanel/);
  assert.match(styles, /\.moveControls/);
  assert.match(searchStyles, /\.searchPanel/);
  assert.match(searchStyles, /\.searchCards/);
  assert.match(searchStyles, /\[data-eligible="false"\]/);
  assert.match(runtime, /<DeckInspectionLayer \/>/);
  assert.ok(runtime.indexOf("<DeckInspectionLayer />") < runtime.indexOf("<ChoiceQueueLayer />"));
  assert.match(genericChoices, /deckInspectionActive/);
  assert.match(engine, /case "search": \{[\s\S]*shuffle\(player\.deckCards\)/);
});
