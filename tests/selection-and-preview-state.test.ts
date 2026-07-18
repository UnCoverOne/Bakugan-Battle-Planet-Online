import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  bakuganForCharacterSlot,
  characterSelectionIsAvailable,
} from "../components/game-screen-v2/characterSelectionState";
import { cardArtworkUnavailable } from "../components/game-screen-v2/missingCardPreviewState";

test("Character Card selection is available only during an unresolved Selection Step", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("SEL123", "bo1", [player, opponent]);

  assert.equal(characterSelectionIsAvailable(match, player.id), false);
  match.turn = 1;
  match.phase = "selection";
  assert.equal(characterSelectionIsAvailable(match, player.id), true);
  assert.equal(bakuganForCharacterSlot(match, player.id, 1)?.id, player.bakugan[0].id);
  assert.equal(bakuganForCharacterSlot(match, player.id, 3)?.id, player.bakugan[2].id);
  assert.equal(bakuganForCharacterSlot(match, player.id, 4), null);

  match.selected[player.id] = player.bakugan[0].id;
  assert.equal(characterSelectionIsAvailable(match, player.id), false);
});

test("missing artwork detection covers placeholder paths and failed images", () => {
  assert.equal(cardArtworkUnavailable("/assets/cards/card-missing.svg"), true);
  assert.equal(cardArtworkUnavailable("/assets/cards/full/BTB-001.png", true, 0), true);
  assert.equal(cardArtworkUnavailable("/assets/cards/full/BTB-001.png", true, 640), false);
  assert.equal(cardArtworkUnavailable("", false, 0), true);
});
