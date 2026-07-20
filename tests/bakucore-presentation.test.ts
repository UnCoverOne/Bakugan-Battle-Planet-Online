import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  buildHeldCoreZoneState,
  heldCoreFanLayout,
} from "../components/game-screen-v2/gameScreenState";
import {
  CORE_TRANSFER_DELAY_MS,
  CORE_TRANSFER_DURATION_MS,
  coreTransferDestination,
  rollPresentationStage,
} from "../components/game-screen-v2/bakuCorePresentationState";

test("all six permanent BakuCore zones exist before any Core is collected", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CORE-ZONES", "bo1", [player, opponent]);

  const zones = buildHeldCoreZoneState(match, player.id);
  assert.equal(zones.player.length, 3);
  assert.equal(zones.opponent.length, 3);
  assert.deepEqual(zones.player.map((zone) => zone.slot), [1, 2, 3]);
  assert.deepEqual(zones.opponent.map((zone) => zone.slot), [1, 2, 3]);
  assert.ok(zones.player.every((zone) => zone.bakugan));
  assert.ok(zones.opponent.every((zone) => zone.bakugan));
  assert.ok([...zones.player, ...zones.opponent].every((zone) => zone.placements.length === 0));
});

test("attached BakuCores settle into the matching Bakugan zone and can be presentation-hidden", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CORE-ATTACH", "bo1", [player, opponent]);
  const bakugan = player.bakugan[0];
  const core = player.cores[0];
  const cell = "h3-3";

  match.placements.push({
    playerId: player.id,
    core,
    cell,
    order: 1,
    attachedTo: bakugan.id,
  });
  bakugan.open = true;
  bakugan.heldCoreCells.push(cell);

  const settled = buildHeldCoreZoneState(match, player.id);
  assert.deepEqual(settled.player[0].placements.map((placement) => placement.cell), [cell]);
  assert.equal(settled.player[1].placements.length, 0);

  const hidden = buildHeldCoreZoneState(match, player.id, [cell]);
  assert.equal(hidden.player[0].placements.length, 0);
  assert.equal(match.placements[0].attachedTo, bakugan.id);

  assert.deepEqual(coreTransferDestination(match, player.id, cell), {
    owner: "player",
    slot: 1,
    bakuganId: bakugan.id,
  });
});

test("BakuCore fan spacing compresses while every Core remains in the zone", () => {
  const one = heldCoreFanLayout(1);
  const six = heldCoreFanLayout(6);
  const twelve = heldCoreFanLayout(12);

  assert.equal(one.stepPercent, 0);
  assert.ok(six.widthPercent < one.widthPercent);
  assert.ok(twelve.widthPercent < six.widthPercent);
  assert.ok(twelve.stepPercent < six.stepPercent);
});

test("roll presentation reconstructs open, waiting, transferring, and settled stages", () => {
  const signature = "game:1:roll";
  const cells = ["h3-3", "h3-4"];
  const opened = rollPresentationStage(signature, cells, null, 10_000);
  assert.equal(opened.open, true);
  assert.deepEqual(opened.deferredCoreCells, cells);

  const dismissedAt = 20_000;
  const waiting = rollPresentationStage(
    signature,
    cells,
    { signature, dismissedAt },
    dismissedAt + 400,
  );
  assert.equal(waiting.open, false);
  assert.deepEqual(waiting.deferredCoreCells, cells);
  assert.equal(waiting.transferDelayMs, CORE_TRANSFER_DELAY_MS - 400);

  const transferring = rollPresentationStage(
    signature,
    cells,
    { signature, dismissedAt },
    dismissedAt + CORE_TRANSFER_DELAY_MS + 300,
  );
  assert.deepEqual(transferring.deferredCoreCells, []);
  assert.deepEqual(transferring.transferringCoreCells, cells);
  assert.equal(transferring.transferEndMs, CORE_TRANSFER_DURATION_MS - 300);

  const settled = rollPresentationStage(
    signature,
    cells,
    { signature, dismissedAt },
    dismissedAt + CORE_TRANSFER_DELAY_MS + CORE_TRANSFER_DURATION_MS + 1,
  );
  assert.equal(settled.open, false);
  assert.deepEqual(settled.deferredCoreCells, []);
  assert.deepEqual(settled.transferringCoreCells, []);
});
