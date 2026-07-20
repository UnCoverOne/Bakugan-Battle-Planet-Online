import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { evoCanTarget } from "../lib/evo";
import { createMatch } from "../lib/game";
import {
  drawStepIsPending,
  drawTurnCard,
  playerCanDrawTurnCard,
  preparePendingDraw,
} from "../lib/turnStart";
import {
  compactMatchHudSlots,
  defaultCardChoices,
  handCardIsActionable,
  matchRoundTarget,
  playableHandCards,
  resolvedHandActionMode,
  resolveHudPlayers,
  shouldAutomaticallyPass,
  visibleMatchHudActions,
  type MatchHudActions,
} from "../components/game-screen-v2/matchHudState";

function actionState(overrides: Partial<MatchHudActions> = {}): MatchHudActions {
  return {
    "draw-card": false,
    "play-card": false,
    "energize-card": false,
    "skip-energize": false,
    "pass-turn": false,
    "play-flip": false,
    "skip-flip": false,
    select: false,
    ...overrides,
  };
}

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

test("priority immediately enables legal hand cards before Play Card is pressed", () => {
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

  assert.equal(resolvedHandActionMode(match, player.id, null), "play");
  assert.equal(handCardIsActionable(match, player.id, player.hand[0], "play"), true);
  assert.deepEqual(playableHandCards(match, player.id).map((card) => card.id), ["playable-action"]);
  assert.deepEqual(
    visibleMatchHudActions({
      match,
      playerId: player.id,
      mode: "play",
      selectedCardId: "",
      selectionPending: false,
    }),
    actionState({ "play-card": true, "pass-turn": true }),
  );
  assert.equal(shouldAutomaticallyPass(match, player.id), false);

  match.priority = opponent.id;
  assert.equal(resolvedHandActionMode(match, player.id, null), null);
  assert.deepEqual(
    visibleMatchHudActions({
      match,
      playerId: player.id,
      mode: null,
      selectedCardId: "",
      selectionPending: false,
    }),
    actionState(),
  );
});

test("otherwise legal cards remain selectable even before enough Energy is generated", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const expensive = CARDS.find((card) => card.type === "Action" && typeof card.cost === "number" && card.cost >= 4);
  assert.ok(expensive);
  player.hand = [{ ...expensive, id: "expensive-action" }];
  player.energy = 0;
  player.energyZone = [];
  const match = createMatch("HUDPAY", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;

  assert.deepEqual(playableHandCards(match, player.id).map((card) => card.id), ["expensive-action"]);
  assert.equal(handCardIsActionable(match, player.id, player.hand[0], "play"), true);
});

test("the compact Action HUD keeps Pass in its permanent second slot", () => {
  assert.deepEqual(compactMatchHudSlots(actionState({
    "play-card": true,
    "pass-turn": true,
  })), ["play-card", "pass-turn"]);

  assert.deepEqual(compactMatchHudSlots(actionState({
    "play-card": true,
    "pass-turn": true,
    select: true,
  })), ["select", "pass-turn"]);

  assert.deepEqual(compactMatchHudSlots(actionState({
    "draw-card": true,
  })), ["draw-card", null]);

  assert.deepEqual(compactMatchHudSlots(actionState({
    "energize-card": true,
    "skip-energize": true,
  })), ["energize-card", "skip-energize"]);

  assert.deepEqual(compactMatchHudSlots(actionState({
    "pass-turn": true,
  })), [null, "pass-turn"]);

  assert.deepEqual(compactMatchHudSlots(actionState()), [null, null]);
});

test("a revealed Flip replaces the Action HUD with Play and Skip", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const flip = CARDS.find((card) => card.type === "Flip");
  assert.ok(flip);
  const match = createMatch("HUDFLP", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "damage";
  match.pendingLoser = player.id;
  match.pendingDamage = 2;
  match.revealedFlip = { ...flip, id: "revealed-flip" };

  const actions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });
  assert.equal(actions["play-flip"], true);
  assert.equal(actions["skip-flip"], true);
  assert.deepEqual(compactMatchHudSlots(actions), ["play-flip", "skip-flip"]);
});

test("the prepared Draw Step waits three seconds in the first turn and requires each player to draw", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("HUDDRAW", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "energize";
  match.stepLabel = "Turn 1 • Energize Step";

  for (const participant of match.players) {
    const card = participant.deckCards.shift();
    assert.ok(card);
    participant.hand.push(card);
    participant.deck = participant.deckCards.length;
  }
  const versionBeforePreparation = match.version;
  const prepared = preparePendingDraw(match, 1_000);
  assert.equal(prepared.version, versionBeforePreparation + 1);
  assert.equal(drawStepIsPending(prepared), true);
  assert.equal(playerCanDrawTurnCard(prepared, player.id, 3_999), false);
  assert.equal(playerCanDrawTurnCard(prepared, player.id, 4_000), true);
  assert.throws(() => drawTurnCard(prepared, player.id, 3_999), /has not begun/i);

  const afterPlayer = drawTurnCard(prepared, player.id, 4_000);
  assert.equal(afterPlayer.phase, "retract");
  assert.equal(playerCanDrawTurnCard(afterPlayer, player.id, 4_000), false);
  const afterBoth = drawTurnCard(afterPlayer, opponent.id, 4_000);
  assert.equal(afterBoth.phase, "energize");
  assert.match(afterBoth.stepLabel, /Energize Step/);
});

test("Energize and card-selection states make only eligible hand cards actionable", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("HUD789", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "energize";
  const card = player.hand[0];
  assert.ok(card);

  assert.equal(resolvedHandActionMode(match, player.id, null), "energize");
  assert.equal(handCardIsActionable(match, player.id, card, "energize"), true);
  const energizeActions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: "energize",
    selectedCardId: card.id,
    selectionPending: false,
  });
  assert.equal(energizeActions["energize-card"], true);
  assert.equal(energizeActions["skip-energize"], true);
  assert.equal(energizeActions["play-card"], false);

  player.energizedThisTurn = true;
  assert.equal(resolvedHandActionMode(match, player.id, null), null);
  assert.equal(handCardIsActionable(match, player.id, card, "energize"), false);
});

test("legal Evos receive a matching Character default and still expose Select when requested", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const targetedCard = CARDS.find((card) => (
    card.type === "Evo"
    && player.bakugan.some((bakugan) => evoCanTarget(card, bakugan))
  ));
  assert.ok(targetedCard, "starter team should have at least one compatible Evo");
  const legalTarget = player.bakugan.find((bakugan) => evoCanTarget(targetedCard, bakugan));
  assert.ok(legalTarget);
  player.hand = [{ ...targetedCard, id: "targeted-evo" }];
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
    selectedCardId: "targeted-evo",
    selectionPending: true,
  });
  assert.equal(actions.select, true);

  const choices = defaultCardChoices(match, player.id, player.hand[0]);
  assert.equal(choices.targetBakuganId, legalTarget.id);
});
