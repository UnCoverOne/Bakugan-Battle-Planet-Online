import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  compactMatchHudSlots,
  defaultCardChoices,
  handCardIsActionable,
  matchRoundTarget,
  playableHandCards,
  resolveHudPlayers,
  visibleMatchHudActions,
} from "../components/game-screen-v2/matchHudState";

test("player HUD details resolve from the local player perspective", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("HUD123", "bo3", [player, opponent]);

  assert.equal(resolveHudPlayers(match, player.id).player?.id, player.id);
  assert.equal(resolveHudPlayers(match, player.id).opponent?.id, opponent.id);
  assert.equal(resolveHudPlayers(match, opponent.id).player?.id, opponent.id);
  assert.equal(matchRoundTarget(match), 2);
  assert.equal(matchRoundTarget({ format: "bo1" }), 1);
});

test("action HUD exposes only actions legal in the current game window", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const actionCard = CARDS.find((card) => card.type === "Action" && card.cost !== "X" && card.cost <= 3);
  assert.ok(actionCard);
  player.hand = [{ ...actionCard, id: "playable-action" }];
  player.energy = 3;
  const match = createMatch("HUD456", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;

  assert.deepEqual(playableHandCards(match, player.id).map((card) => card.id), ["playable-action"]);
  assert.deepEqual(
    visibleMatchHudActions({
      match,
      playerId: player.id,
      mode: null,
      selectedCardId: "",
      selectionPending: false,
    }),
    {
      "play-card": true,
      "energize-card": false,
      "pass-turn": true,
      select: false,
    },
  );

  match.priority = opponent.id;
  assert.deepEqual(
    visibleMatchHudActions({
      match,
      playerId: player.id,
      mode: null,
      selectedCardId: "",
      selectionPending: false,
    }),
    {
      "play-card": false,
      "energize-card": false,
      "pass-turn": false,
      select: false,
    },
  );
});

test("the compact Action HUD reuses two stable button slots", () => {
  assert.deepEqual(compactMatchHudSlots({
    "play-card": true,
    "energize-card": false,
    "pass-turn": true,
    select: false,
  }), ["play-card", "pass-turn"]);

  assert.deepEqual(compactMatchHudSlots({
    "play-card": true,
    "energize-card": false,
    "pass-turn": true,
    select: true,
  }), ["select", "pass-turn"]);

  assert.deepEqual(compactMatchHudSlots({
    "play-card": false,
    "energize-card": true,
    "pass-turn": false,
    select: false,
  }), ["energize-card", null]);

  assert.deepEqual(compactMatchHudSlots({
    "play-card": false,
    "energize-card": false,
    "pass-turn": true,
    select: false,
  }), ["pass-turn", null]);
});

test("Energize and card-selection states make only eligible hand cards actionable", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("HUD789", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "energize";
  const card = player.hand[0];
  assert.ok(card);

  assert.equal(handCardIsActionable(match, player.id, card, "energize"), true);
  const energizeActions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: "energize",
    selectedCardId: card.id,
    selectionPending: false,
  });
  assert.equal(energizeActions["energize-card"], true);
  assert.equal(energizeActions["play-card"], false);

  player.energizedThisTurn = true;
  assert.equal(handCardIsActionable(match, player.id, card, "energize"), false);
});

test("cards that require choices expose Select and receive deterministic defaults", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const targetedCard = CARDS.find((card) => card.type === "Evo");
  assert.ok(targetedCard);
  player.hand = [{ ...targetedCard, id: "targeted-action" }];
  player.energy = 20;
  const match = createMatch("HUDSEL", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;
  match.selected[player.id] = player.bakugan[0].id;
  match.selected[opponent.id] = opponent.bakugan[0].id;

  const actions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: "play",
    selectedCardId: "targeted-action",
    selectionPending: true,
  });
  assert.equal(actions.select, true);

  const choices = defaultCardChoices(match, player.id, player.hand[0]);
  assert.equal(choices.targetBakuganId, player.bakugan[0].id);
});
