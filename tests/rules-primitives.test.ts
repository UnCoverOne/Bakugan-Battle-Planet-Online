import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard, type MatchState } from "../lib/game";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { copyRuleObject, createRuleObject } from "../lib/rules/objects";
import {
  playerIdsForScope,
  zoneOwnerIdsFor,
} from "../lib/rules/primitives";
import type { ChoiceSpec } from "../lib/rules/model";
import { evaluateNumberValue, type NumberExpression } from "../lib/rules/values";

function stateWithPlayers(count = 2): MatchState {
  const players = [
    makePlayer("first", "First", STARTER_DECKS[0]),
    makePlayer("second", "Second", STARTER_DECKS[1]),
    makePlayer("third", "Third", STARTER_DECKS[2]),
  ].slice(0, count);
  const state = createMatch("PRIMITIVES", "bo1", players.slice(0, 2));
  if (count > 2) state.players.push(players[2]);
  return state;
}

function instance(card: GameCard, id: string): GameCard {
  return { ...card, id };
}

test("player scope is independent of two-player opponent assumptions", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(playerIdsForScope(state, "controller", { controllerId: "first" }), ["first"]);
  assert.deepEqual(playerIdsForScope(state, "opponent", { controllerId: "first" }), ["second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "each-player", { controllerId: "first" }), ["first", "second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "chosen-player", { controllerId: "first", chosenPlayerId: "third" }), ["third"]);
});

test("zone ownership can follow the chooser or a separately chosen player", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(zoneOwnerIdsFor(state, "chooser", { controllerId: "first", chooserId: "second" }), ["second"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "chosen-player", { controllerId: "first", choices: { targetPlayerId: "third" } }), ["third"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "opponent", { controllerId: "first" }), ["second", "third"]);
});

test("opponent card-play triggers do not change the recipient of controller draws", () => {
  for (const catalogId of ["bb-206", "aa-159"]) {
    const source = CARDS.find((card) => card.catalogId === catalogId);
    assert.ok(source);
    const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind === "triggered");
    assert.equal(ability?.trigger?.event, "CARD_PLAYED");
    assert.equal(ability?.trigger?.relationship, "opponent");
    assert.equal(ability?.trigger?.cardType, "Flip");
    const draws = ability.instructions
      .flatMap((instruction) => instruction.effects)
      .filter((effect) => effect.kind === "draw");
    assert.deepEqual(draws, [{ kind: "draw", amount: 1, playerScope: "controller" }]);
  }
});

test("dynamic number expressions evaluate typed counts and arithmetic", () => {
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-a"), instance(CARDS.find((card) => card.type === "Hero")!, "hero-b")];
  const expression: NumberExpression = { kind: "product", factors: [100, { kind: "count", source: "hero", owner: "controller" }] };
  assert.equal(evaluateNumberValue(state, expression, { controllerId: "first" }), 200);
  assert.equal(evaluateNumberValue(state, { kind: "choice-value", choiceId: "xValue" }, { controllerId: "first", choices: { xValue: 4 } }), 4);
});

test("chooser ownership and hidden-zone ownership are independent", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Opponent chooses from controller hand",
    minimum: 1,
    maximum: 1,
    chooser: "opponent",
    owner: "controller",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0].chooserId, "second");
  assert.deepEqual(schema.fields[0].options.map((option) => [option.id, option.ownerId]), [["first-hand", "first"]]);
});

test("each-player choices build a distinct legal option pool from each chooser's own zone", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Each player discards",
    minimum: 1,
    maximum: 1,
    chooser: "each-player",
    owner: "chooser",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.simultaneous, true);
  assert.deepEqual(schema.fields.map((field) => [field.chooserId, field.options.map((option) => option.id)]), [
    ["first", ["first-hand"]],
    ["second", ["second-hand"]],
  ]);
});

test("catalogue primitives compile player scope, copy and typed dynamic amounts", () => {
  const base = CARDS[0];
  const drawCard = { ...base, effect: "Each player draws two cards." };
  const draw = parseAtomicEffects(drawCard, drawCard.effect).find((action) => action.kind === "draw");
  assert.ok(draw && draw.kind === "draw");
  assert.equal(draw.playerScope, "each-player");
  assert.equal(draw.amount, 2);

  const scaleCard = { ...base, effect: "+100 [B] for each Hero you have in play." };
  const stat = parseAtomicEffects(scaleCard, scaleCard.effect).find((action) => action.kind === "modify-stat");
  assert.ok(stat && stat.kind === "modify-stat");
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-scale")];
  assert.equal(evaluateNumberValue(state, stat.amount, { controllerId: "first" }), 100);

  const copyCard = { ...base, effect: "Copy the effect of an Action card." };
  const copy = parseAtomicEffects(copyCard, copyCard.effect).find((action) => action.kind === "copy");
  assert.deepEqual(copy, {
    kind: "copy",
    target: "batch-action",
    independentChoices: true,
    targetChoiceId: "targetEffectId",
    count: { kind: "constant", value: 1 },
    controller: "controller",
  });
});

test("copy objects keep source identity while supporting independent or inherited selections", () => {
  const card = CARDS.find((candidate) => candidate.type === "Action")!;
  const ability = ruleDefinitionForCard(card).abilities.find((candidate) => candidate.kind !== "triggered")!;
  const source = createRuleObject({ controllerId: "first", card: instance(card, "copy-source"), ability, choices: { targetBakuganId: "bakugan-a" } });
  source.resolvedChoices = { "0": { targetBakuganId: "bakugan-a" } };

  const independent = copyRuleObject(source, "second");
  assert.equal(independent.copiedFromObjectId, source.id);
  assert.deepEqual(independent.choices, {});
  assert.deepEqual(independent.resolvedChoices, {});
  assert.notEqual(independent.independentChoiceSetId, source.independentChoiceSetId);

  const inherited = copyRuleObject(source, "second", { independentChoices: false });
  assert.deepEqual(inherited.choices, source.choices);
  assert.deepEqual(inherited.resolvedChoices, source.resolvedChoices);
});

test("Absorb compiles its optional negate-and-copy sentence as one generalized operation", () => {
  const absorb = CARDS.find((card) => card.catalogId === "bb-1")!;
  const definition = ruleDefinitionForCard(absorb);
  const instruction = definition.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.effects.some((effect) => effect.kind === "negate" && effect.copy));
  assert.ok(instruction);
  const negate = instruction.effects.find((action) => action.kind === "negate");
  assert.ok(negate && negate.kind === "negate" && negate.copy);
  assert.ok(instruction.choices.some((choice) => choice.id === "targetEffectId"));
  assert.ok(instruction.choices.some((choice) => choice.id === "confirmed"));
});

test("Cycling Actions compile ordered effects and return themselves to the owner deck bottom", () => {
  const cyclingIds = ["bb-5", "bb-33", "bb-64", "bb-85", "bb-113"];
  for (const catalogId of cyclingIds) {
    const card = CARDS.find((candidate) => candidate.catalogId === catalogId);
    assert.ok(card, `Missing ${catalogId}`);
    const instructions = ruleDefinitionForCard(card).abilities.flatMap((ability) => ability.instructions);
    const move = instructions.flatMap((instruction) => instruction.actions).find((action) => (
      action.kind === "move" && action.subject === "self" && action.destination === "owner-deck-bottom"
    ));
    assert.deepEqual(move, {
      kind: "move",
      verb: "return",
      object: "card",
      amount: 1,
      subject: "self",
      destination: "owner-deck-bottom",
    }, `${catalogId} should recycle only after its primary effect`);
    assert.equal(instructions.at(-1)?.actions.includes(move!), true);
  }

  const madness = CARDS.find((card) => card.catalogId === "bb-33")!;
  const instructions = ruleDefinitionForCard(madness).abilities.flatMap((ability) => ability.instructions);
  const draw = instructions.flatMap((instruction) => instruction.actions).find((action) => action.kind === "draw");
  const discardInstruction = instructions.find((instruction) => instruction.actions.some((action) => action.kind === "discard"));
  const discard = discardInstruction?.actions.find((action) => action.kind === "discard");
  assert.ok(draw?.kind === "draw" && discard?.kind === "discard" && discardInstruction);
  assert.equal(draw.playerScope, "controller");
  assert.equal(discard.playerScope, "opponent");
  assert.ok(discardInstruction.choices.some((choice) => (
    choice.id === "discardCardIds" && choice.chooser === "opponent" && choice.owner === "opponent"
  )));
});

test("repeatable discard-for-bonus cards compile as one paid loop", () => {
  for (const [catalogId, amount] of [["bb-41", 3], ["bb-244", 2]] as const) {
    const card = CARDS.find((candidate) => candidate.catalogId === catalogId);
    assert.ok(card, `Missing ${catalogId}`);
    const definition = ruleDefinitionForCard(card);
    const instructions = definition.abilities.flatMap((ability) => ability.instructions);
    const repeated = instructions.find((instruction) => instruction.repeatWhileSelected === "discardCardIds");
    assert.ok(repeated, `${catalogId} should compile a repeatable instruction`);
    assert.deepEqual(repeated.condition, { kind: "selection-made", choiceId: "discardCardIds" });
    assert.equal(repeated.actions[0]?.kind, "discard", `${catalogId} should pay before granting its bonus`);
    assert.ok(repeated.actions.some((action) => (
      action.kind === "modify-stat" && action.stat === "damage" && action.amount === amount
    )));
    assert.equal(instructions.some((instruction) => /^You may use this any number/i.test(instruction.sourceText)), false);
  }

  const nillious = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "bb-244")!);
  const victor = nillious.abilities.find((ability) => ability.kind === "triggered");
  assert.equal(victor?.trigger?.event, "VICTOR_DECLARED");
  assert.equal(victor?.instructions.some((instruction) => instruction.repeatWhileSelected === "discardCardIds"), true);
});

test("Flip-discard Victor abilities compile restricted payment before payoff", () => {
  for (const [catalogId, amount] of [["br-112", 4], ["aa-111", 5]] as const) {
    const card = CARDS.find((candidate) => candidate.catalogId === catalogId);
    assert.ok(card, `Missing ${catalogId}`);
    const ability = ruleDefinitionForCard(card).abilities.find((candidate) => (
      candidate.kind === "triggered" && candidate.trigger?.event === "VICTOR_DECLARED"
    ));
    assert.ok(ability, `${catalogId} should remain a Victor trigger`);
    assert.equal(ability.instructions.length, 1, `${catalogId} should bind payment and payoff`);
    const instruction = ability.instructions[0];
    assert.deepEqual(instruction.condition, { kind: "selection-made", choiceId: "discardCardIds" });
    assert.equal(instruction.actions[0]?.kind, "discard");
    assert.ok(instruction.actions.some((action) => (
      action.kind === "modify-stat" && action.stat === "damage" && action.amount === amount
    )));
    assert.ok(instruction.choices.some((choice) => (
      choice.id === "discardCardIds"
      && choice.optional
      && choice.owner === "controller"
      && choice.maximum === 1
      && choice.cardTypes?.length === 1
      && choice.cardTypes[0] === "Flip"
    )));
  }
});

test("third-person opponent discard text compiles an exact mandatory choice", () => {
  for (const catalogId of ["bb-311", "br-109"]) {
    const card = CARDS.find((candidate) => candidate.catalogId === catalogId);
    assert.ok(card, `Missing ${catalogId}`);
    const ability = ruleDefinitionForCard(card).abilities.find((candidate) => (
      candidate.kind === "triggered" && candidate.trigger?.event === "VICTOR_DECLARED"
    ));
    assert.ok(ability);
    const instruction = ability.instructions.find((candidate) => (
      candidate.actions.some((action) => action.kind === "discard")
    ));
    assert.ok(instruction, `${catalogId} should compile “discards a card”`);
    const discard = instruction.actions.find((action) => action.kind === "discard");
    assert.deepEqual(discard, {
      kind: "discard",
      amount: 1,
      minimum: 1,
      maximum: 1,
      repeated: false,
      playerScope: "opponent",
    });
    assert.ok(instruction.choices.some((choice) => (
      choice.id === "discardCardIds"
      && choice.chooser === "opponent"
      && choice.owner === "opponent"
      && choice.minimum === 1
      && choice.maximum === 1
      && !choice.optional
    )));
  }
});

test("Group 6 faction-qualified card-play triggers retain every printed faction", () => {
  const expected = new Map<string, GameCard["faction"][]>([
    ["aa-79", ["Darkus", "Ventus"]],
    ["aa-142", ["Haos", "Darkus"]],
    ["aa-164", ["Aquos"]],
    ["aa-168", ["Aurelus"]],
    ["aa-180", ["Darkus"]],
    ["aa-187", ["Haos"]],
    ["aa-206", ["Pyrus"]],
    ["aa-218", ["Ventus"]],
  ]);
  for (const [catalogId, factions] of expected) {
    const source = CARDS.find((card) => card.catalogId === catalogId)!;
    const trigger = ruleDefinitionForCard(source).abilities.find((ability) => (
      ability.kind === "triggered" && ability.trigger?.event === "CARD_PLAYED"
    ))?.trigger;
    assert.deepEqual(trigger?.factions, factions, `${catalogId} should filter the played card's faction`);
  }
});

test("Group 7 Energize cards preserve chooser, source owner, and destination owner", () => {
  for (const [catalogId, amount, enters] of [
    ["aa-42", 1, "uncharged"],
    ["bb-175", 2, "charged"],
  ] as const) {
    const definition = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === catalogId)!);
    const instruction = definition.abilities.flatMap((ability) => ability.instructions)
      .find((candidate) => candidate.actions.some((action) => action.kind === "energize" && action.source === "deck"))!;
    assert.ok(instruction.choices.some((choice) => choice.id === "confirmed" && choice.chooser === "each-player"));
    assert.deepEqual(instruction.actions.find((action) => action.kind === "energize"), {
      kind: "energize",
      amount,
      source: "deck",
      enters,
      playerScope: "each-player",
      sourceOwner: "each-player",
      destinationOwner: "each-player",
    });
  }

  const pandoxx = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "aa-212")!);
  const instruction = pandoxx.abilities.flatMap((ability) => ability.instructions)[0];
  assert.ok(instruction.choices.some((choice) => (
    choice.id === "handCardIds" && choice.chooser === "opponent"
    && choice.owner === "controller" && choice.targetOwner === "controller"
  )));
  assert.ok(instruction.choices.some((choice) => choice.id === "confirmed" && choice.chooser === "opponent"));
  assert.deepEqual(instruction.actions.find((action) => action.kind === "energize"), {
    kind: "energize",
    amount: 1,
    source: "hand",
    enters: "charged",
    playerScope: "controller",
    sourceOwner: "controller",
    destinationOwner: "controller",
  });
});

test("Group 8 attached-BakuCore bonuses compile as source-Bakugan thresholds", () => {
  for (const catalogId of ["br-123", "br-126", "br-127"]) {
    const instruction = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === catalogId)!)
      .abilities.flatMap((ability) => ability.instructions)[0];
    assert.deepEqual(instruction.condition, {
      kind: "expression",
      expression: {
        kind: "compare-number",
        operator: ">=",
        left: {
          kind: "property",
          subject: { kind: "bakugan", selector: "source" },
          property: "held-bakucore-count",
        },
        right: 2,
      },
    });
  }
});

test("Group 9 live scaling cards compile typed board-state expressions", () => {
  const amountFor = (catalogId: string, actionIndex = 0) => {
    const actions = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === catalogId)!)
      .abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.actions)
      .filter((action) => action.kind === "modify-stat");
    return actions[actionIndex]?.amount;
  };
  assert.deepEqual(amountFor("bb-31"), {
    kind: "product",
    factors: [100, {
      kind: "property",
      subject: { kind: "bakugan", selector: "active", owner: "controller" },
      property: "damage",
    }],
  });
  assert.deepEqual(amountFor("bb-60", 1), {
    kind: "product",
    factors: [1, {
      kind: "property",
      subject: { kind: "bakugan", selector: "active", owner: "controller" },
      property: "frost",
    }],
  });
  assert.deepEqual(amountFor("bb-98"), {
    kind: "product",
    factors: [2, { kind: "count", source: "bakugan", owner: "controller", faction: "Pyrus" }],
  });
  assert.deepEqual(amountFor("aa-73"), {
    kind: "product",
    factors: [1, { kind: "count", source: "hero", owner: "controller" }],
  });

  const rite = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "bb-44")!);
  const discardInstruction = rite.abilities.flatMap((ability) => ability.instructions)
    .find((instruction) => instruction.actions.some((action) => action.kind === "discard"))!;
  const count = { kind: "count", source: "bakugan", owner: "controller", faction: "Darkus" } as const;
  assert.ok(discardInstruction.choices.some((choice) => (
    choice.id === "discardCardIds" && choice.chooser === "chosen-player" && choice.owner === "chosen-player"
    && JSON.stringify(choice.minimum) === JSON.stringify(count)
    && JSON.stringify(choice.maximum) === JSON.stringify(count)
  )));
  assert.deepEqual(discardInstruction.actions.find((action) => action.kind === "discard"), {
    kind: "discard",
    amount: count,
    minimum: count,
    maximum: count,
    repeated: false,
    playerScope: "chosen-player",
  });
});

test("Group 10 discarded and revealed card costs feed the following stat modifier", () => {
  const magnus = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "bb-199")!);
  const magnusInstruction = magnus.abilities.find((ability) => ability.trigger?.event === "VICTOR_DECLARED")!.instructions[0];
  assert.deepEqual(magnusInstruction.condition, { kind: "selection-made", choiceId: "discardCardIds" });
  assert.equal(magnusInstruction.actions[0]?.kind, "discard");
  assert.deepEqual(magnusInstruction.actions.find((action) => action.kind === "modify-stat")?.amount, {
    kind: "product",
    factors: [1, { kind: "previous-result", property: "card-cost" }],
  });

  const pegatrix = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "br-97")!);
  const victor = pegatrix.abilities.find((ability) => ability.trigger?.event === "VICTOR_DECLARED")!;
  assert.equal(victor.instructions[0]?.actions[0]?.kind, "reveal");
  assert.deepEqual(victor.instructions[1]?.actions.find((action) => action.kind === "modify-stat")?.amount, {
    kind: "product",
    factors: [2, { kind: "previous-result", property: "card-cost" }],
  });
});
