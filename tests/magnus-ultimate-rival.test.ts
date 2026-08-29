import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  submitCardChoice,
  type GameCard,
} from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { emitRuleEvent } from "../lib/rules/triggers";

function card(catalogId: string, id: string) {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("MAGNUS", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  return state;
}

function emitPlayed(state: ReturnType<typeof match>, actorId: string, played: GameCard, id: string) {
  return emitRuleEvent(state, {
    id,
    name: "CARD_PLAYED",
    actorId,
    controllerId: actorId,
    card: played,
    cardType: played.type,
    createdAt: Date.now(),
  });
}

function resolveTopBatch(input: ReturnType<typeof match>) {
  let state = passPriority(input, input.priority);
  state = passPriority(state, state.priority);
  return state;
}

test("Magnus Ultimate Rival uses the errata text and an optional full-deck selection", () => {
  const magnus = card("aa-69", "magnus-definition");
  assert.equal(
    magnus.effect,
    "When you play this, search your deck for a card. You may put that card into your hand. Then shuffle your deck. If you have three of this in play, your Bakugan get +300 [B] and +3 [Damage Rating].",
  );

  const definition = ruleDefinitionForCard(magnus);
  const trigger = definition.abilities.find((ability) => ability.kind === "triggered");
  assert.ok(trigger);
  assert.equal(trigger.trigger?.source, "self");
  assert.match(trigger.instructions.map((instruction) => instruction.sourceText).join(" "), /You may put that card into your hand\. Then shuffle your deck\./);

  const search = trigger.instructions.find((instruction) => (
    instruction.effects.some((effect) => effect.kind === "search")
  ));
  assert.ok(search);
  const selection = search.choices.find((choice) => choice.id === "deckCardId");
  assert.ok(selection);
  assert.equal(selection.minimum, 0);
  assert.equal(selection.maximum, 1);
  assert.equal(selection.optional, true);

  const ordinaryText = definition.abilities
    .filter((ability) => ability.kind !== "triggered")
    .flatMap((ability) => ability.instructions)
    .map((instruction) => instruction.sourceText)
    .join(" ");
  assert.doesNotMatch(ordinaryText, /search your deck|shuffle your deck/i);
  assert.match(ordinaryText, /If you have three of this in play/i);
});

test("a self-play trigger fires for Magnus itself but not for later cards", () => {
  const state = match();
  const player = state.players[0];
  const magnus = card("aa-69", "magnus-in-play");

  const entryTriggers = emitPlayed(state, player.id, magnus, "magnus-entry");
  assert.equal(entryTriggers.filter((object) => object.card.id === magnus.id).length, 1);

  state.batch = [];
  player.heroes = [magnus];
  const laterCard = card("br-1", "later-action");
  const laterTriggers = emitPlayed(state, player.id, laterCard, "later-card-play");
  assert.equal(laterTriggers.some((object) => object.card.id === magnus.id), false);
});

test("generic card-play triggers remain active after self-play triggers are scoped", () => {
  const state = match();
  const player = state.players[0];
  const vicerox = card("aa-142", "vicerox-in-play");
  player.bakugan[0].evoStack = [vicerox];
  state.selected[player.id] = player.bakugan[0].id;
  const laterCard = {
    ...CARDS.find((candidate) => candidate.type === "Action" && candidate.faction === "Haos")!,
    id: "later-haos-action",
  };

  const triggers = emitPlayed(state, player.id, laterCard, "generic-card-play");
  assert.ok(triggers.some((object) => object.card.id === vicerox.id));
});

test("every catalogue self-entry trigger is source-scoped without narrowing generic play triggers", () => {
  const selfEntryCards = CARDS.filter((candidate) => (
    /when you play this(?: card)?|when this is played/i.test(candidate.effect)
  ));
  assert.ok(selfEntryCards.length >= 10, "the catalogue must exercise the shared self-entry trigger rule");
  for (const candidate of selfEntryCards) {
    const triggers = ruleDefinitionForCard(candidate).abilities.filter((ability) => (
      ability.kind === "triggered" && ability.trigger?.event === "CARD_PLAYED"
    ));
    assert.ok(triggers.length > 0, `${candidate.catalogId} ${candidate.name} must retain its entry trigger`);
    const selfEntryTriggers = triggers.filter((ability) => ability.instructions.some((instruction) => (
      /when you play this(?: card)?|when this is played/i.test(instruction.sourceText)
    )));
    assert.ok(selfEntryTriggers.every((ability) => ability.trigger?.source === "self"), `${candidate.catalogId} ${candidate.name} entry trigger must match only its own play event`);
  }

  const genericPlayCards = CARDS.filter((candidate) => (
    /when you play(?! this(?: card)?\b)/i.test(candidate.effect)
  ));
  assert.ok(genericPlayCards.length > 0);
  assert.ok(genericPlayCards.some((candidate) => ruleDefinitionForCard(candidate).abilities.some((ability) => (
    ability.kind === "triggered"
    && ability.trigger?.event === "CARD_PLAYED"
    && ability.trigger.source !== "self"
  ))));
});

test("Magnus can finish the search without taking a card and still resolves the shuffle", () => {
  let state = match();
  const player = state.players[0];
  const magnus = card("aa-69", "magnus-optional-search");
  const beforeHand = player.hand.map((candidate) => candidate.id);
  const beforeDeck = player.deckCards.map((candidate) => candidate.id);

  emitPlayed(state, player.id, magnus, "magnus-optional-entry");
  state = resolveTopBatch(state);

  const viewer = state.pendingChoice?.schema.fields.find((field) => field.id === "orderedCardIds");
  const selection = state.pendingChoice?.schema.fields.find((field) => field.id === "deckCardId");
  assert.ok(viewer);
  assert.ok(selection);
  assert.equal(selection.minimum, 0);
  assert.equal(selection.maximum, 1);
  assert.equal(selection.required, false);
  assert.equal(selection.options.length, beforeDeck.length);

  state = submitCardChoice(state, player.id, {});
  assert.equal(state.pendingChoice, undefined);
  assert.deepEqual(state.players[0].hand.map((candidate) => candidate.id), beforeHand);
  assert.deepEqual(new Set(state.players[0].deckCards.map((candidate) => candidate.id)), new Set(beforeDeck));
  assert.equal(state.batch.some((object) => object.card.id === magnus.id), false);
});

test("the full-deck search UI explains the optional no-card path", async () => {
  const layer = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../components/game-screen-v2/DeckInspectionLayer.tsx", import.meta.url),
    "utf8",
  ));
  assert.match(layer, /finish the search without taking one/i);
  assert.match(layer, /selectedId \? "Take selected card" : "Finish search"/);
});
