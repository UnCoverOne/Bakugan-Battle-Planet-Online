import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { playCardWithAutoEnergy } from "../lib/cardPayment";
import {
  createMatch,
  resolveStructuredEffect,
  type GameCard,
} from "../lib/game";
import { evoCanTarget } from "../lib/evo";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { emitRuleEvent } from "../lib/rules/triggers";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...structuredClone(source), id };
}

test("Maximus Nillious compiles its conditional global end-turn return", () => {
  const maximus = card("av-135", "maximus-definition");
  const definition = ruleDefinitionForCard(maximus);
  const endTurn = definition.abilities.find((ability) => ability.trigger?.event === "TURN_ENDED");
  assert.ok(endTurn);
  assert.equal(endTurn.trigger?.relationship, "any");
  assert.equal(endTurn.trigger?.interveningCondition?.kind, "played-for-free-this-turn");
  const returnAction = endTurn.instructions
    .flatMap((instruction) => instruction.effects)
    .find((effect) => effect.kind === "move" && effect.verb === "return" && effect.object === "card");
  assert.deepEqual(returnAction && {
    subject: returnAction.subject,
    destination: returnAction.destination,
  }, {
    subject: "self",
    destination: "owner-hand",
  });
});

test("Maximus Nillious played as the second Rapid Fire returns from a closed Bakugan at end of turn", () => {
  const owner = makePlayer("maximus-owner", "Maximus Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("maximus-opponent", "Opponent", STARTER_DECKS[1]);
  let state = createMatch("MAXIMUS135", "bo1", [owner, opponent]);
  const liveOwner = state.players.find((player) => player.id === owner.id)!;
  const liveOpponent = state.players.find((player) => player.id === opponent.id)!;

  const nillious = card("av-203", "darkus-nillious-character");
  const maximus = card("av-135", "maximus-free");
  liveOwner.bakugan[0].character = nillious;
  liveOwner.bakugan[0].name = "Nillious";
  liveOwner.bakugan[0].faction = "Darkus";
  liveOwner.bakugan[0].open = false;
  liveOwner.bakugan[0].evoStack = [];
  liveOwner.hand = [maximus];
  liveOwner.energy = 0;
  liveOwner.energyZone = [];
  liveOwner.cardsPlayedThisTurn = 1;
  liveOwner.playedCardMechanicsThisTurn = ["Rapid Fire"];

  state.turn = 4;
  state.phase = "power";
  state.startingPlayer = liveOpponent.id;
  state.priority = liveOwner.id;
  state.selected = { [liveOpponent.id]: liveOpponent.bakugan[0].id };

  const target = liveOwner.bakugan[0];
  assert.equal(evoCanTarget(maximus, target), true);

  state = playCardWithAutoEnergy(state, liveOwner.id, maximus.id, {
    targetBakuganId: target.id,
  });
  const cardObject = state.batch.find((object) => object.card.id === maximus.id);
  assert.ok(cardObject);
  state = resolveStructuredEffect(state, cardObject);

  const evolvedOwner = state.players.find((player) => player.id === liveOwner.id)!;
  const evolvedTarget = evolvedOwner.bakugan.find((bakugan) => bakugan.id === target.id)!;
  const inPlay = evolvedTarget.evoStack.find((candidate) => candidate.id === maximus.id);
  assert.ok(inPlay);
  assert.equal(inPlay.playedForFreeTurn, state.turn);
  assert.equal(evolvedTarget.open, false);
  assert.equal(state.selected[liveOwner.id], undefined);

  const triggers = emitRuleEvent(state, {
    id: "maximus-end-turn",
    name: "TURN_ENDED",
    actorId: liveOpponent.id,
    controllerId: liveOpponent.id,
    createdAt: 0,
  });
  const returnTrigger = triggers.find((object) => object.card.id === maximus.id);
  assert.ok(returnTrigger, "closed Maximus Nillious should trigger even when the opponent is the starting player");

  state = resolveStructuredEffect(state, returnTrigger);
  const returnedOwner = state.players.find((player) => player.id === liveOwner.id)!;
  assert.equal(returnedOwner.hand.some((candidate) => candidate.id === maximus.id), true);
  assert.equal(returnedOwner.bakugan.some((bakugan) => bakugan.evoStack.some((candidate) => candidate.id === maximus.id)), false);
});

test("Maximus Nillious does not return when it was not played for free this turn", () => {
  const owner = makePlayer("paid-owner", "Paid Owner", STARTER_DECKS[0]);
  const opponent = makePlayer("paid-opponent", "Paid Opponent", STARTER_DECKS[1]);
  const state = createMatch("MAXIMUSPAID", "bo1", [owner, opponent]);
  const liveOwner = state.players.find((player) => player.id === owner.id)!;
  const liveOpponent = state.players.find((player) => player.id === opponent.id)!;
  const maximus = card("av-135", "maximus-paid");

  state.turn = 5;
  state.startingPlayer = liveOpponent.id;
  liveOwner.bakugan[0].open = false;
  liveOwner.bakugan[0].evoStack = [{ ...maximus, playedTurn: state.turn }];

  const triggers = emitRuleEvent(state, {
    id: "maximus-paid-end-turn",
    name: "TURN_ENDED",
    actorId: liveOpponent.id,
    controllerId: liveOpponent.id,
    createdAt: 0,
  });
  assert.equal(triggers.some((object) => object.card.id === maximus.id), false);
});
