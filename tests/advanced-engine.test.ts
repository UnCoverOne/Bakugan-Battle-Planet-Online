import test from "node:test";
import assert from "node:assert/strict";
import { BAKUGAN, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  beginCorePlacement, createMatch, legalPlacementCells, normalizeMatchState, passPriority, placeCore, playCard,
  setReady, type GameCard, type MatchState,
} from "../lib/game";
import {
  buildChoiceSchema, schemaHasLegalCompletion, validateChoices,
} from "../lib/rules/choices";
import { cardProgramIsExecutable, compileCardEffect } from "../lib/rules/effects";
import { canUndoLatest, revealHiddenInformation, undoLatestAction } from "../lib/undo";

function players() {
  return [makePlayer("a", "Alpha", STARTER_DECKS[0]), makePlayer("b", "Beta", STARTER_DECKS[1])];
}

function cardWith(effect: string, values: Partial<GameCard> = {}) {
  const template = CARDS.find((card) => card.type === "Action")!;
  return { ...template, id: `test-${effect}`, catalogId: `test-${effect}`, effect, ...values };
}

test("server selection gates placement, alternates seats, and audits the final first-turn assignment", () => {
  let match = createMatch("RNG123", "bo1", players());
  match = setReady(setReady(match, "a"), "b");
  assert.equal(match.phase, "startingPlayer");
  assert.ok(match.players.some((player) => player.id === match.initialStartingPlayer));
  assert.ok(match.log.some((entry) => entry.kind === "random" && entry.message.includes("starting-player")));
  assert.throws(() => beginCorePlacement(match, match.startingPlayerRevealedAt - 1), /animation/i);

  match = beginCorePlacement(match, Number.POSITIVE_INFINITY);
  const order: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const actor = match.players.find((player) => player.id === match.priority)!;
    order.push(actor.id);
    const used = match.placements.filter((placement) => placement.playerId === actor.id).length;
    match = placeCore(match, actor.id, actor.cores[used].id, legalPlacementCells(match)[0]);
  }
  assert.ok(order.every((playerId, index) => index === 0 || playerId !== order[index - 1]));
  assert.equal(match.startingPlayer, order.at(-1));
  assert.equal(match.phase, "draw");
  assert.ok(match.log.some((entry) => entry.message.includes("placed the final BakuCore")));
});

test("formal choices cover optional no-target, ranges, X, opponent and private simultaneous decisions", () => {
  const match = createMatch("CHO123", "bo1", players());
  const optional = buildChoiceSchema(match, "a", cardWith("You may destroy a Hero."));
  assert.equal(schemaHasLegalCompletion(optional), true);
  assert.doesNotThrow(() => validateChoices(optional, "a", { confirmed: false }));
  assert.throws(() => validateChoices(optional, "a", { confirmed: true }), /Choose a Hero/i);

  const range = buildChoiceSchema(match, "a", cardWith("Discard up to three cards from your hand."));
  const hand = range.fields.find((field) => field.id === "discardCardIds")!;
  assert.deepEqual([hand.minimum, hand.maximum], [0, 3]);

  const xMode = buildChoiceSchema(match, "a", cardWith("Choose B-Power or damage.", { cost: "X" }));
  assert.ok(xMode.fields.some((field) => field.id === "xValue"));
  assert.ok(xMode.fields.some((field) => field.id === "mode"));

  const opponent = buildChoiceSchema(match, "a", cardWith("Your opponent chooses a player."));
  assert.ok(opponent.fields.every((field) => field.chooserId === "b"));

  const simultaneous = buildChoiceSchema(match, "a", cardWith("Each player secretly chooses a card from your hand."));
  assert.equal(simultaneous.simultaneous, true);
  assert.deepEqual(new Set(simultaneous.fields.map((field) => field.chooserId)), new Set(["a", "b"]));
  assert.ok(simultaneous.fields.every((field) => field.visibility === "private"));
});

function undoMatch() {
  const match = createMatch("UND123", "bo1", players());
  match.turn = 1;
  match.phase = "power";
  match.startingPlayer = "a";
  match.priority = "a";
  const player = match.players[0] as MatchState["players"][number] & { energyTapTurn?: number; tappedEnergyIds?: string[] };
  const card = CARDS.find((candidate) => candidate.type === "Action" && candidate.cost !== "X" && candidate.cost <= 3 && !/may|choose|sacrifice|discard|\bX\b/i.test(candidate.effect))!;
  player.hand = [{ ...card, id: "undo-card" }];
  player.energyZone = Array.from({ length: 3 }, (_, index) => ({ ...card, id: `undo-energy-${index}` }));
  player.energy = 3;
  player.energyTapTurn = 1;
  player.tappedEnergyIds = player.energyZone.map((energy) => energy.id);
  return match;
}

test("undo restores only the latest unpassed card play and closes on priority or hidden information", () => {
  const before = undoMatch();
  const played = playCard(before, "a", "undo-card");
  assert.equal(canUndoLatest(played, "a"), true);
  const restored = undoLatestAction(played, "a");
  assert.equal(restored.batch.length, 0);
  assert.equal(restored.players[0].hand[0].id, "undo-card");
  assert.equal(restored.undoWindow, undefined);

  const passed = passPriority(played, "a");
  assert.equal(canUndoLatest(passed, "a"), false);
  assert.throws(() => undoLatestAction(passed, "a"), /before priority passes/i);

  const revealed = revealHiddenInformation(structuredClone(played));
  assert.equal(canUndoLatest(revealed, "a"), false);
});

test("all catalogue cards compile to executable modular programs and non-Ultra rolls use the shared profile", () => {
  assert.ok(CARDS.every((card) => cardProgramIsExecutable(compileCardEffect(card))));
  const standard = BAKUGAN.filter((bakugan) => !/\bUltra\b/i.test(bakugan.name));
  assert.ok(standard.length > 0);
  assert.ok(standard.every((bakugan) => bakugan.rollAccuracy === 90 && bakugan.doubleCoreChance === 5));
});

test("legacy resumable matches are upgraded before current client and engine code reads them", () => {
  const legacy = createMatch("OLD123", "bo1", players());
  delete (legacy as Partial<MatchState>).triggerOrders;
  delete (legacy as Partial<MatchState>).informationEpoch;
  delete (legacy as Partial<MatchState>).priorityEpoch;
  delete (legacy as Partial<MatchState>).initialStartingPlayer;
  delete (legacy as Partial<MatchState>).startingPlayerRevealedAt;

  const restored = normalizeMatchState(legacy);
  assert.deepEqual(restored.triggerOrders, []);
  assert.equal(restored.informationEpoch, 0);
  assert.equal(restored.priorityEpoch, 0);
  assert.equal(restored.initialStartingPlayer, restored.startingPlayer);
  assert.equal(restored.startingPlayerRevealedAt, 0);
});
