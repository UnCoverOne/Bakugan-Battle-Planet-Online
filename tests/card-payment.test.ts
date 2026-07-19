import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type PlayerState } from "../lib/game";
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
  player.maxEnergy = energyCards;
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

test("a card uses already generated Energy without tapping extra cards", () => {
  const { match, player, card } = paymentMatch(2, 4, 3);
  const payment = cardEnergyPaymentState(match, player.id, card);
  assert.equal(payment?.kind, "ready");
  assert.equal(payment?.autoTapCardIds.length, 0);

  const played = playCardWithAutoEnergy(match, player.id, card.id);
  const updated = played.players[0] as EnergyTrackedPlayer;
  assert.equal(updated.energy, 1);
  assert.equal(updated.tappedEnergyIds?.length, 3);
  assert.equal(updated.hand.length, 0);
  assert.equal(updated.batch.at(-1)?.card.id, card.id);
});

test("a card automatically taps only the Energy cards needed for its shortfall", () => {
  const { match, player, card } = paymentMatch(3, 4, 1);
  const payment = cardEnergyPaymentState(match, player.id, card);
  assert.equal(payment?.kind, "auto-tap");
  assert.equal(payment?.shortfall, 2);
  assert.deepEqual(payment?.autoTapCardIds, ["energy-card-1", "energy-card-2"]);

  const played = playCardWithAutoEnergy(match, player.id, card.id);
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
