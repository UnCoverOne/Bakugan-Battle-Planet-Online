import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, type PlayerState } from "../lib/game";
import {
  flipDamageCard,
  playerCanFlipDamage,
  resolveManualDamage,
} from "../lib/manualDamage";

type EnergyTrackedPlayer = PlayerState & {
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
};

function damageCards() {
  const ordinary = CARDS.find((card) => card.type === "Action");
  const flip = CARDS.find((card) => card.type === "Flip");
  assert.ok(ordinary);
  assert.ok(flip);
  return {
    ordinary: { ...ordinary, id: "ordinary-damage" },
    flip: { ...flip, id: "revealed-damage-flip" },
  };
}

test("damage cards move from the deck to discard one click at a time", () => {
  const loser = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const winner = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary, flip } = damageCards();
  loser.deckCards = [ordinary, flip];
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  const match = createMatch("DMG001", "bo1", [loser, winner]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = loser.id;
  match.pendingDamage = 2;
  match.priority = loser.id;

  assert.equal(playerCanFlipDamage(match, loser.id), true);
  const first = flipDamageCard(match, loser.id);
  assert.equal(first.pendingDamage, 1);
  assert.equal(first.players[0].deckCards.length, 1);
  assert.deepEqual(first.players[0].discard.map((card) => card.id), [ordinary.id]);
  assert.equal(first.revealedFlip, undefined);

  const second = flipDamageCard(first, loser.id);
  assert.equal(second.pendingDamage, 0);
  assert.equal(second.phase, "damage");
  assert.equal(second.revealedFlip?.id, flip.id);
  assert.deepEqual(second.players[0].discard.map((card) => card.id), [ordinary.id, flip.id]);
  assert.equal(playerCanFlipDamage(second, loser.id), false);

  const skipped = resolveManualDamage(second, loser.id);
  assert.equal(skipped.phase, "postDamage");
  assert.equal(skipped.revealedFlip, undefined);
});

test("playing a revealed Flip automatically taps its Energy shortfall", () => {
  const loser = makePlayer("player-a", "Dan", STARTER_DECKS[0]) as EnergyTrackedPlayer;
  const winner = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary, flip } = damageCards();
  const payableFlip = { ...flip, cost: 2 as const };
  loser.deckCards = [payableFlip, ordinary];
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  loser.energyZone = [
    { ...ordinary, id: "damage-energy-1" },
    { ...ordinary, id: "damage-energy-2" },
  ];
  loser.maxEnergy = 2;
  loser.energy = 0;
  loser.energyTapTurn = 1;
  loser.tappedEnergyIds = [];
  const match = createMatch("DMG002", "bo1", [loser, winner]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = loser.id;
  match.pendingDamage = 2;
  match.priority = loser.id;

  const revealed = flipDamageCard(match, loser.id);
  assert.equal(revealed.pendingDamage, 1);
  assert.equal(revealed.revealedFlip?.id, payableFlip.id);

  const played = resolveManualDamage(revealed, loser.id, payableFlip.id);
  const updated = played.players[0] as EnergyTrackedPlayer;
  assert.equal(updated.energy, 0);
  assert.deepEqual(updated.tappedEnergyIds, ["damage-energy-1", "damage-energy-2"]);
  assert.equal(played.revealedFlip, undefined);
  assert.ok(played.phase === "damage" || played.phase === "postDamage");
});

test("the Victor window enters manual damage without consuming the loser deck", () => {
  const winner = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const loser = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const { ordinary } = damageCards();
  loser.deckCards = Array.from({ length: 10 }, (_, index) => ({
    ...ordinary,
    id: `manual-deck-${index}`,
  }));
  loser.deck = loser.deckCards.length;
  loser.discard = [];
  const match = createMatch("DMG003", "bo1", [winner, loser]);
  match.turn = 1;
  match.phase = "victor";
  match.stepLabel = "Brawl Phase • Victor Step";
  match.startingPlayer = winner.id;
  match.priority = winner.id;
  match.brawlWinner = winner.id;
  match.selected[winner.id] = winner.bakugan[0].id;
  match.selected[loser.id] = loser.bakugan[0].id;
  winner.bakugan[0].open = true;
  loser.bakugan[0].open = true;
  const deckBefore = loser.deckCards.map((card) => card.id);

  const firstPass = passPriority(match, winner.id);
  assert.equal(firstPass.phase, "victor");
  const damage = passPriority(firstPass, loser.id);
  assert.equal(damage.phase, "damage");
  assert.ok(damage.pendingDamage > 0);
  assert.equal(damage.revealedFlip, undefined);
  assert.deepEqual(damage.players[1].deckCards.map((card) => card.id), deckBefore);
  assert.deepEqual(damage.players[1].discard, []);
});
