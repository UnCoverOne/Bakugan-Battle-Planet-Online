import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { HEX_CELLS, createMatch } from "../lib/game";
import {
  buildGameScreenZoneState,
  deckBackAssetCount,
  heldCorePlacements,
  heroCardLayout,
  hideMatrixPlacements,
} from "../components/game-screen-v2/gameScreenState";
import {
  handCardLayout,
  playerHandCards,
} from "../components/game-screen-v2/cardHandState";

test("deck card backs scale from zero to ten assets", () => {
  assert.equal(deckBackAssetCount(0), 0);
  assert.equal(deckBackAssetCount(1), 1);
  assert.equal(deckBackAssetCount(4), 1);
  assert.equal(deckBackAssetCount(5), 2);
  assert.equal(deckBackAssetCount(36), 9);
  assert.equal(deckBackAssetCount(40), 10);
  assert.equal(deckBackAssetCount(41), 10);
});

test("Hero cards compress their spacing as the stack grows", () => {
  const twoCards = heroCardLayout(2);
  const sixCards = heroCardLayout(6);
  const twelveCards = heroCardLayout(12);

  assert.ok(twoCards.stepPercent > sixCards.stepPercent);
  assert.ok(sixCards.stepPercent > twelveCards.stepPercent);
  assert.ok(twoCards.startPercent >= 2.375);
  assert.ok(twelveCards.startPercent >= 2.375);
});

test("the player hand forms a centred, slightly fanned row", () => {
  const singleCard = handCardLayout(1);
  const fiveCards = handCardLayout(5);
  const twelveCards = handCardLayout(12);

  assert.deepEqual(singleCard, [
    { leftPercent: 50, rotationDegrees: 0, dropPixels: 0, zIndex: 1 },
  ]);
  assert.equal(fiveCards.length, 5);
  assert.ok(fiveCards[0].leftPercent < 50);
  assert.equal(fiveCards[2].leftPercent, 50);
  assert.ok(fiveCards.at(-1)!.leftPercent > 50);
  assert.ok(fiveCards[0].rotationDegrees < 0);
  assert.ok(fiveCards.at(-1)!.rotationDegrees > 0);
  assert.equal(twelveCards[0].leftPercent, 18);
  assert.equal(twelveCards.at(-1)!.leftPercent, 82);
});

test("live match state populates both players' card zones", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const hero = CARDS.find((card) => card.type === "Hero");
  const discarded = player.hand[0];

  assert.ok(hero);
  player.heroes.push({ ...hero, id: "hero-in-play" });
  player.discard.push(discarded);
  player.hand = player.hand.slice(1);

  const match = createMatch("LAB123", "bo1", [player, opponent]);
  const zones = buildGameScreenZoneState(match, player.id);

  assert.deepEqual(
    zones.player.characterCards.map((card) => card.catalogId),
    player.bakugan.map((bakugan) => bakugan.character.catalogId),
  );
  assert.equal(zones.player.heroCards.length, 1);
  assert.equal(zones.player.latestDiscard?.id, discarded.id);
  assert.equal(zones.player.discardCount, 1);
  assert.equal(zones.player.deckCount, player.deckCards.length);
  assert.deepEqual(
    zones.opponent.characterCards.map((card) => card.catalogId),
    opponent.bakugan.map((bakugan) => bakugan.character.catalogId),
  );
  assert.deepEqual(
    playerHandCards(match, player.id).map((card) => card.id),
    player.hand.map((card) => card.id),
  );
});

test("picked-up BakuCores leave the Hide Matrix and attach to their Bakugan", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CORE12", "bo1", [player, opponent]);
  const matrixCell = HEX_CELLS[0].id;
  const heldCell = HEX_CELLS[1].id;
  const bakuganId = player.bakugan[0].id;

  match.placements = [
    {
      playerId: player.id,
      core: player.cores[0],
      cell: matrixCell,
      order: 1,
    },
    {
      playerId: player.id,
      core: player.cores[1],
      cell: heldCell,
      order: 2,
      attachedTo: bakuganId,
    },
  ];

  assert.deepEqual(hideMatrixPlacements(match).map((placement) => placement.cell), [matrixCell]);
  assert.deepEqual(heldCorePlacements(match, bakuganId).map((placement) => placement.cell), [heldCell]);
  assert.equal(heldCorePlacements(match, player.bakugan[1].id).length, 0);
});
