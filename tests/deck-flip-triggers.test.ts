import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  submitCardChoice,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { flipDamageCard } from "../lib/manualDamage";
import {
  flipTieBreakCard,
  manualTieBreakState,
  passPriorityWithTieBreak,
  playerCanFlipTieBreak,
} from "../lib/manualTieBreak";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function card(catalogId: string, id: string): GameCard {
  const template = CARD_BY_ID.get(catalogId);
  assert.ok(template, `Missing ${catalogId}`);
  return { ...structuredClone(template), id };
}

function damageState(deckCard: GameCard, pendingDamage = 5) {
  const loser = makePlayer("loser", "Loser", STARTER_DECKS[0]);
  const winner = makePlayer("winner", "Winner", STARTER_DECKS[1]);
  loser.deckCards = [deckCard];
  loser.deck = 1;
  loser.discard = [];
  const state = createMatch("DECK_FLIP", "bo1", [loser, winner]);
  Object.assign(state, {
    turn: 1,
    phase: "damage",
    pendingLoser: loser.id,
    pendingDamage,
    damageOrigin: winner.bakugan[0].id,
    priority: loser.id,
  });
  return state;
}

test("all deck-flip Baku-Gear printings compile their self trigger", () => {
  const ids = ["sv-105", "sv-110", "sv-112", "sv-117", "sv-120", "sv-124"];
  for (const id of ids) {
    const definition = ruleDefinitionForCard(card(id, `deck-flip-${id}`));
    const ability = definition.abilities.find((candidate) => candidate.kind === "triggered");
    assert.equal(ability?.trigger?.event, "CARD_FLIPPED_FROM_DECK");
    assert.equal(ability?.trigger?.source, "self");
    assert.ok(ability?.instructions.flatMap((instruction) => instruction.actions).some((action) => action.kind === "pay-energy"));
  }
});

test("damage deck flips offer an immediate owner-only Pay/Skip choice", () => {
  let state = flipDamageCard(damageState(card("sv-117", "wrecking-ball")), "loser");
  const confirmation = state.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
  assert.ok(confirmation);
  assert.equal(confirmation.label, "Pay 2 Energy?");
  assert.deepEqual(confirmation.options.map((option) => option.label), ["Pay 2 Energy", "Skip"]);
  assert.equal(confirmation.options.find((option) => option.id === "yes")?.disabled, true);
  assert.throws(() => submitCardChoice(state, "winner", { confirmed: false }), /another player/);
  state = submitCardChoice(state, "loser", { confirmed: false });
  assert.equal(state.pendingChoice, undefined);
  assert.deepEqual(state.players[0].discard.map((candidate) => candidate.id), ["wrecking-ball"]);
});

test("Wrecking Ball pays normal Energy and generates its printed bonus", () => {
  let state = damageState(card("sv-117", "wrecking-ball"));
  const paymentCard = card("bb-1", "payment-1");
  state.players[0].energyZone = [paymentCard, { ...paymentCard, id: "payment-2" }];
  state = flipDamageCard(state, "loser");
  state = submitCardChoice(state, "loser", { confirmed: true });
  assert.equal(state.players[0].energy, 4);
  assert.equal(state.players[0].discard.some((candidate) => candidate.id === "wrecking-ball"), true);
});

test("Gaia Rockets energizes a selected hand card after normal payment", () => {
  let state = damageState(card("sv-120", "gaia-rockets"));
  const handCard = card("bb-1", "gaia-hand-card");
  const paymentCard = card("bb-2", "gaia-payment");
  state.players[0].hand = [handCard];
  state.players[0].energyZone = [{ ...paymentCard, id: "gaia-payment-1" }, { ...paymentCard, id: "gaia-payment-2" }];
  state = flipDamageCard(state, "loser");
  state = submitCardChoice(state, "loser", { confirmed: true, handCardIds: [handCard.id] });
  assert.equal(state.players[0].energyZone.some((candidate) => candidate.id === handCard.id), true);
  assert.equal(state.players[0].hand.some((candidate) => candidate.id === handCard.id), false);
});

test("Combo Cannon attaches itself to a legal open Bakugan", () => {
  let state = damageState(card("sv-124", "combo-cannon"));
  const paymentCard = card("bb-1", "combo-payment");
  state.players[0].energyZone = [{ ...paymentCard, id: "combo-payment-1" }, { ...paymentCard, id: "combo-payment-2" }];
  state.players[0].bakugan[0].open = true;
  const targetId = state.players[0].bakugan[0].id;
  state = flipDamageCard(state, "loser");
  state = submitCardChoice(state, "loser", { confirmed: true, targetBakuganId: targetId });
  assert.deepEqual(state.players[0].bakugan[0].bakuGear?.map((candidate) => candidate.id), ["combo-cannon"]);
  assert.equal(state.players[0].discard.some((candidate) => candidate.id === "combo-cannon"), false);
});

test("tie-break deck flips pause the flipping owner before the opponent may flip", () => {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  first.deckCards = [card("sv-117", "tie-wrecking")];
  first.deck = 1;
  const tieAction = card("bb-1", "tie-action");
  tieAction.cost = 1;
  second.deckCards = [tieAction];
  second.deck = 1;
  const state = createMatch("TIE_FLIP", "bo1", [first, second]);
  Object.assign(state, { turn: 1, phase: "power", startingPlayer: first.id, priority: second.id, passes: [first.id] });
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  first.bakugan[0].bPower = 500;
  second.bakugan[0].bPower = 500;
  first.bakugan[0].character.bPower = 500;
  second.bakugan[0].character.bPower = 500;

  let next: MatchState = passPriorityWithTieBreak(state, second.id);
  next = flipTieBreakCard(next, first.id);
  assert.equal(playerCanFlipTieBreak(next, second.id), false);
  assert.equal(next.pendingChoice?.controllerId, first.id);
  next = submitCardChoice(next, first.id, { confirmed: false });
  assert.equal(playerCanFlipTieBreak(next, second.id), true);
  next = flipTieBreakCard(next, second.id);
  assert.equal(manualTieBreakState(next)?.status, "resolved");
});
