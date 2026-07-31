import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  totalDamage,
  totalPower,
  type Core,
  type RollOutcome,
} from "../lib/game";
import { evaluateBakuganCharacteristics, ruleDefinitionForCard } from "../lib/rules";

function openRoll(playerId: string, bakuganId: string): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result: "intended-core",
    cores: [CENTER_CELL],
    accuracyRoll: 0,
    deviationRoll: 0,
    doubleRoll: 0,
    secondCoreRoll: 0,
    doubleCore: false,
    path: [],
    note: "test",
  };
}

test("Pyrus Nobilious Ultra grants 200 B-Power, never 200 Damage", () => {
  const printed = CARDS.find((card) => card.catalogId === "br-227");
  assert.ok(printed);
  assert.equal(printed.displayName, "Nobilious Ultra");
  assert.equal(printed.faction, "Pyrus");
  assert.equal(printed.effect, "[MS] or [FF]: +200 [B].");

  const definition = ruleDefinitionForCard(printed);
  const instruction = definition.abilities.flatMap((ability) => ability.instructions)[0];
  assert.deepEqual(instruction.condition, {
    kind: "held-core-type",
    coreTypes: ["Magic Shield", "Flaming Fist"],
  });
  const statEffects = instruction.effects.filter((effect) => effect.kind === "modify-stat");
  assert.deepEqual(statEffects, [{
    kind: "modify-stat",
    stat: "power",
    amount: 200,
    scale: undefined,
    duration: "instant",
    scope: "target",
  }]);

  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("NOBILIOUS", "bo1", [first, second]);
  const bakugan = state.players[0].bakugan[0];
  bakugan.name = printed.displayName;
  bakugan.faction = printed.faction;
  bakugan.bPower = printed.bPower ?? 500;
  bakugan.damage = printed.damage ?? 2;
  bakugan.character = { ...printed, id: "pyrus-nobilious-ultra-character" };
  bakugan.evoStack = [];
  bakugan.open = true;
  bakugan.heldCoreCells = [CENTER_CELL];

  const enablingCore: Core = {
    id: "test-magic-shield",
    catalogId: "test-magic-shield",
    number: 999,
    name: "Magic Shield 0B",
    type: "Magic Shield",
    bonus: 0,
    damageBonus: 0,
    art: "",
  };
  state.placements = [{
    playerId: state.players[0].id,
    core: enablingCore,
    cell: CENTER_CELL,
    order: 1,
    attachedTo: bakugan.id,
  }];
  state.phase = "power";
  state.selected[state.players[0].id] = bakugan.id;
  state.rolls[state.players[0].id] = openRoll(state.players[0].id, bakugan.id);

  const evaluated = evaluateBakuganCharacteristics(state, bakugan, state.players[0]);
  assert.equal(evaluated.power, 700);
  assert.equal(evaluated.damage, 2);
  assert.equal(totalPower(state, state.players[0].id), 700);
  assert.equal(totalDamage(state, state.players[0].id), 2);
  assert.ok(evaluated.applied.some((modifier) => (
    modifier.sourceId === bakugan.character.id
    && modifier.stat === "power"
    && modifier.amount === 200
  )));
  assert.equal(evaluated.applied.some((modifier) => (
    modifier.stat === "damage" && modifier.amount === 200
  )), false);
});
