import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, selectBakugan } from "../lib/game";
import {
  confirmRoll,
  playerCanConfirmRoll,
  rollResultSignature,
  rollTargetCanConfirm,
  selectRollTarget,
} from "../lib/rolling";
import {
  activeBakuganId,
  characterSelectionCanConfirm,
  playerActionTooltip,
  selectableCharacterBakugan,
} from "../components/game-screen-v2/selectionState";

test("the Selection Step exposes only closed Character Cards", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("SEL123", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "selection";
  player.bakugan[0].open = true;

  const selectable = selectableCharacterBakugan(match, player.id);
  assert.deepEqual(
    selectable.map((bakugan) => bakugan.id),
    player.bakugan.slice(1).map((bakugan) => bakugan.id),
  );
  assert.equal(characterSelectionCanConfirm(match, player.id, player.bakugan[0].id), false);
  assert.equal(characterSelectionCanConfirm(match, player.id, player.bakugan[1].id), true);
});

test("all Character Cards become selectable when every Bakugan is open", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("SEL456", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "selection";
  player.bakugan.forEach((bakugan) => { bakugan.open = true; });

  assert.deepEqual(
    selectableCharacterBakugan(match, player.id).map((bakugan) => bakugan.id),
    player.bakugan.map((bakugan) => bakugan.id),
  );

  match.phase = "power";
  assert.equal(selectableCharacterBakugan(match, player.id).length, 0);
});

test("an open winner retains its BakuCores until that Bakugan is closed", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("HOLD01", "bo1", [player, opponent]);
  const winner = player.bakugan[0];
  const heldCell = "h3-3";
  winner.open = true;
  winner.heldCoreCells = [heldCell];
  match.placements = [{
    playerId: player.id,
    core: player.cores[0],
    cell: heldCell,
    order: 1,
    attachedTo: winner.id,
  }];
  match.turn = 2;
  match.phase = "selection";

  const selectedAnother = selectBakugan(match, player.id, player.bakugan[1].id);
  assert.equal(selectedAnother.players[0].bakugan[0].open, true);
  assert.deepEqual(selectedAnother.players[0].bakugan[0].heldCoreCells, [heldCell]);
  assert.equal(selectedAnother.placements[0].attachedTo, winner.id);

  const allOpen = structuredClone(match);
  allOpen.players[0].bakugan.forEach((bakugan) => { bakugan.open = true; });
  const retracted = selectBakugan(allOpen, player.id, allOpen.players[0].bakugan[1].id);
  assert.deepEqual(retracted.players[0].bakugan[0].heldCoreCells, []);
  assert.equal(retracted.placements[0].attachedTo, undefined);
});

test("a confirmed Character Card becomes the persistent active Bakugan", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("SELACT", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "selection";
  match.selected[player.id] = player.bakugan[1].id;

  assert.equal(activeBakuganId(match, player.id), player.bakugan[1].id);
  assert.equal(selectableCharacterBakugan(match, player.id).length, 0);

  match.phase = "preRoll";
  assert.equal(activeBakuganId(match, player.id), player.bakugan[1].id);
});

test("the action tooltip guides selection and confirmation", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("SELTIP", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "selection";

  assert.match(playerActionTooltip({ match, playerId: player.id }), /Select a Character Card/i);
  assert.match(playerActionTooltip({
    match,
    playerId: player.id,
    selectedCharacterId: player.bakugan[0].id,
  }), new RegExp(`confirm ${player.bakugan[0].name}`, "i"));

  match.selected[player.id] = player.bakugan[0].id;
  assert.equal(playerActionTooltip({ match, playerId: player.id }), "");
});

test("BakuCore targets are selected before both players confirm the Roll", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("ROLL01", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "target";
  match.stepLabel = "Roll Phase • BakuCore Selection";
  match.selected[player.id] = player.bakugan[0].id;
  match.selected[opponent.id] = opponent.bakugan[0].id;
  match.placements = [
    { playerId: player.id, core: player.cores[0], cell: "h3-3", order: 1 },
    { playerId: opponent.id, core: opponent.cores[0], cell: "h3-2", order: 2 },
  ];

  assert.equal(rollTargetCanConfirm(match, player.id, "h3-3"), true);
  const playerTargeted = selectRollTarget(match, player.id, "h3-3");
  assert.deepEqual(playerTargeted.rolls, {});
  const bothTargeted = selectRollTarget(playerTargeted, opponent.id, "h3-2");
  assert.equal(playerCanConfirmRoll(bothTargeted, player.id), true);
  assert.equal(playerCanConfirmRoll(bothTargeted, opponent.id), true);

  const playerReady = confirmRoll(bothTargeted, player.id);
  assert.deepEqual(playerReady.rolls, {});
  assert.deepEqual(playerReady.passes, [player.id]);

  const rolled = confirmRoll(playerReady, opponent.id);
  assert.equal(rolled.phase, "power");
  assert.ok(rolled.rolls[player.id]);
  assert.ok(rolled.rolls[opponent.id]);
  assert.notEqual(rollResultSignature(rolled), "");
});
