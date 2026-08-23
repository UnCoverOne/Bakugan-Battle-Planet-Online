import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  emitGameEvent,
  passPriority,
  playCard,
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
import { createRuleObject } from "../lib/rules/objects";
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
  const cards = CARDS.filter((card) => card.type === "Action" && ruleDefinitionForCard(card).play.choices.filter((choice) => choice.timing === "announce").length === 0).slice(0, 5).map(deckCard);
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

function passWindow(input: ReturnType<typeof matchWithKnownDeck>) {
  let state = passPriority(input, input.priority);
  state = passPriority(state, state.priority);
  return state;
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

test("top-three ordering effects preserve scarcity while retaining reorder permission", () => {
  const sky = catalogueCard("bb-78", "sky-hymn-scarcity");
  for (const available of [2, 1]) {
    const initial = matchWithKnownDeck();
    initial.players[0].deckCards = initial.players[0].deckCards.slice(0, available);
    initial.players[0].deck = available;
    const state = resolveStructuredEffect(initial, pendingEffect(sky));
    const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "orderedCardIds");
    assert.ok(field);
    assert.equal(field.minimum, available);
    assert.equal(field.maximum, available);
    assert.equal(field.requestedWindowSize, 3);
    assert.equal(field.options.length, available);
    assert.match(field.label, /^Order/);
  }

  const empty = matchWithKnownDeck();
  empty.players[0].deckCards = [];
  empty.players[0].deck = 0;
  const resolved = resolveStructuredEffect(empty, pendingEffect(sky));
  assert.equal(resolved.pendingChoice, undefined);
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

test("reveal-and-play effects reveal before the choice and skip without adding the card to the batch", () => {
  for (const catalogId of ["bb-207", "br-36", "aa-140"]) {
    const initial = matchWithKnownDeck();
    if (catalogId === "aa-140") initial.brawlWinner = "a";
    const card = catalogueCard(catalogId, `${catalogId}-reveal-skip`);
    const instruction = compileCardEffect(card).instructions.find((candidate) => (
      /reveal the top card of your deck/i.test(candidate.sourceText)
      && /may play it for free/i.test(candidate.sourceText)
    ));
    assert.ok(instruction, `${card.name} must retain one reveal/play instruction`);
    const effect = pendingEffect(card);
    effect.kind = "trigger";
    effect.effect = instruction.sourceText;
    const topId = initial.players[0].deckCards[0].id;

    let state = resolveStructuredEffect(initial, effect);
    const player = state.players[0];
    assert.equal(player.revealedDeckCardId, topId, `${card.name} stages the mandatory reveal`);
    assert.ok(state.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
    assert.equal(state.batch.some((object) => object.card.id === topId), false);
    assert.ok(state.log.some((entry) => entry.message.includes("revealed") && entry.message.includes(player.deckCards[0].name)));

    state = submitCardChoice(state, "a", { confirmed: false });
    assert.equal(state.players[0].deckCards[0].id, topId);
    assert.equal(state.players[0].revealedDeckCardId, undefined);
    assert.equal(state.batch.some((object) => object.card.id === topId), false);
  }
});

test("a revealed non-Flip enters the batch only after Play card is chosen", () => {
  for (const catalogId of ["bb-207", "br-36", "aa-140"]) {
    const initial = matchWithKnownDeck();
    if (catalogId === "aa-140") initial.brawlWinner = "a";
    const source = catalogueCard(catalogId, `${catalogId}-play-choice`);
    const instruction = compileCardEffect(source).instructions.find((candidate) => (
      /reveal the top card of your deck/i.test(candidate.sourceText)
    ));
    assert.ok(instruction);
    const effect = pendingEffect(source);
    effect.kind = "trigger";
    effect.effect = instruction.sourceText;
    const topId = initial.players[0].deckCards[0].id;

    let state = resolveStructuredEffect(initial, effect);
    assert.equal(state.batch.some((object) => object.card.id === topId), false);
    state = submitCardChoice(state, "a", { orderedCardIds: [topId], confirmed: true });

    assert.equal(state.players[0].deckCards.some((card) => card.id === topId), false);
    assert.equal(state.players[0].revealedDeckCardId, undefined);
    assert.ok(state.batch.some((object) => object.card.id === topId), `${source.name} plays the revealed card`);
  }
});

test("a revealed Flip has Skip as its only legal decision", () => {
  const initial = matchWithMixedDeck();
  const flip = initial.players[0].deckCards.find((card) => card.type === "Flip")!;
  initial.players[0].deckCards = [flip, ...initial.players[0].deckCards.filter((card) => card.id !== flip.id)];
  const airZero = catalogueCard("br-36", "air-zero-flip-choice");
  const instruction = compileCardEffect(airZero).instructions.find((candidate) => (
    /reveal the top card of your deck/i.test(candidate.sourceText)
  ));
  assert.ok(instruction);
  const effect = pendingEffect(airZero);
  effect.effect = instruction.sourceText;

  let state = resolveStructuredEffect(initial, effect);
  const confirmation = state.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
  assert.deepEqual(confirmation?.options.map((option) => option.id), ["no"]);
  assert.throws(
    () => submitCardChoice(state, "a", { orderedCardIds: [flip.id], confirmed: true }),
    /illegal selection/,
  );
  state = submitCardChoice(state, "a", { confirmed: false });
  assert.equal(state.players[0].deckCards[0].id, flip.id);
  assert.equal(state.batch.some((object) => object.card.id === flip.id), false);
});

test("playing Dan after a Bakugan opened installs the Hero without replaying the open trigger", () => {
  let state = matchWithKnownDeck();
  const player = state.players[0];
  const dan = catalogueCard("bb-207", "dan-kouzo-after-open");
  const energySource = catalogueCard("bb-10", "dan-energy-source");
  player.hand.push(dan);
  player.energyZone = Array.from({ length: 4 }, (_, index) => ({ ...energySource, id: `dan-energy-${index}` }));
  player.energy = 0;
  state.selected[player.id] = player.bakugan[0].id;
  player.bakugan[0].open = true;
  player.bakugan[0].openedTurn = state.turn;
  const topId = player.deckCards[0].id;

  state = playCard(state, player.id, dan.id);
  state = passWindow(state);
  assert.ok(state.players[0].heroes.some((hero) => hero.id === dan.id));
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.players[0].deckCards[0].id, topId);
  assert.equal(state.players[0].revealedDeckCardId, undefined);

  emitGameEvent(state, {
    id: "dan-genuine-later-open",
    type: "open",
    playerId: player.id,
    playerIds: [player.id],
    targetBakuganId: player.bakugan[0].id,
  });
  assert.ok(state.batch.some((object) => object.card.id === dan.id && object.kind === "trigger"));
  state = passWindow(state);
  assert.ok(state.pendingChoice?.schema.fields.some((field) => field.id === "orderedCardIds"));
  assert.equal(state.players[0].revealedDeckCardId, topId);
});

test("playable permanents never use a triggered ability as their card-play program", () => {
  const triggeredPermanents = CARDS.filter((card) => {
    if (!['Hero', 'Evo'].includes(card.type)) return false;
    return ruleDefinitionForCard(card).abilities.some((ability) => ability.kind === "triggered");
  });
  assert.ok(triggeredPermanents.length > 0);
  for (const card of triggeredPermanents) {
    assert.ok(
      ruleDefinitionForCard(card).abilities.some((ability) => ability.kind !== "triggered"),
      `${card.catalogId} ${card.name} must retain a card-play entry ability`,
    );
  }

  for (const catalogId of ["bb-207", "aa-67", "aa-71"]) {
    const card = catalogueCard(catalogId, `${catalogId}-trigger-ownership`);
    const definition = ruleDefinitionForCard(card);
    const dependentText = definition.abilities
      .filter((ability) => ability.kind !== "triggered")
      .flatMap((ability) => ability.instructions)
      .map((instruction) => instruction.sourceText)
      .join(" ");
    assert.doesNotMatch(dependentText, /revealed this way|one of those cards|play it for free/i);
  }
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

test("Shun reveals and copies the opponent's top Action without moving the physical card", () => {
  const state = matchWithKnownDeck();
  const shun = catalogueCard("aa-67", "shun-opponent-deck");
  const action = { ...catalogueCardOfType("Action", 2), id: "opponent-top-action" };
  state.players[1].deckCards = [action];
  state.players[1].deck = 1;
  const ability = ruleDefinitionForCard(shun).abilities.find((candidate) => candidate.kind === "triggered");
  assert.ok(ability);

  let next = resolveStructuredEffect(state, createRuleObject({ controllerId: "a", card: shun, ability, kind: "trigger" }));
  const reveal = next.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds");
  assert.deepEqual(reveal?.options.map((option) => option.id), [action.id]);
  next = submitCardChoice(next, "a", { orderedCardIds: [action.id] });
  assert.equal(next.players[1].revealedDeckCardId, action.id);
  assert.ok(next.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
  next = submitCardChoice(next, "a", { confirmed: true });
  assert.equal(next.players[1].revealedDeckCardId, undefined);
  assert.ok(next.players[1].deckCards.some((card) => card.id === action.id));
  assert.ok(next.batch.some((object) => object.kind === "copy" && object.card.id === action.id && object.controllerId === "a"));
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
  assert.match(layer, /inspectedDeckPlay/);
  assert.match(layer, /inspectedDeckPlay \? "Skip"/);
  assert.match(layer, /fingerprintedAsset\(card\.art\)/);
  assert.doesNotMatch(layer, /<ResponsiveCardImage/);
  assert.match(layer, /"Play card"/);
  assert.match(layer, /PRIVATE DECK VIEW/);
  assert.match(layer, /PRIVATE DECK SEARCH/);
  assert.match(layer, /isFullDeckSearchField/);
  assert.match(layer, /emptyWindowSlots/);
  assert.match(layer, /data-empty-slot/);
  assert.match(layer, /eligibleIds/);
  assert.match(styles, /\.revealPanel/);
  assert.match(styles, /\.moveControls/);
  assert.match(styles, /\.emptySlot/);
  assert.doesNotMatch(styles, /minmax\(clamp\(8rem, 13vw, 10\.5rem\), 1fr\)/);
  assert.match(searchStyles, /\.searchPanel/);
  assert.match(searchStyles, /\.searchCards/);
  assert.match(searchStyles, /\[data-eligible="false"\]/);
  assert.match(runtime, /<DeckInspectionLayer \/>/);
  assert.ok(runtime.indexOf("<DeckInspectionLayer />") < runtime.indexOf("<ChoiceQueueLayer />"));
  assert.match(genericChoices, /deckInspectionActive/);
  assert.match(genericChoices, /renderableDeckInspectionField/);
  assert.match(engine, /case "search": \{[\s\S]*shuffle\(player\.deckCards\)/);
});


test("Age of Aurelus Lia keeps its top-three Hero selection in one optional play window", () => {
  const initial = matchWithMixedDeck();
  const lia = catalogueCard("aa-71", "age-of-aurelus-lia-resolution");
  const action = catalogueCard("bb-10", "lia-top-action");
  const hero = catalogueCard("br-80", "lia-top-hero");
  const flip = catalogueCard("bb-4", "lia-top-flip");
  initial.players[0].deckCards = [action, hero, flip];
  initial.players[0].deck = 3;
  const effect = pendingEffect(lia);
  effect.kind = "trigger";
  effect.effect = lia.effect;

  let state = resolveStructuredEffect(initial, effect);
  const viewer = state.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds");
  const selection = state.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId");
  const confirmation = state.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
  assert.ok(viewer && selection && confirmation);
  assert.equal(viewer.requestedWindowSize, 3);
  assert.deepEqual(selection.options.map((option) => option.id), [hero.id]);
  assert.deepEqual(confirmation.options.map((option) => option.id), ["yes", "no"]);
  assert.equal(state.batch.some((object) => object.card.id === hero.id), false);

  state = submitCardChoice(state, "a", {
    orderedCardIds: viewer.options.map((option) => option.id),
    deckCardId: hero.id,
    confirmed: true,
  });
  assert.equal(state.players[0].deckCards.some((candidate) => candidate.id === hero.id), false);
  assert.ok(state.batch.some((object) => object.card.id === hero.id && object.kind === "card"));
});

test("Age of Aurelus Lia shrinks its inspection to the cards actually remaining", () => {
  for (const available of [2, 1]) {
    const initial = matchWithMixedDeck();
    const lia = catalogueCard("aa-71", `lia-scarcity-${available}`);
    const hero = catalogueCard("br-80", `lia-scarcity-hero-${available}`);
    const action = catalogueCard("bb-10", `lia-scarcity-action-${available}`);
    initial.players[0].deckCards = [hero, action].slice(0, available);
    initial.players[0].deck = available;
    const effect = pendingEffect(lia);
    effect.kind = "trigger";
    effect.effect = lia.effect;

    let state = resolveStructuredEffect(initial, effect);
    const viewer = state.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds");
    const selection = state.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId");
    assert.ok(viewer && selection);
    assert.equal(viewer.minimum, available);
    assert.equal(viewer.maximum, available);
    assert.equal(viewer.requestedWindowSize, 3);
    assert.equal(viewer.options.length, available);
    assert.deepEqual(selection.options.map((option) => option.id), [hero.id]);

    state = submitCardChoice(state, "a", {
      orderedCardIds: viewer.options.map((option) => option.id),
      deckCardId: hero.id,
      confirmed: true,
    });
    assert.ok(state.batch.some((object) => object.card.id === hero.id && object.kind === "card"));
  }
});

test("Age of Aurelus Lia is an automatic no-op with an empty deck", () => {
  const initial = matchWithMixedDeck();
  const lia = catalogueCard("aa-71", "lia-empty-deck");
  initial.players[0].deckCards = [];
  initial.players[0].deck = 0;
  const effect = pendingEffect(lia);
  effect.kind = "trigger";
  effect.effect = lia.effect;

  const state = resolveStructuredEffect(initial, effect);
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.batch.some((object) => object.id === effect.id), false);
  assert.ok(state.log.some((entry) => /no cards to inspect/i.test(entry.message)));
});

test("Age of Aurelus Lia only offers Skip when the short window has no Hero", () => {
  const initial = matchWithKnownDeck();
  initial.players[0].deckCards = initial.players[0].deckCards.slice(0, 2);
  initial.players[0].deck = 2;
  const lia = catalogueCard("aa-71", "lia-short-window-no-hero");
  const effect = pendingEffect(lia);
  effect.kind = "trigger";
  effect.effect = lia.effect;

  const state = resolveStructuredEffect(initial, effect);
  const confirmation = state.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
  assert.deepEqual(confirmation?.options.map((option) => option.id), ["no"]);
});

test("skipping Age of Aurelus Lia leaves every inspected card on the deck", () => {
  const initial = matchWithMixedDeck();
  const lia = catalogueCard("aa-71", "age-of-aurelus-lia-skip");
  const before = initial.players[0].deckCards.slice(0, 3).map((card) => card.id);
  const effect = pendingEffect(lia);
  effect.kind = "trigger";
  effect.effect = lia.effect;
  let state = resolveStructuredEffect(initial, effect);
  state = submitCardChoice(state, "a", { confirmed: false });
  assert.deepEqual(state.players[0].deckCards.slice(0, 3).map((card) => card.id), before);
  assert.equal(state.pendingChoice, undefined);
});
