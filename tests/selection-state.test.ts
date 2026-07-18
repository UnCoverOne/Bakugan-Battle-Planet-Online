import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
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
