import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, CORES, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { cardCostBreakdown } from "../lib/rules/costs";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";

const aaCores = CORES.filter((core) => core.set === "Armored Alliance");

test("only the 28 non-reprint Armored Alliance BakuCores are catalogued", () => {
  assert.deepEqual(aaCores.map((core) => core.number), [
    ...Array.from({ length: 17 }, (_, index) => index + 1),
    69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  ]);
  assert.equal(new Set(aaCores.map((core) => core.catalogId)).size, aaCores.length);
  assert.equal(aaCores.find((core) => core.number === 1)?.bakuGearCostReduction, 2);
  assert.equal(aaCores.find((core) => core.number === 69)?.frostStrike, 1);
  assert.equal(aaCores.find((core) => core.number === 78)?.fusionFrostStrike, 2);
  assert.equal(aaCores.find((core) => core.number === 79)?.fusionBonus, 500);
});

test("Armored Alliance fronts and placeholders are wired by core number", () => {
  assert.ok(aaCores.slice(0, 17).every((core) => core.art.endsWith(`/aa-${String(core.number).padStart(2, "0")}.png`)));
  assert.ok(aaCores.slice(17).every((core) => core.art.includes("placeholder")));
  assert.ok(aaCores.every((core) => core.type && core.art));
});

test("AA Baku-Gear reductions and Fusion bonuses affect runtime calculations", () => {
  const state = createMatch("AA-CORE-TEST", "bo1", [
    makePlayer("a", "Alpha", STARTER_DECKS[0]),
    makePlayer("b", "Beta", STARTER_DECKS[1]),
  ]);
  const owner = state.players[0];
  const bakugan = owner.bakugan.find((candidate) => candidate.fusionCharacter) ?? owner.bakugan[0];
  const gear = CARDS.find((card) => card.type === "Baku-Gear" && typeof card.cost === "number")!;
  const baseline = cardCostBreakdown(state, owner.id, gear);
  const gearCore = { ...aaCores.find((core) => core.number === 1)!, id: "aa-1-held" };
  state.placements.push({ playerId: owner.id, core: gearCore, cell: "aa-1-cell", order: 1, attachedTo: bakugan.id });
  bakugan.heldCoreCells = ["aa-1-cell"];
  const reduced = cardCostBreakdown(state, owner.id, gear);
  assert.equal(reduced.reductions - baseline.reductions, 2);

  bakugan.fused = true;
  const beforeFusion = evaluateBakuganCharacteristics(state, bakugan, owner);
  const fusionCore = { ...aaCores.find((core) => core.number === 70)!, id: "aa-70-held" };
  state.placements.push({ playerId: owner.id, core: fusionCore, cell: "aa-70-cell", order: 2, attachedTo: bakugan.id });
  bakugan.heldCoreCells.push("aa-70-cell");
  const afterFusion = evaluateBakuganCharacteristics(state, bakugan, owner);
  assert.equal(afterFusion.damage - beforeFusion.damage, 5);
});
