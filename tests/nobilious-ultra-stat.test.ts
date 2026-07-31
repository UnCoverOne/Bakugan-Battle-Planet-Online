import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  normalizeMatchState,
  totalDamage,
  totalPower,
  type Core,
  type MatchState,
  type RollOutcome,
} from "../lib/game";
import { evaluateBakuganCharacteristics, ruleDefinitionForCard } from "../lib/rules";
import { brawlCombatantView } from "../components/game-screen-v2/brawlState";

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

function nobiliousBrawl(): MatchState {
  const printed = CARDS.find((card) => card.catalogId === "br-227");
  assert.ok(printed);
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
  return state;
}

test("Pyrus Nobilious Ultra grants 200 B-Power, never 200 Damage", () => {
  const printed = CARDS.find((card) => card.catalogId === "br-227");
  assert.ok(printed);
  assert.equal(printed.displayName, "Nobilious Ultra");
  assert.equal(printed.faction, "Pyrus");
  assert.equal(printed.bPower, 500);
  assert.equal(printed.damage, 2);
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

  const state = nobiliousBrawl();
  const bakugan = state.players[0].bakugan[0];
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

test("normalization repairs historical Nobilious Ultra snapshots with +200 Damage", () => {
  const malformed = nobiliousBrawl();
  const bakugan = malformed.players[0].bakugan[0];
  bakugan.damage = 202;
  bakugan.character.damage = 202;
  malformed.damageBoost[bakugan.id] = 200;

  const state = normalizeMatchState(malformed);
  const repaired = state.players[0].bakugan[0];
  assert.equal(repaired.bPower, 500);
  assert.equal(repaired.damage, 2);
  assert.equal(repaired.character.bPower, 500);
  assert.equal(repaired.character.damage, 2);
  assert.equal(repaired.character.effect, "[MS] or [FF]: +200 [B].");
  assert.equal(state.damageBoost[repaired.id], undefined);
  assert.equal(totalPower(state, state.players[0].id), 700);
  assert.equal(totalDamage(state, state.players[0].id), 2);

  const preview = brawlCombatantView(state, state.players[0]);
  assert.ok(preview);
  assert.equal(preview.basePower, 500);
  assert.equal(preview.baseDamage, 2);
  assert.equal(preview.power, 700);
  assert.equal(preview.damage, 2);
  assert.equal(preview.modifiers.some((modifier) => /200 Damage/i.test(modifier)), false);
});
