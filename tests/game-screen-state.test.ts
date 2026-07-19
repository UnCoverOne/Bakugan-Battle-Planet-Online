import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { HEX_CELLS, createMatch } from "../lib/game";
import {
  energyCardCanTap,
  energyZoneViews,
  tapEnergyCard,
} from "../lib/energy";
import {
  buildGameScreenZoneState,
  deckBackAssetCount,
  heldCoreFanLayout,
  heldCorePlacements,
  heroCardLayout,
  hideMatrixPlacements,
} from "../components/game-screen-v2/gameScreenState";
import {
  boundedHandFanGeometry,
  handCardLayout,
  handFanRenderedWidth,
  handFanSpanDegrees,
  handViewportEdgeOffset,
  opponentHandCardCount,
  playerHandCards,
} from "../components/game-screen-v2/cardHandState";
import {
  cardPreviewKind,
  cardPreviewZoneAllowed,
} from "../components/game-screen-v2/cardPreviewState";
import { drawTransitions } from "../components/game-screen-v2/drawAnimationState";

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

test("held BakuCore zones compress the Core fan as they fill", () => {
  const oneCore = heldCoreFanLayout(1);
  const sixCores = heldCoreFanLayout(6);
  const twelveCores = heldCoreFanLayout(12);

  assert.equal(oneCore.stepPercent, 0);
  assert.equal(oneCore.rotationStepDegrees, 0);
  assert.ok(sixCores.widthPercent < oneCore.widthPercent);
  assert.ok(twelveCores.widthPercent < sixCores.widthPercent);
  assert.ok(twelveCores.stepPercent < sixCores.stepPercent);
});

test("the player hand uses an exact symmetric radial fan at any card count", () => {
  const approximatelyEqual = (left: number, right: number) => {
    assert.ok(Math.abs(left - right) < 1e-9, `${left} should equal ${right}`);
  };

  assert.deepEqual(handCardLayout(1), [
    { rotationDegrees: 0, zIndex: 1 },
  ]);
  for (const count of [2, 5, 6, 12, 40]) {
    const layout = handCardLayout(count);
    assert.equal(layout.length, count);
    approximatelyEqual(
      layout[0].rotationDegrees,
      -layout.at(-1)!.rotationDegrees,
    );
    const expectedStep = handFanSpanDegrees(count) / (count - 1);
    for (let index = 1; index < layout.length; index += 1) {
      approximatelyEqual(
        layout[index].rotationDegrees - layout[index - 1].rotationDegrees,
        expectedStep,
      );
      assert.ok(
        layout[index].zIndex > layout[index - 1].zIndex,
        "each card to the right should overlap the card to its left",
      );
    }
  }
  assert.equal(handCardLayout(5)[2].rotationDegrees, 0);
  assert.equal(handFanSpanDegrees(12), 42);
  assert.equal(handFanSpanDegrees(40), 42);
});

test("the radial hand keeps every card the same size and compresses only spacing", () => {
  const desiredCardWidth = 116;
  for (const safeWidth of [320, 480, 680, 920]) {
    for (const cardCount of [1, 5, 12, 40]) {
      const geometry = boundedHandFanGeometry({
        cardCount,
        safeWidth,
        desiredCardWidth,
        radiusRatio: 8.35,
      });
      assert.equal(geometry.cardWidth, desiredCardWidth);
      assert.equal(geometry.fanRadius, desiredCardWidth * 8.35);
      assert.ok(geometry.spanDegrees <= handFanSpanDegrees(cardCount));
      assert.ok(
        geometry.renderedWidth <= safeWidth + 1e-7,
        `${cardCount} fixed-size cards should fit inside ${safeWidth}px by overlapping more`,
      );
      assert.ok(
        Math.abs(
          geometry.renderedWidth
          - handFanRenderedWidth(
            geometry.cardWidth,
            geometry.fanRadius,
            geometry.spanDegrees,
          )
        ) < 1e-7,
      );
    }
  }
  const tight = boundedHandFanGeometry({
    cardCount: 40,
    safeWidth: 320,
    desiredCardWidth,
    radiusRatio: 8.35,
  });
  const roomy = boundedHandFanGeometry({
    cardCount: 40,
    safeWidth: 920,
    desiredCardWidth,
    radiusRatio: 8.35,
  });
  assert.equal(tight.cardWidth, roomy.cardWidth);
  assert.ok(tight.spanDegrees < roomy.spanDegrees);
  assert.equal(roomy.spanDegrees, handFanSpanDegrees(40));
});

test("tall viewports move the hand with the playmat instead of below it", () => {
  assert.equal(handViewportEdgeOffset(1000, 48, 952, "player"), 0);
  assert.equal(handViewportEdgeOffset(1000, 48, 952, "opponent"), 0);
  assert.equal(handViewportEdgeOffset(1600, 250, 1350, "player"), 202);
  assert.equal(handViewportEdgeOffset(1600, 250, 1350, "opponent"), 202);
});

test("card previews recognise card artwork without calculating a viewport side", () => {
  assert.equal(cardPreviewKind("/assets/cards/full/001.webp"), "face");
  assert.equal(
    cardPreviewKind("https://example.test/assets/cards/full/002.webp?revision=3"),
    "face",
  );
  assert.equal(cardPreviewKind("/assets/card-back.png"), "back");
  assert.equal(cardPreviewKind("/assets/core-backs/fist.png"), null);

  assert.equal(cardPreviewZoneAllowed("character-card"), true);
  assert.equal(cardPreviewZoneAllowed("hero"), true);
  assert.equal(cardPreviewZoneAllowed("hand"), true);
  assert.equal(cardPreviewZoneAllowed("discard-pile"), true);
  assert.equal(cardPreviewZoneAllowed("discard-browser"), true);
  assert.equal(cardPreviewZoneAllowed("deck"), false);
  assert.equal(cardPreviewZoneAllowed("energy"), false);
});

test("draw transitions require a matching deck loss and hand gain", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const before = createMatch("DRAWFX", "bo1", [player, opponent]);
  const after = structuredClone(before);
  const drawn = after.players[0].deckCards.shift();
  assert.ok(drawn);
  after.players[0].deck = after.players[0].deckCards.length;
  after.players[0].hand.push(drawn);
  after.version += 1;

  const transitions = drawTransitions(before, after);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].playerId, player.id);
  assert.equal(transitions[0].count, 1);
  assert.equal(transitions[0].cards[0].id, drawn.id);

  const handOnly = structuredClone(before);
  handOnly.players[0].hand.push({ ...handOnly.players[0].hand[0], id: "effect-card" });
  handOnly.version += 1;
  assert.deepEqual(drawTransitions(before, handOnly), []);
});

test("tapping a face-down Energy card generates exactly one available Energy", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const energyCard = player.hand.shift();
  assert.ok(energyCard);
  player.energyZone.push(energyCard);
  player.maxEnergy = 1;
  player.energy = 1;

  const match = createMatch("ENERGY", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";

  const before = energyZoneViews(match, player.id).player;
  assert.equal(before.cards.length, 1);
  assert.equal(before.availableEnergy, 0);
  assert.equal(energyCardCanTap(match, player.id, energyCard.id), true);

  const tapped = tapEnergyCard(match, player.id, energyCard.id);
  const after = energyZoneViews(tapped, player.id).player;
  assert.equal(after.availableEnergy, 1);
  assert.deepEqual(after.tappedEnergyIds, [energyCard.id]);
  assert.equal(energyCardCanTap(tapped, player.id, energyCard.id), false);
  assert.match(tapped.log.at(-1)?.message ?? "", /generated 1 Energy/);
  assert.throws(
    () => tapEnergyCard(tapped, player.id, energyCard.id),
    /already tapped/,
  );

  const startStep = structuredClone(match);
  startStep.phase = "energize";
  assert.equal(energyCardCanTap(startStep, player.id, energyCard.id), false);
  assert.throws(
    () => tapEnergyCard(startStep, player.id, energyCard.id),
    /cannot be tapped during this phase/,
  );
});

test("the opponent hand exposes its card count without exposing card faces", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  opponent.hand = opponent.hand.slice(0, 2);
  const match = createMatch("HIDDEN", "bo1", [player, opponent]);

  assert.equal(opponentHandCardCount(match, player.id), 2);
  assert.equal(opponentHandCardCount(match, opponent.id), player.hand.length);
  assert.equal(opponentHandCardCount(null, player.id), 0);
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
  assert.deepEqual(zones.player.discardCards.map((card) => card.id), [discarded.id]);
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
  assert.equal(opponentHandCardCount(match, player.id), opponent.hand.length);
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
