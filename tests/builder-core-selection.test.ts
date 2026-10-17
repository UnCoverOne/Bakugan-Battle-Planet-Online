import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoreAdditionGuard } from "../lib/builder-core-selection";
import { coreForSet, corePreviewStats } from "../lib/core-preview";
import type { Core } from "../lib/game";

const cores = [
  { id: "shield-a", type: "Shield" as const },
  { id: "shield-b", type: "Shield" as const },
  { id: "fist", type: "Fist" as const },
  { id: "helix", type: "Helix" as const },
];
const guard = (selected: string[], required: string[], hasCharacters = true, singleton = false) =>
  createCoreAdditionGuard(selected, required, hasCharacters, singleton, cores);

test("one character permits only its two required core types and counts", () => {
  const canAdd = guard([], ["Shield", "Fist"]);
  assert.equal(canAdd("shield-a"), true);
  assert.equal(canAdd("fist"), true);
  assert.equal(canAdd("helix"), false);
  const afterShield = guard(["shield-a"], ["Shield", "Fist"]);
  assert.equal(afterShield("shield-a"), false);
  assert.equal(afterShield("shield-b"), false);
  assert.equal(afterShield("fist"), true);
  const complete = guard(["shield-a", "fist"], ["Shield", "Fist"]);
  assert.equal(complete("fist"), false);
});

test("shared types aggregate across characters and different printings share the quota", () => {
  const required = ["Shield", "Shield", "Shield", "Fist"];
  assert.equal(guard(["shield-a", "shield-b"], required)("shield-a"), true);
  assert.equal(guard(["shield-a", "shield-b", "shield-a"], required)("shield-b"), false);
  assert.equal(guard(["shield-a", "shield-b", "shield-a"], required)("fist"), true);
});

test("character changes recompute requirements; excess existing cores cannot add more", () => {
  assert.equal(guard(["shield-a"], ["Shield", "Fist", "Shield", "Helix"])("shield-b"), true);
  assert.equal(guard(["shield-a"], ["Shield", "Fist"])("shield-b"), false);
  assert.equal(guard(["shield-a", "shield-b"], ["Shield", "Fist"])("shield-a"), false);
  assert.equal(guard(["shield-a", "shield-b"], ["Shield", "Fist"])("fist"), true);
  assert.equal(guard([], [])("fist"), false);
});

test("without characters, any known core is available within the six-core limit", () => {
  const canAdd = guard([], [], false);
  for (const core of cores) assert.equal(canAdd(core.id), true);
  assert.equal(canAdd("missing"), false);
  assert.equal(guard(Array(6).fill("shield-a"), [], false)("fist"), false);
});

test("singleton copy limits still apply even when the team requires repeated types", () => {
  const canAdd = guard(["shield-a"], ["Shield", "Shield"], true, true);
  assert.equal(canAdd("shield-a"), false);
  assert.equal(canAdd("shield-b"), true);
  assert.equal(guard(["shield-a"], [], false, true)("shield-a"), false);
});

test("builder and Compendium share the same non-repeating BakuCore preview stats", () => {
  const source: Core = {
    id: "core-2",
    number: 2,
    name: "Fist +150 B / -1 D",
    set: "Battle Brawlers",
    type: "Fist",
    bonus: 150,
    damageBonus: -1,
    bakuGearCostReduction: 2,
    art: "/assets/cores/full/2.webp",
    printings: [{
      id: "aa-printing-19",
      set: "Armored Alliance",
      number: 19,
      art: "/assets/cores/armored-alliance/aa-19.png",
    }],
  };
  assert.deepEqual(corePreviewStats(source), ["+150 B", "-1 D", "Baku-Gear −2 Energy"]);

  const aa = coreForSet(source, "Armored Alliance");
  assert.equal(aa.set, "Armored Alliance");
  assert.equal(aa.number, 19);
  assert.equal(aa.art, "/assets/cores/armored-alliance/aa-19.png");
  assert.deepEqual(corePreviewStats(aa), corePreviewStats(source));
  assert.equal(source.number, 2);
  assert.strictEqual(coreForSet(source, "All"), source);
});
