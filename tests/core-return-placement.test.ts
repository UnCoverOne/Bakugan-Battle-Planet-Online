import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  beginCorePlacement,
  cloneMatch,
  createMatch,
  legalPlacementCells,
  placeCore,
  setReady,
  type MatchState,
} from "../lib/game";
import {
  captureCoreReturns,
  legalCoreReturnCells,
  pendingCoreReturnsForPlayer,
  placeCoreOrReturnCore,
} from "../lib/coreReturns";
import { corePlacementMatrixScale } from "../components/game-screen-v2/corePlacementLayout";

function buildPlacedMatch() {
  const a = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const b = makePlayer("b", "Beta", STARTER_DECKS[1]);
  let state = setReady(setReady(createMatch("RETURN", "bo1", [a, b]), "a"), "b");
  state = beginCorePlacement(state, Number.POSITIVE_INFINITY);
  for (let index = 0; index < 12; index += 1) {
    const player = state.players.find((candidate) => candidate.id === state.priority)!;
    const core = player.cores[state.placements.filter((placement) => placement.playerId === player.id).length];
    state = placeCore(state, player.id, core.id, legalPlacementCells(state)[0]);
  }
  return state;
}

function detachForLegacyRetraction(state: MatchState, playerId: string, cell: string) {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const placement = state.placements.find((candidate) => candidate.cell === cell)!;
  const bakugan = player.bakugan.find((candidate) => candidate.id === placement.attachedTo)!;
  bakugan.open = false;
  bakugan.heldCoreCells = bakugan.heldCoreCells.filter((candidate) => candidate !== cell);
  delete placement.attachedTo;
}

test("ordinary retraction asks the retracting player to choose a new legal Core position", () => {
  const before = buildPlacedMatch();
  const player = before.players[0];
  const bakugan = player.bakugan[0];
  const placement = before.placements.find((candidate) => candidate.playerId === player.id)!;
  bakugan.open = true;
  bakugan.heldCoreCells = [placement.cell];
  placement.attachedTo = bakugan.id;

  const after = cloneMatch(before);
  after.phase = "endPlay";
  after.stepLabel = "End Phase • Play Step";
  after.priority = before.startingPlayer;
  after.version += 1;
  detachForLegacyRetraction(after, player.id, placement.cell);

  const pending = captureCoreReturns(before, after);
  assert.equal(pending.phase, "retract");
  assert.equal(pending.priority, player.id);
  assert.equal(pending.placements.some((candidate) => candidate.core.id === placement.core.id), false);
  assert.equal(pendingCoreReturnsForPlayer(pending, player.id)[0]?.core.id, placement.core.id);

  const legal = legalCoreReturnCells(pending);
  const destination = legal.find((cell) => cell !== placement.cell);
  assert.ok(destination, "a legal position other than the old cell is available");
  const returned = placeCoreOrReturnCore(pending, player.id, placement.core.id, destination);
  assert.equal(returned.phase, "endPlay");
  assert.equal(returned.placements.find((candidate) => candidate.core.id === placement.core.id)?.cell, destination);
  assert.equal(pendingCoreReturnsForPlayer(returned, player.id).length, 0);
});

test("the non-Victor returns Cores before a Team Attack Victor", () => {
  const before = buildPlacedMatch();
  const winner = before.players[0];
  const loser = before.players[1];
  const winnerPlacement = before.placements.find((candidate) => candidate.playerId === winner.id)!;
  const loserPlacement = before.placements.find((candidate) => candidate.playerId === loser.id)!;
  const winnerBakugan = winner.bakugan[0];
  const loserBakugan = loser.bakugan[0];
  winnerBakugan.open = true;
  loserBakugan.open = true;
  winnerBakugan.heldCoreCells = [winnerPlacement.cell];
  loserBakugan.heldCoreCells = [loserPlacement.cell];
  winnerPlacement.attachedTo = winnerBakugan.id;
  loserPlacement.attachedTo = loserBakugan.id;
  before.phase = "postDamage";
  before.pendingLoser = loser.id;
  before.brawlWinner = winner.id;
  before.teamAttack = true;

  const after = cloneMatch(before);
  after.phase = "endPlay";
  after.stepLabel = "End Phase • Play Step";
  after.version += 1;
  detachForLegacyRetraction(after, loser.id, loserPlacement.cell);
  detachForLegacyRetraction(after, winner.id, winnerPlacement.cell);

  let pending = captureCoreReturns(before, after);
  assert.equal(pending.priority, loser.id);
  pending = placeCoreOrReturnCore(
    pending,
    loser.id,
    loserPlacement.core.id,
    legalCoreReturnCells(pending)[0],
  );
  assert.equal(pending.phase, "retract");
  assert.equal(pending.priority, winner.id);
  pending = placeCoreOrReturnCore(
    pending,
    winner.id,
    winnerPlacement.core.id,
    legalCoreReturnCells(pending)[0],
  );
  assert.equal(pending.phase, "endPlay");
});

test("the retracting player places an attached Core even when the opponent originally supplied it", () => {
  const before = buildPlacedMatch();
  const holder = before.players[0];
  const supplied = before.placements.find((candidate) => candidate.playerId === before.players[1].id)!;
  const bakugan = holder.bakugan[0];
  bakugan.open = true;
  bakugan.heldCoreCells = [supplied.cell];
  supplied.attachedTo = bakugan.id;

  const after = cloneMatch(before);
  after.phase = "endPlay";
  after.version += 1;
  detachForLegacyRetraction(after, holder.id, supplied.cell);
  const pending = captureCoreReturns(before, after);
  const item = pendingCoreReturnsForPlayer(pending, holder.id)[0];
  assert.equal(item.ownerId, before.players[1].id);

  const returned = placeCoreOrReturnCore(pending, holder.id, item.core.id, legalCoreReturnCells(pending)[0]);
  assert.equal(returned.placements.find((placement) => placement.core.id === item.core.id)?.playerId, before.players[1].id);
});

test("moving an attached Core directly to another Bakugan is not treated as a return", () => {
  const before = buildPlacedMatch();
  const placement = before.placements[0];
  const first = before.players[0].bakugan[0];
  const second = before.players[1].bakugan[0];
  first.open = true;
  second.open = true;
  first.heldCoreCells = [placement.cell];
  placement.attachedTo = first.id;

  const after = cloneMatch(before);
  after.version += 1;
  after.players[0].bakugan[0].heldCoreCells = [];
  after.players[1].bakugan[0].heldCoreCells = [placement.cell];
  after.placements[0].attachedTo = second.id;
  const unchanged = captureCoreReturns(before, after);
  assert.notEqual(unchanged.phase, "retract");
  assert.equal(unchanged.placements[0].attachedTo, second.id);
});

test("held Cores neither occupy nor anchor the BakuCore field", () => {
  const before = buildPlacedMatch();
  const heldPlacement = before.placements.find((placement) => placement.cell === CENTER_CELL)!;
  const returningPlacement = before.placements.find((placement) => placement.cell !== CENTER_CELL)!;
  before.placements = [heldPlacement, returningPlacement];

  const heldBakugan = before.players[1].bakugan[0];
  const returningBakugan = before.players[0].bakugan[0];
  heldBakugan.open = true;
  returningBakugan.open = true;
  heldBakugan.heldCoreCells = [heldPlacement.cell];
  returningBakugan.heldCoreCells = [returningPlacement.cell];
  heldPlacement.attachedTo = heldBakugan.id;
  returningPlacement.attachedTo = returningBakugan.id;

  const after = cloneMatch(before);
  after.phase = "endPlay";
  after.version += 1;
  detachForLegacyRetraction(after, before.players[0].id, returningPlacement.cell);

  const pending = captureCoreReturns(before, after);
  assert.deepEqual(legalCoreReturnCells(pending), [CENTER_CELL]);
  const returned = placeCoreOrReturnCore(
    pending,
    before.players[0].id,
    returningPlacement.core.id,
    CENTER_CELL,
  );
  const heldAfter = returned.placements.find((placement) => placement.core.id === heldPlacement.core.id)!;
  const heldBakuganAfter = returned.players[1].bakugan.find((bakugan) => bakugan.id === heldBakugan.id)!;
  assert.equal(heldAfter.cell, `held:${heldPlacement.core.id}`);
  assert.deepEqual(heldBakuganAfter.heldCoreCells, [`held:${heldPlacement.core.id}`]);
  assert.equal(returned.placements.find((placement) => placement.core.id === returningPlacement.core.id)?.cell, CENTER_CELL);
});

test("an empty field accepts the first returned Core in the centre", () => {
  const state = buildPlacedMatch();
  state.phase = "retract";
  state.placements = [];
  assert.deepEqual(legalCoreReturnCells(state), [CENTER_CELL]);
});

test("BakuCore placement scaling fits both the available width and height", () => {
  assert.equal(corePlacementMatrixScale({ containerWidthPx: 1200, containerHeightPx: 900, rootFontSizePx: 16 }), 1);

  const widthLimited = corePlacementMatrixScale({
    containerWidthPx: 324,
    containerHeightPx: 900,
    rootFontSizePx: 16,
  });
  assert.ok(widthLimited !== null);
  assert.ok(Math.abs(widthLimited - 0.5) < 0.000001);

  const heightLimited = corePlacementMatrixScale({
    containerWidthPx: 1200,
    containerHeightPx: 360.8,
    rootFontSizePx: 16,
  });
  assert.ok(heightLimited !== null);
  assert.ok(Math.abs(heightLimited - 0.5) < 0.000001);
});

test("initial and returned BakuCore placement use the same responsive matrix surface", () => {
  const initialSource = readFileSync(
    new URL("../components/game-screen-v2/CorePlacementLayer.tsx", import.meta.url),
    "utf8",
  );
  const returnSource = readFileSync(
    new URL("../components/game-screen-v2/CoreReturnPlacementLayer.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(initialSource.includes("<CorePlacementMatrix"));
  assert.ok(returnSource.includes("<CorePlacementMatrix"));
  assert.equal(returnSource.includes("className={styles.matrix}"), false);
  assert.equal(returnSource.includes("className={styles.matrixGrid}"), false);
});
