import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARMORED_ALLIANCE_CORE_SCAN_NUMBERS, CARDS, CORE_COMPENDIUM, CORES, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { cardCostBreakdown } from "../lib/rules/costs";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";

const aaCores = CORES.filter((core) => core.set === "Armored Alliance");

test("only the 28 unique Armored Alliance BakuCores are playable", () => {
  assert.deepEqual(aaCores.map((core) => core.number), [
    ...Array.from({ length: 17 }, (_, index) => index + 1),
    69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  ]);
  assert.equal(new Set(aaCores.map((core) => core.catalogId)).size, aaCores.length);
  assert.ok(aaCores.every((core) => !core.printings));
  assert.equal(aaCores.find((core) => core.number === 1)?.bakuGearCostReduction, 2);
  assert.equal(aaCores.find((core) => core.number === 69)?.frostStrike, 1);
  assert.equal(aaCores.find((core) => core.number === 78)?.fusionFrostStrike, 2);
  assert.equal(aaCores.find((core) => core.number === 79)?.fusionBonus, 500);
  assert.equal(aaCores.find((core) => core.number === 1)?.art, "/assets/cores/full/1.webp");
});

test("AA artwork references stay attached to canonical gameplay cores", () => {
  const printings = CORE_COMPENDIUM.flatMap((core) => core.printings ?? []);
  assert.deepEqual(printings.map((printing) => printing.number), [19, 20, 23, 24, 29, 30, 32, 33, 35, 36, 38, 41, 43, 47, 48, 54, 55, 56, 57, 58, 59, 60, 62, 63, 64]);
  assert.equal(printings.length, 25);
  assert.equal(CORES.length, 80);
  assert.equal(CORE_COMPENDIUM.length, 80);
  assert.equal(CORE_COMPENDIUM.some((core) => core.id.startsWith("aa-reprint-")), false);
  assert.equal(CORE_COMPENDIUM.find((core) => core.number === 12)?.printings?.find((printing) => printing.number === 29)?.set, "Armored Alliance");
  assert.equal(CORE_COMPENDIUM.find((core) => core.number === 13)?.printings?.find((printing) => printing.number === 30)?.art, "/assets/cores/armored-alliance/aa-30.png");
  assert.ok(printings.every((printing) => printing.set === "Armored Alliance" && printing.art.endsWith(".png")));
});

test("Armored Alliance fronts use supplied scans and retain explicit placeholders only when needed", () => {
  assert.deepEqual([...ARMORED_ALLIANCE_CORE_SCAN_NUMBERS], [2, 7, 15, 16, 17, 73, 75, 76, 78, 79]);
  assert.ok(aaCores.filter((core) => ARMORED_ALLIANCE_CORE_SCAN_NUMBERS.has(core.number)).every((core) => core.art.endsWith(`/aa-${String(core.number).padStart(2, "0")}.png`)));
  assert.ok(aaCores.filter((core) => !ARMORED_ALLIANCE_CORE_SCAN_NUMBERS.has(core.number)).every((core) => core.art.startsWith("/assets/cores/full/")));
  assert.ok(aaCores.every((core) => core.type && core.art));
  for (const number of [2, 7, 15, 16, 17]) assert.equal(aaCores.find((core) => core.number === number)?.hasProvidedScan, true);
});

test("supplied AA scan files exist for every scan-backed catalogue core", () => {
  for (const number of ARMORED_ALLIANCE_CORE_SCAN_NUMBERS) {
    const asset = fileURLToPath(new URL(`../public/assets/cores/armored-alliance/aa-${String(number).padStart(2, "0")}.png`, import.meta.url));
    assert.equal(existsSync(asset), true, `missing supplied scan for AA core ${number}`);
  }
});

test("placeholder core art renders the same effect vocabulary used by the inspector", () => {
  const source = readFileSync(new URL("../components/bakucore/BakuCoreArt.tsx", import.meta.url), "utf8");
  assert.match(source, /data-core-fallback/);
  assert.match(source, /data-core-scan/);
  assert.match(source, /hasProvidedScan/);
  assert.match(source, /baku-gear\.svg/);
  assert.match(source, /bakuGearIcon/);
  assert.match(source, /text: `: -\$\{core\.bakuGearCostReduction\}`/);
  assert.doesNotMatch(source, /Baku-Gear −\$\{core\.bakuGearCostReduction\} Energy/);
  assert.doesNotMatch(source, /overlayHeader/);
  assert.match(source, /only add rules that are absent/);
  assert.doesNotMatch(source, /placeholder\.png/);
  assert.match(source, /frost-strike\.png/);
  assert.match(source, /fusionDamageBonus/);
  assert.match(source, /bakuGearCostReduction/);
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
