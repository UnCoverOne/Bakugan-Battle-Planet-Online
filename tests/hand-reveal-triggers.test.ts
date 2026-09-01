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
