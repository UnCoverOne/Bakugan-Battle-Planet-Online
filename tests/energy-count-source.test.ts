import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { energyZoneView } from "../lib/energy";
import { createMatch } from "../lib/game";
import { compactReplayPlayer, expandReplayPlayer } from "../lib/engine/replay-codec";
import { conditionFor } from "../lib/rules/catalogue-primitives";
import { ruleConditionActive, evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { evaluateNumberValue } from "../lib/rules/values";
import { setPhysicalEnergy } from "./helpers/energy";

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("ENERGY-SOURCE", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return { state, first, second };
}

function allTypeScriptSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory()
      ? allTypeScriptSources(path)
      : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [readFileSync(path, "utf8")]
        : [];
  });
}

test("physical Energy cards are the only Energy-card count source", () => {
  const { state, first, second } = match();
  setPhysicalEnergy(first, 2);
  setPhysicalEnergy(second, 3);
  first.energy = 50;
  second.energy = 0;
  assert.equal(evaluateNumberValue(state, { kind: "count", source: "energy", owner: "controller" }, { controllerId: first.id }), 2);
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), false);
  setPhysicalEnergy(first, 4);
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), true);
  second.energy = 999;
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), true, "floating/generated Energy must not affect Turbo");
});

test("printed Energy-card thresholds compile to the canonical count expression", () => {
  assert.deepEqual(conditionFor("If you have ten or more Energy cards in play, +15 [Damage Rating] instead."), {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "energy", owner: "controller" },
      operator: ">=",
      right: 10,
    },
  });
});

test("Wynton scales from physical Energy cards and ignores generated Energy", () => {
  const { state, first } = match();
  const wynton = CARDS.find((card) => card.catalogId === "aa-75");
  assert.ok(wynton);
  first.heroes = [{ ...wynton, id: "wynton-live" }];
  const bakugan = first.bakugan[0];
  const baseDamage = bakugan.character.damage ?? bakugan.damage;
  setPhysicalEnergy(first, 6);
  first.energy = 100;
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, first).damage, baseDamage + 6);
  setPhysicalEnergy(first, 9);
  first.energy = 0;
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, first).damage, baseDamage + 9);
});

test("runtime views and replay encoding derive Energy-card count from the zone", () => {
  const player = makePlayer("first", "First", STARTER_DECKS[0]);
  setPhysicalEnergy(player, 3);
  assert.equal("maxEnergy" in player, false);
  assert.equal("maxEnergy" in energyZoneView(player, 1), false);
  const compact = compactReplayPlayer(player);
  assert.equal("me" in compact, false);
  const expanded = expandReplayPlayer({ ...compact, me: 99 } as Parameters<typeof expandReplayPlayer>[0] & { me: number });
  assert.equal("maxEnergy" in expanded, false);
  assert.equal(expanded.energyZone.length, 3);
});

test("production source contains no cached Energy-count compatibility path", () => {
  const libRoot = fileURLToPath(new URL("../lib", import.meta.url));
  const source = allTypeScriptSources(libRoot).join("\n");
  assert.doesNotMatch(source, /\bmaxEnergy\b|["']max-energy["']|["']energy-zone-size["']/);
  assert.doesNotMatch(source, /kind:\s*["']energy-count["']/);
});
