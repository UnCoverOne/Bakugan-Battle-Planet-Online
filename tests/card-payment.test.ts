import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  prepareCardPlay,
  submitCardChoice,
  type PlayerState,
} from "../lib/game";
import {
  cardEnergyPaymentState,
  playCardWithAutoEnergy,
} from "../lib/cardPayment";

type EnergyTrackedPlayer = PlayerState & {
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

function paymentMatch(cost: number, energyCards: number, generated: number) {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]) as EnergyTrackedPlayer;
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const template = CARDS.find((card) => card.type === "Action" && card.cost !== "X");
  assert.ok(template);
  const card = { ...template, id: `payment-card-${cost}`, cost };
  player.hand = [card];
  player.energyZone = Array.from({ length: energyCards }, (_, index) => ({
    ...template,
    id: `energy-card-${index}`,
  }));
  player.energy = generated;
  player.energyTapTurn = 1;
  player.tappedEnergyIds = player.energyZone.slice(0, generated).map((energyCard) => energyCard.id);

  const match = createMatch("PAY001", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;
  match.startingPlayer = player.id;
  return { match, player, card };
}

test("McQ, Fusion Brawler can choose its free first-turn payment with no Energy", () => {
  const player = makePlayer("mcq-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("mcq-opponent", "Opponent", STARTER_DECKS[1]);
  const source = CARDS.find((card) => card.catalogId === "sv-100");
  assert.ok(source);
  const mcq = { ...source, id: "mcq-free-first-turn" };
  player.hand = [mcq];
  player.energy = 0;
  player.energyZone = [];

  const match = createMatch("PAYMCQ", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;
  match.startingPlayer = player.id;

  const prepared = prepareCardPlay(match, player.id, mcq.id);
  const paymentMode = prepared.pendingChoice?.schema.fields.find((field) => field.id === "paymentMode");
  assert.ok(paymentMode);
  assert.equal(paymentMode.options.find((option) => option.id === "normal")?.disabled, true);
  assert.equal(paymentMode.options.find((option) => option.id === "sv-100:self-free")?.disabled, false);

  const played = submitCardChoice(prepared, player.id, { paymentMode: "sv-100:self-free" });
  assert.equal(played.pendingChoice, undefined);
  assert.equal(played.players[0].hand.some((card) => card.id === mcq.id), false);
  assert.equal(played.players[0].energy, 0);
  assert.equal(played.batch.at(-1)?.card.id, mcq.id);
  assert.equal(played.batch.at(-1)?.card.playedForFreeTurn, 1);
});

test("a card uses already generated Energy without tapping extra cards", () => {
  const { match, player, card } = paymentMatch(2, 4, 3);
  const payment = cardEnergyPaymentState(match, player.id, card);
  assert.equal(payment?.kind, "ready");
  assert.equal(payment?.autoTapCardIds.length, 0);

  const played = playCardWithAutoEnergy(match, player.id, card.id, { confirmed: true });
  const updated = played.players[0] as EnergyTrackedPlayer;
  assert.equal(updated.energy, 1);
  assert.equal(updated.tappedEnergyIds?.length, 3);
  assert.equal(updated.hand.length, 0);
  assert.equal(played.batch.at(-1)?.card.id, card.id);
});

test("a card automatically taps only the Energy cards needed for its shortfall", () => {
  const { match, player, card } = paymentMatch(3, 4, 1);
  const payment = cardEnergyPaymentState(match, player.id, card);
  assert.equal(payment?.kind, "auto-tap");
  assert.equal(payment?.shortfall, 2);
  assert.deepEqual(payment?.autoTapCardIds, ["energy-card-1", "energy-card-2"]);

  const played = playCardWithAutoEnergy(match, player.id, card.id, { confirmed: true });
  const updated = played.players[0] as EnergyTrackedPlayer;
  assert.equal(updated.energy, 0);
  assert.deepEqual(updated.tappedEnergyIds, [
    "energy-card-0",
    "energy-card-1",
    "energy-card-2",
  ]);
  assert.equal(updated.hand.length, 0);
});

test("a card cannot be played when generated and untapped Energy are insufficient", () => {
  const { match, player, card } = paymentMatch(5, 3, 1);
  const payment = cardEnergyPaymentState(match, player.id, card);
  assert.equal(payment?.kind, "insufficient");
  assert.equal(payment?.totalEnergy, 3);
  assert.throws(
    () => playCardWithAutoEnergy(match, player.id, card.id),
    /Not enough Energy.*5 required.*3 available/i,
  );
  assert.equal(match.players[0].hand[0].id, card.id);
  assert.equal(match.batch.length, 0);
});
