import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, energizeCard, type GameCard, type MatchState } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { conditionFor } from "../lib/rules/catalogue-primitives";
import { executeRuleProgram } from "../lib/rules/executor";
import { ruleConditionActive } from "../lib/rules/modifiers";

function card(catalogId: string, id = catalogId): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}.`);
  return { ...source, id };
}

function stateWithEnergy(amount: number): MatchState {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  first.energyZone = Array.from({ length: amount }, (_, index) => card("bb-10", `boost-energy-${index}`));
  const state = createMatch("BOOST", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return state;
}

function boostConditions(actions: readonly import("../lib/rules/model").RuleAction[], output: import("../lib/rules/model").RuleCondition[] = []) {
  for (const action of actions) {
    if (action.kind === "conditional") {
      output.push(action.condition);
      boostConditions(action.whenTrue, output);
      boostConditions(action.whenFalse ?? [], output);
    } else if (action.kind === "sequence") boostConditions(action.effects, output);
    else if (action.kind === "replacement") boostConditions(action.replaceWith, output);
  }
  return output;
}

function resolveStatAmounts(state: MatchState, catalogId: string, stat: "power" | "damage") {
  const source = card(catalogId);
  const definition = ruleDefinitionForCard(source);
  const ability = definition.abilities.find((candidate) => candidate.kind === "spell");
  assert.ok(ability);
  const amounts: number[] = [];
  executeRuleProgram(
    { cardId: definition.cardId, source: source.effect, instructions: ability.instructions },
    {
      conditionIsActive: (instruction) => (
        instruction.condition.kind === "always"
          || ruleConditionActive(state, state.players[0], instruction.condition, state.players[0].bakugan[0])
      ),
      beforeInstruction: () => "continue",
      execute: (action) => {
        if (action.kind === "modify-stat" && action.stat === stat) amounts.push(Number(action.amount));
      },
    },
  );
  return amounts;
}

test("all Armored Alliance Boost cards compile a seven-Energy condition", () => {
  const boostCards = CARDS.filter((candidate) => /\bBoost\b/i.test(candidate.effect));
  assert.equal(boostCards.length, 21);
  for (const source of boostCards) {
    const definition = ruleDefinitionForCard(source);
    const boostInstructions = definition.abilities
      .flatMap((ability) => ability.instructions)
      .filter((instruction) => /\bBoost:/i.test(instruction.sourceText));
    assert.ok(boostInstructions.length > 0, `${source.catalogId} must retain a typed Boost clause.`);
    const conditions = [
      ...boostInstructions.map((instruction) => instruction.condition),
      ...boostInstructions.flatMap((instruction) => boostConditions(instruction.effects)),
    ];
    assert.ok(conditions.some((condition) => (
      condition.kind === "expression"
      && condition.expression.kind === "compare-number"
      && condition.expression.right === 7
    )),
      `${source.catalogId} must gate Boost on seven Energy cards.`,
    );
  }
});

test("Boost replacement effects resolve exactly one branch", () => {
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(6), "av-4", "damage"), [4]);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(7), "av-4", "damage"), [12]);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(6), "sv-1", "power"), [200]);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(7), "sv-1", "power"), [600]);
});

test("additive Boost effects preserve the base effect", () => {
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(6), "av-59", "power"), [-400]);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(7), "av-59", "power"), [-400]);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(6), "av-59", "damage"), []);
  assert.deepEqual(resolveStatAmounts(stateWithEnergy(7), "av-59", "damage"), [-8]);
});

test("exact-seven Boost wording is equality, not seven-or-more", () => {
  const condition = conditionFor("Boost: If you have seven Energy cards in play, +5 [Damage].");
  assert.deepEqual(condition, {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "energy", owner: "controller" },
      operator: "==",
      right: 7,
    },
  });
});

test("Boost Energize triggers are emitted when an Energy card enters play", () => {
  const player = makePlayer("first", "First", STARTER_DECKS[0]);
  const opponent = makePlayer("second", "Second", STARTER_DECKS[1]);
  const hero = card("av-76", "hydorous-ultimate-gamer");
  player.heroes = [hero];
  player.hand = [card("bb-10", "energized-card")];
  player.energyZone = Array.from({ length: 7 }, (_, index) => card("bb-10", `existing-energy-${index}`));
  const state = createMatch("BOOST-ENERGIZE", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "energize";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const resolved = energizeCard(state, player.id, "energized-card");
  assert.ok(resolved.batch.some((effect) => effect.card.catalogId === "av-76"));
});
