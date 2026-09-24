import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  playCard,
  resolveStructuredEffect,
  submitCardChoice,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { emitRuleEvent } from "../lib/rules/triggers";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { createRuleObject } from "../lib/rules/objects";
import { conditionFor, durationFor, ruleCardId } from "../lib/rules/catalogue-primitives";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function triggerState(source: GameCard): MatchState {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("HAND-REVEAL", "bo1", [owner, opponent]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = owner.id;
  state.priority = owner.id;
  state.selected[owner.id] = owner.bakugan[0].id;
  owner.bakugan[0].open = true;
  owner.hand = [source];
  return state;
}

function emitHandReveal(state: MatchState, revealed: GameCard, cause: GameCard) {
  return emitRuleEvent(state, {
    id: `hand-reveal:${revealed.id}:${cause.id}`,
    name: "CARD_REVEALED_FROM_HAND",
    actorId: state.players[0].id,
    controllerId: state.players[0].id,
    card: revealed,
    cardType: revealed.type,
    causeCard: cause,
    createdAt: Date.now(),
  });
}

const LEGACY_UNCHANGED_SELF_FREE_IDS = [
  "bb-152", "bb-165", "bb-171", "bb-184",
  "br-102", "br-128",
  "aa-25", "aa-47", "aa-112",
  "av-98", "av-155",
  "ff-83",
  "sv-99", "sv-100", "sv-101", "sv-102", "sv-103", "sv-148",
  "ps1-9",
] as const;

function legacySelfFreePaymentModifiers(source: GameCard) {
  const result: ReturnType<typeof ruleDefinitionForCard>["play"]["costModifiers"] = [];
  const text = source.effect;
  const discardForFree = text.match(/(?:Sacrifice\s*[-:]\s*)?You may discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? to play this for free/i);
  if (discardForFree) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[discardForFree[1].toLowerCase()] ?? Math.max(1, Number(discardForFree[1]) || 1);
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(source)}:discard-for-free`,
      label: `Sacrifice — discard ${amount} card${amount === 1 ? "" : "s"}`,
      setsBaseFree: true,
      components: [{ kind: "cost-discard", amount, choiceId: "discardCardIds" }],
    });
  }
  if (!discardForFree && /you may play this(?: card)? for free/i.test(text)) {
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(source)}:self-free`,
      label: "Play for free",
      setsBaseFree: true,
      components: [],
      condition: conditionFor(text),
    });
  } else if (!discardForFree && /play this for free|this is free/i.test(text)) {
    result.push({
      kind: "cost-free",
      duration: /\bTrifecta:/i.test(text) ? "instant" : durationFor(text),
      condition: conditionFor(text),
    });
  }
  if (ruleCardId(source) === "aa-112") {
    result.push({
      kind: "cost-alternative",
      id: "aa-112:discard-two",
      label: "Discard two cards instead of paying the printed Energy cost",
      setsBaseFree: true,
      components: [{ kind: "cost-discard", amount: 2, choiceId: "discardCardIds" }],
    });
  }
  return result;
}

function selfFreePaymentModifiers(source: GameCard) {
  return ruleDefinitionForCard(source).play.costModifiers.filter((modifier) => (
    modifier.kind === "cost-free"
    || (modifier.kind === "cost-alternative" && (
      modifier.id.endsWith(":self-free")
      || modifier.id.endsWith(":discard-for-free")
      || modifier.id === "aa-112:discard-two"
    ))
  ));
}

test("the 19 existing payment-based self-free cards retain their legacy cost behavior", () => {
  assert.equal(LEGACY_UNCHANGED_SELF_FREE_IDS.length, 19);
  for (const catalogId of LEGACY_UNCHANGED_SELF_FREE_IDS) {
    const source = card(catalogId, `legacy-${catalogId}`);
    assert.deepEqual(
      selfFreePaymentModifiers(source),
      legacySelfFreePaymentModifiers(source),
      `${catalogId} changed its self-free payment behavior`,
    );
  }
});

test("triggered self-free plays are effects, not normal payment modes", () => {
  for (const catalogId of ["ff-45", "av-152"]) {
    const source = card(catalogId, `triggered-self-free-${catalogId}`);
    assert.deepEqual(selfFreePaymentModifiers(source), []);
  }

  const howling = ruleDefinitionForCard(card("ff-45", "howling-payment"));
  assert.ok(howling.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.actions)
    .some((action) => action.kind === "play" && action.source === "revealed-hand" && action.free));

  const howlkor = ruleDefinitionForCard(card("av-152", "howlkor-payment"));
  const trigger = howlkor.abilities.find((ability) => ability.kind === "triggered");
  assert.equal(trigger?.trigger?.event, "CARD_PLAYED");
  assert.equal(trigger?.trigger?.relationship, "opponent");
  assert.equal(trigger?.trigger?.cardType, "Flip");
  assert.ok(trigger?.instructions.flatMap((instruction) => instruction.actions)
    .some((action) => action.kind === "play" && action.source === "self-hand" && action.free));
});

test("Hyper Howlkor can trigger from hand when another player plays a Flip", () => {
  const howlkor = card("av-152", "howlkor-in-hand");
  const state = triggerState(howlkor);
  const opponent = state.players[1];
  const flipSource = CARDS.find((candidate) => candidate.type === "Flip");
  assert.ok(flipSource);
  const flip = { ...flipSource, id: "opponent-flip" };

  const triggers = emitRuleEvent(state, {
    id: "opponent-played-flip",
    name: "CARD_PLAYED",
    actorId: opponent.id,
    controllerId: opponent.id,
    card: flip,
    cardType: flip.type,
    createdAt: Date.now(),
  });

  assert.equal(triggers.length, 1);
  assert.equal(triggers[0]?.card.id, howlkor.id);
  assert.equal(state.batch.some((object) => object.card.id === howlkor.id), true);
});

test("hand-reveal cards compile as self triggers with the correct payload", () => {
  for (const id of ["av-13", "ff-45", "sv-104", "sv-109"]) {
    const definition = ruleDefinitionForCard(card(id, `source-${id}`));
    const trigger = definition.abilities.find((ability) => ability.kind === "triggered");
    assert.equal(trigger?.trigger?.event, "CARD_REVEALED_FROM_HAND");
    assert.equal(trigger?.trigger?.source, "self");
    assert.equal(trigger?.trigger?.causedByCard, true);
  }
  const howling = ruleDefinitionForCard(card("ff-45", "howling"));
  assert.ok(howling.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.actions)
    .some((action) => action.kind === "play" && action.source === "revealed-hand"));
});

test("a card-caused hand reveal triggers the revealed card, but self-causation does not", () => {
  const revealed = card("sv-109", "darkus-knight");
  const cause = card("br-1", "cause");
  let state = triggerState(revealed);
  const triggers = emitHandReveal(state, revealed, cause);
  assert.equal(triggers.length, 1);
  assert.equal(state.batch.length, 1);

  state = passPriority(state, state.priority);
  state = passPriority(state, state.priority);
  assert.equal(state.pendingChoice?.cardId, revealed.id);
  assert.equal(state.pendingChoice?.schema.fields.find((field) => field.id === "targetBakuganId")?.chooserId, "owner");

  state = submitCardChoice(state, "owner", { targetBakuganId: state.players[0].bakugan[0].id });
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.batch.length, 0);

  state = triggerState(revealed);
  assert.equal(emitHandReveal(state, revealed, revealed).length, 0);
  assert.equal(state.batch.length, 0);
});

test("Sync hand reveals trigger before the Sync effect resumes", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("SYNC-REVEAL", "bo1", [owner, opponent]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = owner.id;
  state.priority = owner.id;
  state.selected[owner.id] = owner.bakugan[0].id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  owner.bakugan[0].open = true;
  owner.energy = 20;
  const sync = card("ff-2", "sync-source");
  const revealed = card("ff-45", "revealed-howling");
  owner.hand = [sync, revealed];

  let next = playCard(state, owner.id, sync.id);
  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.pendingChoice?.schema.fields.find((field) => field.id === "syncCardId")?.options.some((option) => option.id === revealed.id), true);

  next = submitCardChoice(next, owner.id, { syncCardId: [revealed.id] });
  assert.equal(next.pendingChoice?.cardId, revealed.id);
  assert.equal(next.pendingChoice?.schema.fields.find((field) => field.id === "confirmed")?.chooserId, owner.id);

  next = submitCardChoice(next, owner.id, { confirmed: false });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.batch.some((object) => object.card.id === sync.id), true);
});

test("full-hand effects trigger each revealed card before their follow-up choice", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("FULL-REVEAL", "bo1", [owner, opponent]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = owner.id;
  state.priority = owner.id;
  opponent.bakugan[0].open = true;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  const mindControl = card("br-19", "mind-control");
  const revealed = card("sv-109", "opponent-darkus-knight");
  opponent.hand = [revealed];
  const ability = ruleDefinitionForCard(mindControl).abilities.find((candidate) => candidate.kind === "spell");
  assert.ok(ability);
  const pending = createRuleObject({ controllerId: owner.id, card: mindControl, ability, kind: "card" });

  const next = resolveStructuredEffect(state, pending);
  assert.equal(next.pendingChoice?.cardId, revealed.id);
  assert.equal(next.pendingChoice?.controllerId, opponent.id);
  assert.equal(next.pendingChoice?.schema.fields.find((field) => field.id === "targetBakuganId")?.chooserId, opponent.id);
});
