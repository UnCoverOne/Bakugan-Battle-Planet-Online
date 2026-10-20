import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch, emitGameEvent, energizeCard, passPriority, playCard, submitCardChoice,
  type GameCard, type MatchState,
} from "../lib/game";
import { activePendingDraw, drawPendingCard } from "../lib/drawQueue";
import { activeUnchargedEnergyIds } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import {
  additionalTurnEnergizesForPlayer, actionCardsEnergizeUnchargedForPlayer,
} from "../lib/rules/energize-permissions";

const SELF_TRIGGERS = ["sv-2", "sv-15", "sv-28", "sv-36", "sv-44"] as const;
function card(catalogId: string, id = catalogId): GameCard {
  const template = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(template, "Missing " + catalogId);
  return { ...template, id };
}
function fixture(label: string) {
  const first = makePlayer("batch3-first", "First", STARTER_DECKS[0]);
  const second = makePlayer("batch3-second", "Second", STARTER_DECKS[1]);
  const state = createMatch(label, "bo1", [first, second]);
  state.turn = 3; state.phase = "power"; state.startingPlayer = first.id; state.priority = first.id;
  first.hand = []; first.heroes = []; first.discard = [];
  second.hand = []; second.heroes = []; second.discard = [];
  first.deckCards = [card("bb-1", "drawn-card"), card("bb-2", "second-drawn")];
  first.deck = first.deckCards.length;
  first.energyZone = Array.from({ length: 10 }, (_, i) => card("bb-3", "own-energy-" + i));
  second.energyZone = Array.from({ length: 10 }, (_, i) => card("bb-4", "opp-energy-" + i));
  first.energy = second.energy = 0;
  return { state, first, second };
}
function resolveUntilChoiceOrEmpty(input: MatchState) {
  let state = input;
  for (let i = 0; i < 20 && state.batch.length && !state.pendingChoice && !activePendingDraw(state); i++) {
    state = passPriority(state, state.priority);
  }
  return state;
}
test("all five hand-Energize draw cards compile self-only zone-specific paid triggers", () => {
  const found = CARDS.filter((candidate) => /If you Energize this from your hand/i.test(candidate.effect))
    .map((candidate) => candidate.catalogId).sort();
  assert.deepEqual(found, [...SELF_TRIGGERS].sort());
  for (const id of SELF_TRIGGERS) {
    const definition = ruleDefinitionForCard(card(id));
    const triggered = definition.abilities.find((ability) => ability.kind === "triggered"
      && ability.trigger?.event === "ENERGY_CARD_ENERGIZED");
    assert.ok(triggered, id + " has no self-Energize trigger");
    assert.equal(triggered.trigger?.source, "self");
    assert.equal(triggered.trigger?.energizeSourceZone, "hand");
    const actions = triggered.instructions.flatMap((instruction) => instruction.actions);
    assert.ok(actions.some((action) => action.kind === "pay-energy" && action.amount === 2), id);
    assert.ok(actions.some((action) => action.kind === "draw" && action.amount === 1), id);
    assert.equal(actions.some((action) => action.kind === "energize"), false, id);
  }
});
for (const id of SELF_TRIGGERS) {
  test(id + " pays 2 Energy to Draw after its own hand Energize", () => {
    const { state, first, second } = fixture("BATCH3-SELF-" + id);
    state.phase = "energize"; second.energizedThisTurn = true;
    const source = card(id, "energized-" + id);
    first.hand = [source, card("bb-5", "held")];
    let next = energizeCard(state, first.id, source.id);
    assert.ok(next.players[0].energyZone.some((entry) => entry.id === source.id));
    assert.equal(next.players[0].energizedCardCountThisTurn, 1);
    assert.equal(next.batch.length, 1);
    assert.equal(next.phase, "energize");
    next = resolveUntilChoiceOrEmpty(next);
    const confirmation = next.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
    assert.ok(confirmation, id);
    assert.equal(confirmation.label, "Pay 2 Energy?");
    next = submitCardChoice(next, first.id, { confirmed: true });
    assert.ok(activePendingDraw(next), id + " did not queue the Draw");
    next = drawPendingCard(next, first.id);
    assert.equal(next.phase, "selection", "the Energize Step must end once the pending paid Draw resolves");
    assert.ok(next.players[0].hand.some((entry) => entry.id === "drawn-card"));
    assert.equal(next.players[0].discard.some((entry) => entry.id === source.id), false);
    assert.ok(activeUnchargedEnergyIds(next.players[0], next.turn).length >= 2);
  });
}
test("hand-Energize optional Draw may be declined with no payment", () => {
  const { state, first, second } = fixture("BATCH3-DECLINE");
  state.phase = "energize"; second.energizedThisTurn = true;
  first.hand = [card("sv-2", "self-source")];
  let next = resolveUntilChoiceOrEmpty(energizeCard(state, first.id, "self-source"));
  assert.ok(next.pendingChoice);
  next = submitCardChoice(next, first.id, { confirmed: false });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.phase, "selection");
  assert.equal(next.players[0].hand.some((entry) => entry.id === "drawn-card"), false);
  assert.equal(activeUnchargedEnergyIds(next.players[0], next.turn).length, 0);
});
test("deck-origin Energize cannot trigger a hand-only self-Energize effect", () => {
  const { state, first } = fixture("BATCH3-ZONE");
  const source = card("sv-2", "energized-from-deck");
  first.energyZone.push(source);
  const objects = emitGameEvent(state, {
    id: "zone-deck-event", type: "energize", playerId: first.id,
    sourceCards: [source], energizeSourceZone: "deck", amount: 1,
  });
  assert.equal(objects.length, 0);
});
test("unaffordable trigger disables paying and still permits declining", () => {
  const { state, first, second } = fixture("BATCH3-UNAFFORDABLE");
  state.phase = "energize"; second.energizedThisTurn = true;
  first.energyZone = [];
  first.hand = [card("sv-15", "self-source")];
  let next = resolveUntilChoiceOrEmpty(energizeCard(state, first.id, "self-source"));
  const confirmation = next.pendingChoice?.schema.fields.find((field) => field.id === "confirmed");
  assert.ok(confirmation);
  assert.equal(confirmation.options.find((option) => option.id === "yes")?.disabled, true);
  assert.throws(() => submitCardChoice(next, first.id, { confirmed: true }), /illegal selection/);
  next = submitCardChoice(next, first.id, { confirmed: false });
  assert.equal(next.players[0].deckCards.length, 2);
});
test("Lily allows an extra charged hand Energize, then the Step ends", () => {
  const { state, first, second } = fixture("BATCH3-LILY");
  state.phase = "energize"; second.energizedThisTurn = true;
  first.heroes = [card("av-85", "lily")];
  first.hand = [card("bb-1", "first-move"), card("bb-2", "second-move"), card("bb-3", "third-move")];
  assert.equal(additionalTurnEnergizesForPlayer(state, first.id), 1);
  let next = energizeCard(state, first.id, "first-move");
  assert.equal(next.players[0].energizedThisTurn, false);
  assert.equal(next.phase, "energize");
  next = energizeCard(next, first.id, "second-move");
  assert.equal(next.players[0].energizeStepActionsThisTurn, 2);
  assert.equal(next.players[0].energizedThisTurn, true);
  assert.equal(next.phase, "selection");
  assert.equal(next.players[0].energyZone.length, 12);
  assert.throws(() => energizeCard(next, first.id, "third-move"), /already complete/);
});
test("Lily can decline the second Energize; multiple controlled copies stack", () => {
  const { state, first, second } = fixture("BATCH3-LILY-STACK");
  state.phase = "energize"; second.energizedThisTurn = true;
  first.heroes = [card("av-85", "lily-1"), card("av-85", "lily-2")];
  first.hand = ["first", "second", "third", "fourth"].map((id) => card("bb-1", id));
  assert.equal(additionalTurnEnergizesForPlayer(state, first.id), 2);
  assert.ok(!ruleDefinitionForCard(card("av-85")).play.choices.some((choice) => choice.id === "confirmed"));
  let next = energizeCard(state, first.id, "first");
  next = energizeCard(next, first.id, "second");
  assert.equal(next.phase, "energize");
  next = energizeCard(next, first.id);
  assert.equal(next.phase, "selection");
  assert.equal(next.players[0].energizeStepActionsThisTurn, 2);
  first.heroes = [];
  assert.equal(additionalTurnEnergizesForPlayer(state, first.id), 0);
});
test("Calloway triggers once after the second Energize this turn, for the controller", () => {
  const { state, first, second } = fixture("BATCH3-CALLOWAY");
  state.phase = "energize"; second.energizedThisTurn = true;
  first.heroes = [card("av-85", "lily"), card("sv-103", "calloway")];
  first.hand = [card("bb-1", "move-one"), card("bb-2", "move-two")];
  const ability = ruleDefinitionForCard(card("sv-103")).abilities.find((part) =>
    part.kind === "triggered" && part.trigger?.event === "ENERGY_CARD_ENERGIZED");
  assert.ok(ability);
  assert.equal(ability.trigger?.minimumEventAmount, 2);
  assert.equal(ability.trigger?.limit?.kind, "once-per-turn");
  let next = energizeCard(state, first.id, "move-one");
  assert.equal(next.batch.length, 0);
  next = energizeCard(next, first.id, "move-two");
  assert.equal(next.batch.length, 1);
  next = resolveUntilChoiceOrEmpty(next);
  assert.ok(next.pendingChoice?.schema.fields.some((field) => field.id === "targetBakuganId"));
  next = submitCardChoice(next, first.id, { targetBakuganId: first.bakugan[0].id });
  assert.equal(next.powerBoost[first.bakugan[0].id], 500);
  const more = emitGameEvent(next, {
    id: "third-energy", type: "energize", playerId: first.id, amount: 3,
    sourceCards: [card("bb-3", "third-card")], energizeSourceZone: "hand",
  });
  assert.equal(more.length, 0);
});
test("Calloway ignores opposing Energize events and stops working if removed", () => {
  const { state, first, second } = fixture("BATCH3-CALLOWAY-INACTIVE");
  first.heroes = [card("sv-103", "calloway")];
  assert.equal(emitGameEvent(state, {
    id: "opponent-2", type: "energize", playerId: second.id, amount: 2,
    sourceCards: [card("bb-1", "opponent-card")], energizeSourceZone: "hand",
  }).length, 0);
  first.heroes = [];
  assert.equal(emitGameEvent(state, {
    id: "owner-2", type: "energize", playerId: first.id, amount: 2,
    sourceCards: [card("bb-1", "owner-card")], energizeSourceZone: "hand",
  }).length, 0);
});
test("Wynton routes a resolved Action into uncharged Energy, not discard", () => {
  const { state, first } = fixture("BATCH3-WYNTON");
  first.heroes = [card("ps1-21", "wynton")];
  const action = card("aa-39", "played-action");
  first.hand = [action];
  assert.equal(actionCardsEnergizeUnchargedForPlayer(state, first.id), true);
  const next = resolveUntilChoiceOrEmpty(playCard(state, first.id, action.id));
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].energyZone.some((entry) => entry.id === action.id));
  assert.ok(activeUnchargedEnergyIds(next.players[0], next.turn).includes(action.id));
  assert.ok(!next.players[0].discard.some((entry) => entry.id === action.id));
  assert.equal(next.players[0].energizedCardCountThisTurn, 1);
});
test("Wynton is controller-local; opposing Wynton does not affect your Actions", () => {
  const { state, first, second } = fixture("BATCH3-WYNTON-OPPONENT");
  second.heroes = [card("ps1-21", "opponent-wynton")];
  first.hand = [card("aa-39", "normal-action")];
  const next = resolveUntilChoiceOrEmpty(playCard(state, first.id, "normal-action"));
  assert.equal(actionCardsEnergizeUnchargedForPlayer(state, first.id), false);
  assert.ok(next.players[0].discard.some((entry) => entry.id === "normal-action"));
  assert.equal(next.players[0].energyZone.some((entry) => entry.id === "normal-action"), false);
});
test("Wynton does not duplicate self-moving Actions that already entered Energy", () => {
  const { state, first } = fixture("BATCH3-WYNTON-SELF");
  first.heroes = [card("ps1-21", "wynton")];
  first.hand = [card("bb-134", "self-energizing-action")];
  const next = resolveUntilChoiceOrEmpty(playCard(state, first.id, "self-energizing-action"));
  assert.equal(next.players[0].energyZone.filter((entry) => entry.id === "self-energizing-action").length, 1);
});
test("Ventus Fort text says 'of your deck' and still compiles two uncharged deck Energizes", () => {
  const source = card("av-38");
  assert.match(source.effect, /top two cards of\s+your deck uncharged/);
  const actions = ruleDefinitionForCard(source).abilities
    .flatMap((ability) => ability.instructions.flatMap((instruction) => instruction.actions));
  assert.ok(actions.some((action) => action.kind === "energize" && action.source === "deck"
    && action.amount === 2 && action.enters === "uncharged"));
});
