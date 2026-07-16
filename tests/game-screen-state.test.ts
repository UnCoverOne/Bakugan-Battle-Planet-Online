import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  buildGameScreenZoneState,
  deckBackAssetCount,
  heroCardLayout,
} from "../components/game-screen-v2/gameScreenState";

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
  assert.ok(twoCards.startPercent >= 4);
  assert.ok(twelveCards.startPercent >= 4);
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
});
