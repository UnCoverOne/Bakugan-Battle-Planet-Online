import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { passPriorityWithTieBreak } from "../lib/manualTieBreak";
import {
  compactMatchHudSlots,
  visibleMatchHudActions,
} from "../components/game-screen-v2/matchHudState";
import { brawlVictorStat } from "../components/game-screen-v2/brawlState";

function tiedPowerState() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("HUD-TIE", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = second.id;
  state.passes = [first.id];
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  first.bakugan[0].bPower = 500;
  second.bakugan[0].bPower = 500;
  first.bakugan[0].character.bPower = 500;
  second.bakugan[0].character.bPower = 500;
  return state;
}

test("the Action HUD offers the local tie-break flip in its primary slot", () => {
  const state = tiedPowerState();
  const tieBreak = passPriorityWithTieBreak(state, state.players[1].id);
  const actions = visibleMatchHudActions({
    match: tieBreak,
    playerId: tieBreak.players[0].id,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });

  assert.equal(actions["flip-tie-break"], true);
  assert.deepEqual(compactMatchHudSlots(actions), ["flip-tie-break", null]);
});

test("the Brawl Preview highlights the stat that currently decides Victor", () => {
  const state = tiedPowerState();
  assert.equal(brawlVictorStat(state), "power");
  state.victorByDamage = true;
  assert.equal(brawlVictorStat(state), "damage");

  const layer = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
    "utf8",
  );
  const gameplay = readFileSync(
    new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url),
    "utf8",
  );

  assert.match(layer, /data-deciding=\{decidingStat === "power"/);
  assert.match(layer, /data-deciding=\{decidingStat === "damage"/);
  assert.match(css, /\.stat\[data-deciding="true"\]/);
  assert.match(gameplay, /onFlipTieBreakCard=\{flipTieBreak\}/);
});
