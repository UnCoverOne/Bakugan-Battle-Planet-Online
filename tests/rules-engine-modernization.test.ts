import { setPhysicalEnergy } from "./helpers/energy";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  completeScheduledAttackActions,
  emitGameEvent,
  passPriority,
  recordCardPlayedForTurn,
  resolveStructuredEffect,
  submitCardChoice,
  type Core,
} from "../lib/game";
import { captureCoreReturns, pendingCoreReturnsForPlayer } from "../lib/coreReturns";
import {
  allRuleDefinitions,
  cardCostBreakdown,
  ensureRulesState,
  evaluateBakuganCharacteristics,
  ruleDefinitionForCard,
  ruleConditionActive,
  UnsupportedCardTextError,
  validateCardAgainstRules,
} from "../lib/rules";
import { buildChoiceSchema, buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { canonicalEvoTargetAllowed } from "../lib/rules/identity";
import { createRuleObject } from "../lib/rules/objects";
import { emitRuleEvent } from "../lib/rules/triggers";
import { executeRuleProgram } from "../lib/rules/executor";
import { conditionFor, parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import {
  ALL_FACTIONS,
  effectiveBakucoreCells,
  effectiveCardFactions,
} from "../lib/rules/derived-characteristics";

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("RULES3", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected = { [first.id]: first.bakugan[0].id, [second.id]: second.bakugan[0].id };
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return state;
}

test("the reviewed typed catalogue covers every Battle Planet card exactly", () => {
  const definitions = allRuleDefinitions();
  assert.equal(definitions.length, 845);
  assert.equal(new Set(definitions.map((definition) => definition.cardId)).size, 845);
  assert.equal(CARDS.length, 845);
  for (const card of CARDS) assert.equal(validateCardAgainstRules(card), true);
  assert.ok(definitions.every((definition) => definition.implementationStatus === "complete"));
  assert.ok(definitions.every((definition) => definition.abilities.every((ability) => ability.instructions.length > 0)));
});

test("unknown or modified card text is rejected rather than resolving partially", () => {
  const source = CARDS.find((card) => card.number === 2)!;
  assert.throws(() => ruleDefinitionForCard({ ...source, effect: `${source.effect} Unsupported text.` }), (error: unknown) => error instanceof UnsupportedCardTextError && error.code === "CARD_TEXT_MISMATCH");
  assert.throws(() => ruleDefinitionForCard({ ...source, catalogId: "custom-card" }), (error: unknown) => error instanceof UnsupportedCardTextError && error.code === "UNKNOWN_CARD_DEFINITION");
});

test("instead clauses are single typed replacement branches, not additive actions", () => {
  const replacementCards = CARDS.filter((card) => /\binstead\s*\.?\s*$/i.test(card.effect));
  assert.equal(replacementCards.length, 33);
  for (const card of replacementCards) {
    const replacements = ruleDefinitionForCard(card).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.effects)
      .filter((effect) => effect.kind === "conditional" && effect.replacement);
    assert.equal(replacements.length, 1, `${card.name} must have exactly one typed replacement branch`);
  }

  for (const catalogId of ["bb-104", "bb-138", "bb-210", "aa-74"]) {
    const card = CARDS.find((candidate) => candidate.catalogId === catalogId)!;
    const replacements = ruleDefinitionForCard(card).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.effects)
      .filter((effect) => effect.kind === "conditional" && effect.replacement);
    assert.equal(replacements.length, 0, `${card.name} uses ordinary \"instead of\" rules text`);
  }
});

test("Flow replacement clauses resolve the enhanced effect instead of the base effect", () => {
  const card = CARDS.find((candidate) => candidate.catalogId === "bb-24")!;
  const definition = ruleDefinitionForCard(card);
  const spell = definition.abilities.find((ability) => ability.kind === "spell")!;
  const program = { cardId: definition.cardId, source: card.effect, instructions: spell.instructions };
  const resolvedPower = (flowActive: boolean) => {
    const amounts: number[] = [];
    executeRuleProgram(program, {
      conditionIsActive: (instruction) => (
        instruction.condition.kind === "always"
        || (instruction.condition.kind === "flow" && flowActive)
      ),
      beforeInstruction: () => "continue",
      execute: (action) => {
        if (action.kind === "modify-stat" && action.stat === "power") amounts.push(action.amount);
      },
    });
    return amounts;
  };

  assert.deepEqual(resolvedPower(false), [200]);
  assert.deepEqual(resolvedPower(true), [400]);
});

test("Light's Courage replaces +400 B with +800 B under Domination", () => {
  const state = match();
  const player = state.players[0];
  const opponent = state.players[1];
  const bakugan = player.bakugan[0];
  const card = CARDS.find((candidate) => candidate.catalogId === "bb-69")!;
  const definition = ruleDefinitionForCard(card);
  const spell = definition.abilities.find((ability) => ability.kind === "spell")!;
  const program = { cardId: definition.cardId, source: card.effect, instructions: spell.instructions };
  const resolvedPower = () => {
    const amounts: number[] = [];
    executeRuleProgram(program, {
      conditionIsActive: (instruction) => ruleConditionActive(state, player, instruction.condition, bakugan),
      beforeInstruction: () => "continue",
      execute: (action) => {
        if (action.kind === "modify-stat" && action.stat === "power") amounts.push(action.amount);
      },
    });
    return amounts;
  };

  player.bakugan.forEach((candidate) => { candidate.heldCoreCells = []; });
  opponent.bakugan.forEach((candidate) => { candidate.heldCoreCells = []; });
  assert.deepEqual(resolvedPower(), [400]);
  bakugan.heldCoreCells = ["domination-core"];
  assert.deepEqual(resolvedPower(), [800]);
});

test("replacement conditions cover sacrifice, held Core, faction, and turn-history families", () => {
  assert.deepEqual(conditionFor("Sacrifice: You may discard a card for +800 [B] instead."), {
    kind: "selection-made",
    choiceId: "discardCardIds",
  });
  assert.deepEqual(conditionFor("If that Bakugan is holding [FT], +600 [B] instead."), {
    kind: "held-core-type",
    coreTypes: ["Fist"],
    subject: "target",
  });
  assert.deepEqual(conditionFor("If [Haos], +600 [B] instead."), {
    kind: "faction",
    faction: "Haos",
    subject: "target",
  });
  assert.deepEqual(conditionFor("Aurelus Power: If you have an [Aurelus] Bakugan on your team, +800 [B] instead."), {
    kind: "faction",
    faction: "Aurelus",
    subject: "team",
  });
  assert.deepEqual(conditionFor("If you have played a card from three different factions this turn, +800 [B] instead."), {
    kind: "expression",
    expression: { kind: "compare-number", left: { kind: "count", source: "factions-played", owner: "controller" }, operator: ">=", right: 3 },
  });
  assert.deepEqual(conditionFor("If you have ten or more Energy cards in play, +15 [Damage Rating] instead."), {
    kind: "expression",
    expression: { kind: "compare-number", left: { kind: "count", source: "energy", owner: "controller" }, operator: ">=", right: 10 },
  });
});

test("Sacrifice replacements choose exactly one branch", () => {
  const card = CARDS.find((candidate) => candidate.catalogId === "bb-50")!;
  const definition = ruleDefinitionForCard(card);
  const spell = definition.abilities.find((ability) => ability.kind === "spell")!;
  const program = { cardId: definition.cardId, source: card.effect, instructions: spell.instructions };
  const resolvedPower = (sacrificed: boolean) => {
    const amounts: number[] = [];
    executeRuleProgram(program, {
      conditionIsActive: (instruction) => instruction.condition.kind === "selection-made" ? sacrificed : true,
      beforeInstruction: () => "continue",
      execute: (action) => {
        if (action.kind === "modify-stat" && action.stat === "power") amounts.push(action.amount);
      },
    });
    return amounts;
  };
  assert.deepEqual(resolvedPower(false), [200]);
  assert.deepEqual(resolvedPower(true), [800]);
});

test("played-card faction history is distinct, turn-scoped rules state", () => {
  const state = match();
  const player = state.players[0];
  const samples = ["Aquos", "Pyrus", "Darkus"].map((faction, index) => ({
    ...CARDS.find((card) => card.faction === faction)!,
    id: `played-faction-${index}`,
  }));
  const condition = conditionFor("If you have played a card from three different factions this turn, +800 [B] instead.");
  recordCardPlayedForTurn(player, samples[0], state.turn);
  recordCardPlayedForTurn(player, samples[1], state.turn);
  assert.equal(ruleConditionActive(state, player, condition), false);
  recordCardPlayedForTurn(player, samples[2], state.turn);
  assert.equal(ruleConditionActive(state, player, condition), true);
  assert.deepEqual(new Set(player.factionsPlayedThisTurn ?? []), new Set(["Aquos", "Pyrus", "Darkus"]));
});

test("triggered replacement bonuses retain their trigger ownership", () => {
  const card = CARDS.find((candidate) => candidate.catalogId === "aa-138")!;
  const definition = ruleDefinitionForCard(card);
  const trigger = definition.abilities.find((ability) => ability.kind === "triggered")!;
  assert.ok(trigger);
  assert.ok(trigger.instructions.flatMap((instruction) => instruction.effects)
    .some((effect) => effect.kind === "conditional" && effect.replacement));
  const entry = definition.abilities.find((ability) => ability.kind === "spell")!;
  assert.ok(entry.instructions.flatMap((instruction) => instruction.effects)
    .every((effect) => effect.kind !== "modify-stat"));
});

test("open Bakugan count parser emits generalized boolean comparisons", () => {
  const expected = (operator: "==" | ">=" | "<=" | ">" | "<", right: number) => ({
    kind: "expression" as const,
    expression: { kind: "compare-number" as const, left: { kind: "count" as const, source: "open-bakugan" as const, owner: "controller" as const }, operator, right },
  });
  assert.deepEqual(conditionFor("If you only have one open Bakugan."), expected("==", 1));
  assert.deepEqual(conditionFor("If you have only two open Bakugan."), expected("==", 2));
  assert.deepEqual(conditionFor("If you have three or more open Bakugan."), expected(">=", 3));
  assert.deepEqual(conditionFor("If you have at most two open Bakugan."), expected("<=", 2));
  assert.deepEqual(conditionFor("If you have more than one open Bakugan."), expected(">", 1));
  assert.deepEqual(conditionFor("If you have fewer than three open Bakugan."), expected("<", 3));
  assert.deepEqual(conditionFor("If you have no open Bakugan."), expected("==", 0));
});

test("Ice Elation and Solitude resolve only with exactly one open Bakugan", () => {
  const state = match();
  const player = state.players[0];
  const cases = [
    { catalogId: "bb-14", stat: "damage", amount: 8 },
    { catalogId: "bb-21", stat: "power", amount: 1000 },
  ] as const;

  for (const expected of cases) {
    const card = CARDS.find((candidate) => candidate.catalogId === expected.catalogId)!;
    const definition = ruleDefinitionForCard(card);
    const spell = definition.abilities.find((ability) => ability.kind === "spell")!;
    const program = { cardId: definition.cardId, source: card.effect, instructions: spell.instructions };
    assert.deepEqual(spell.instructions[0].condition, {
      kind: "expression",
      expression: { kind: "compare-number", left: { kind: "count", source: "open-bakugan", owner: "controller" }, operator: "==", right: 1 },
    });

    for (const openCount of [0, 1, 2, 3]) {
      player.bakugan.forEach((bakugan, index) => { bakugan.open = index < openCount; });
      const amounts: number[] = [];
      executeRuleProgram(program, {
        conditionIsActive: (instruction) => ruleConditionActive(state, player, instruction.condition),
        beforeInstruction: () => "continue",
        execute: (action) => {
          if (action.kind === "modify-stat" && action.stat === expected.stat) amounts.push(action.amount);
        },
      });
      assert.deepEqual(
        amounts,
        openCount === 1 ? [expected.amount] : [],
        `${card.name} with ${openCount} open Bakugan`,
      );
    }
  }
});

test("rule objects are serializable resumable objects with stable definition identity", () => {
  const state = match();
  const card = CARDS.find((candidate) => candidate.number === 2)!;
  const ability = ruleDefinitionForCard(card).abilities.find((candidate) => candidate.kind === "spell")!;
  const object = createRuleObject({ controllerId: state.players[0].id, card, ability });
  const roundTrip = JSON.parse(JSON.stringify(object));
  assert.equal(roundTrip.rulesObjectVersion, 3);
  assert.equal(roundTrip.definitionId, "bb-2");
  assert.deepEqual(roundTrip.cursor, { instructionIndex: 0, effectIndex: 0 });
  assert.equal(roundTrip.status, "pending");
});

test("continuous layers apply ShadowStrike as negative-modifier filtering", () => {
  const state = match();
  const player = state.players[0];
  const bakugan = player.bakugan[0];
  const printed = bakugan.character.bPower ?? bakugan.bPower;
  const hostileCore: Core = { ...player.cores[0], id: "shadow-negative-core", catalogId: "test-core", bonus: -500, damageBonus: -3, shadowStrike: true };
  state.placements = [{ playerId: player.id, core: hostileCore, cell: "h3-3", order: 1, attachedTo: bakugan.id }];
  bakugan.heldCoreCells = ["h3-3"];
  const evaluated = evaluateBakuganCharacteristics(state, bakugan, player);
  assert.equal(evaluated.power, printed);
  assert.ok(evaluated.shadowStrike);
  assert.ok(evaluated.prevented.some((entry) => entry.amount === -500));
});

test("typed cost reductions scale Everett Ray and active Hero reducers without discounting themselves", () => {
  const state = match();
  const player = state.players[0];
  const everett = CARDS.find((card) => card.catalogId === "bb-188")!;
  const everettReduction = ruleDefinitionForCard(everett).play.costModifiers.find((modifier) => modifier.kind === "cost-reduce");
  assert.deepEqual(everettReduction, {
    kind: "cost-reduce",
    amount: { kind: "product", factors: [2, { kind: "count", source: "cards-played", owner: "controller" }] },
    duration: "instant",
    condition: { kind: "always" },
    appliesTo: "self",
  });

  for (const [cardsPlayed, expected] of [[0, 6], [1, 4], [2, 2], [3, 0]] as const) {
    player.cardsPlayedThisTurn = cardsPlayed;
    assert.equal(cardCostBreakdown(state, player.id, everett).total, expected);
  }

  const shun = CARDS.find((card) => card.catalogId === "bb-191")!;
  const lightning = CARDS.find((card) => card.catalogId === "bb-198")!;
  const strata = CARDS.find((card) => card.catalogId === "br-80")!;
  assert.equal(cardCostBreakdown(state, player.id, shun).total, 2);
  assert.equal(cardCostBreakdown(state, player.id, lightning).total, 2);
  assert.equal(cardCostBreakdown(state, player.id, strata).total, 3);

  player.heroes = [{ ...shun, id: "active-shun" }, { ...lightning, id: "active-lightning" }, { ...strata, id: "active-strata" }];
  const evo = CARDS.find((card) => card.type === "Evo" && card.cost !== "X" && !/cost/i.test(card.effect))!;
  const flip = CARDS.find((card) => card.type === "Flip" && card.cost !== "X" && !/cost/i.test(card.effect))!;
  const hero = CARDS.find((card) => card.type === "Hero" && card.cost !== "X" && !/cost/i.test(card.effect))!;
  assert.equal(cardCostBreakdown(state, player.id, evo).reductions, 1);
  assert.equal(cardCostBreakdown(state, player.id, flip).reductions, 1);
  assert.equal(cardCostBreakdown(state, player.id, hero).reductions, 2);
});

test("source-bound stat modifiers are parsed per symbol and derived exactly once from active cards", () => {
  const state = match();
  const player = state.players[0];
  const bakugan = player.bakugan[0];
  const base = { power: bakugan.character.bPower ?? bakugan.bPower, damage: bakugan.character.damage ?? bakugan.damage };
  const lightning = CARDS.find((card) => card.catalogId === "aa-70")!;
  const effects = ruleDefinitionForCard(lightning).abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects);
  assert.deepEqual(effects.filter((effect) => effect.kind === "modify-stat").map((effect) => [effect.stat, effect.amount, effect.duration]), [
    ["power", 100, "while-source-active"], ["damage", 1, "while-source-active"],
  ]);
  assert.equal(effects.some((effect) => effect.kind === "continuous"), false);

  player.heroes = [{ ...lightning, id: "lightning-one" }];
  let evaluated = evaluateBakuganCharacteristics(state, bakugan, player);
  assert.deepEqual({ power: evaluated.power, damage: evaluated.damage }, { power: base.power + 100, damage: base.damage + 1 });
  assert.deepEqual(evaluated.applied.filter((entry) => entry.sourceId === "lightning-one").map((entry) => [entry.stat, entry.amount]), [["power", 100], ["damage", 1]]);

  player.heroes.push({ ...lightning, id: "lightning-two" });
  evaluated = evaluateBakuganCharacteristics(state, bakugan, player);
  assert.deepEqual({ power: evaluated.power, damage: evaluated.damage }, { power: base.power + 200, damage: base.damage + 2 });

  ensureRulesState(state).modifiers.push({
    id: "legacy-lightning-duplicate", source: { kind: "card", instanceId: "lightning-one", catalogId: lightning.catalogId as `bb-${number}` },
    controllerId: player.id, target: "all-friendly", stat: "damage", amount: 100, layer: "continuous",
    duration: "while-source-active", createdTurn: state.turn,
  });
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).damage, base.damage + 2);
  player.heroes = [];
  evaluated = evaluateBakuganCharacteristics(state, bakugan, player);
  assert.deepEqual({ power: evaluated.power, damage: evaluated.damage }, base);
});

test("source-bound parsing keeps unrelated cost scaling off Everett and evaluates real scaling dynamically", () => {
  const state = match();
  const player = state.players[0];
  const bakugan = player.bakugan[0];
  const basePower = bakugan.character.bPower ?? bakugan.bPower;
  const baseDamage = bakugan.character.damage ?? bakugan.damage;
  const everett = CARDS.find((card) => card.catalogId === "bb-188")!;
  const everettPower = ruleDefinitionForCard(everett).abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects).find((effect) => effect.kind === "modify-stat" && effect.stat === "power");
  assert.ok(everettPower && !everettPower.scale);
  player.cardsPlayedThisTurn = 4;
  player.heroes = [{ ...everett, id: "everett-active" }];
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).power, basePower + 200);

  const wynton = CARDS.find((card) => card.catalogId === "aa-75")!;
  player.heroes = [{ ...wynton, id: "wynton-active" }];
  setPhysicalEnergy(player, 6);
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).damage, baseDamage + 6);
  setPhysicalEnergy(player, 9);
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).damage, baseDamage + 9);
});

test("triggered open bonuses are not treated as continuous active-card modifiers", () => {
  const state = match();
  const player = state.players[0];
  const bakugan = player.bakugan[0];
  const baseDamage = bakugan.character.damage ?? bakugan.damage;
  const triggeredLightning = CARDS.find((card) => card.catalogId === "br-78")!;
  player.heroes = [{ ...triggeredLightning, id: "triggered-lightning-active" }];
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).damage, baseDamage);

  const dan = CARDS.find((card) => card.catalogId === "br-81")!;
  player.heroes = [{ ...dan, id: "double-strike-dan" }];
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).doubleStrike, true);
  player.heroes = [];
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).doubleStrike, false);
});

test("active FrostStrike from the layered modifier system increases Flip costs", () => {
  const state = match();
  const attacker = state.players[0];
  const defender = state.players[1];
  const attackerBakugan = attacker.bakugan[0];
  state.damageOrigin = attackerBakugan.id;
  ensureRulesState(state).modifiers.push({
    id: "test-frost",
    source: { kind: "bakugan", id: attackerBakugan.id, characterCatalogId: attackerBakugan.character.catalogId as `bb-${number}` },
    controllerId: attacker.id,
    target: "active-friendly",
    targetBakuganId: attackerBakugan.id,
    keyword: "FrostStrike",
    amount: 3,
    layer: "temporary",
    duration: "turn",
    createdTurn: state.turn,
  });
  const flip = CARDS.find((card) => card.type === "Flip" && typeof card.cost === "number")!;
  const cost = cardCostBreakdown(state, defender.id, flip);
  assert.equal(cost.frostStrike, 3);
  assert.equal(cost.total, Number(flip.cost) + 3);
});

test("opponent-caused declarative triggers create typed rule objects", () => {
  const state = match();
  const bill = { ...CARDS.find((card) => card.name === "Bill Kouzo")!, id: "bill-in-play" };
  state.players[0].heroes.push(bill);
  const flip = CARDS.find((card) => card.type === "Flip")!;
  emitRuleEvent(state, { id: "opponent-flip", name: "CARD_PLAYED", actorId: state.players[1].id, controllerId: state.players[1].id, card: flip, cardType: "Flip", createdAt: Date.now() });
  assert.ok(state.batch.some((object) => object.card.id === bill.id && object.kind === "trigger"));
});

test("choice timing is explicit for announce, pay, and resolve", () => {
  const state = match();
  const absorb = CARDS.find((card) => card.number === 1)!;
  const absorbDefinition = ruleDefinitionForCard(absorb);
  assert.ok(absorbDefinition.play.choices.some((choice) => choice.timing === "announce" && choice.selector === "batch-object"));
  const sacrifice = ruleDefinitionForCard(CARDS.find((card) => card.number === 32)!);
  assert.ok(sacrifice.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.choices).some((choice) => choice.id === "discardCardIds" && choice.timing === "resolve"));
  const pact = ruleDefinitionForCard(CARDS.find((card) => card.catalogId === "bb-152")!);
  const sacrificeRoute = pact.play.costModifiers.find((effect) => effect.kind === "cost-alternative");
  assert.ok(sacrificeRoute?.components.some((component) => component.kind === "cost-discard" && component.choiceId === "discardCardIds"));
  const schema = buildChoiceSchemaFromSpecs(state, state.players[0].id, absorb, absorbDefinition.play.choices, "announce");
  assert.equal(schema.fields[0]?.id, "targetEffectId");
});

test("trigger resolution never infers announce timing from full printed card text", () => {
  const state = match();
  const affected: string[] = [];
  for (const card of CARDS) {
    for (const ability of ruleDefinitionForCard(card).abilities.filter((candidate) => candidate.kind === "triggered")) {
      const sourceText = ability.instructions.map((instruction) => instruction.sourceText).join(" ").trim();
      const expectedIds = ability.instructions
        .flatMap((instruction) => instruction.choices)
        .filter((choice) => choice.timing === "resolve")
        .map((choice) => choice.id);
      if (!expectedIds.length || sourceText !== card.effect) continue;
      affected.push(card.catalogId);
      const schema = buildChoiceSchema(state, state.players[0].id, card, sourceText, {}, "resolve");
      assert.deepEqual(
        [...new Set(schema.fields.map((field) => field.id))],
        [...new Set(expectedIds)],
        `${card.catalogId} ${card.name} must retain every resolution-time field`,
      );
    }
  }
  assert.ok(affected.includes("bb-207"));
  assert.ok(affected.length >= 10, "the catalogue must exercise the shared full-text trigger path");
});

test("Dan Kouzo's real open trigger pauses for the manual reveal before playing the top card", () => {
  let state = match();
  const player = state.players[0];
  const dan = { ...CARDS.find((card) => card.catalogId === "bb-207")!, id: "dan-manual-reveal" };
  const top = { ...CARDS.find((card) => card.type === "Action" && ruleDefinitionForCard(card).play.choices.length === 0)!, id: "dan-revealed-action" };
  player.heroes = [dan];
  player.deckCards = [top, ...player.deckCards];
  player.deck = player.deckCards.length;

  emitGameEvent(state, {
    id: "dan-manual-reveal-open",
    type: "open",
    playerId: player.id,
    targetBakuganId: player.bakugan[0].id,
  });
  state = passPriority(state, state.priority);
  state = passPriority(state, state.priority);

  assert.equal(state.players[0].revealedDeckCardId, top.id);
  assert.deepEqual(
    state.pendingChoice?.schema.fields.map((field) => field.id),
    ["orderedCardIds", "confirmed"],
  );
  assert.ok(state.batch.some((object) => object.card.id === dan.id));
  assert.equal(state.batch.some((object) => object.card.id === top.id), false);

  const skipped = submitCardChoice(state, player.id, { confirmed: false });
  assert.equal(skipped.pendingChoice, undefined);
  assert.equal(skipped.players[0].deckCards[0].id, top.id);
  assert.equal(skipped.batch.some((object) => object.card.id === top.id), false);

  const played = submitCardChoice(state, player.id, {
    orderedCardIds: [top.id],
    confirmed: true,
  });
  assert.equal(played.pendingChoice, undefined);
  assert.equal(played.players[0].deckCards.some((card) => card.id === top.id), false);
  assert.ok(played.batch.some((object) => object.card.id === top.id));
});

test("additional costs are separate from spell effects", () => {
  const definition = ruleDefinitionForCard(CARDS.find((card) => card.number === 152)!);
  const alternative = definition.play.costModifiers.find((effect) => effect.kind === "cost-alternative");
  assert.ok(alternative);
  assert.ok(alternative.components.some((effect) => effect.kind === "cost-discard"));
  assert.equal(definition.play.costModifiers.some((effect) => effect.kind === "cost-discard"), false);
  assert.ok(definition.abilities.flatMap((ability) => ability.instructions).flatMap((instruction) => instruction.effects).every((effect) => effect.kind !== "discard"));
});

test("Evo targeting uses canonical Character identity rather than display names", () => {
  const evo = CARDS.find((card) => card.type === "Evo")!;
  const definition = ruleDefinitionForCard(evo);
  assert.equal(definition.play.evolvesFrom.length, 1);
  const state = match();
  const canonical = state.players.flatMap((player) => player.bakugan).find((bakugan) => definition.play.evolvesFrom.includes(bakugan.character.catalogId as `bb-${number}`));
  if (canonical) assert.equal(canonicalEvoTargetAllowed(definition, canonical), true);
  const wrong = structuredClone(state.players[0].bakugan[0]);
  wrong.name = evo.evolvesFrom ?? wrong.name;
  wrong.faction = evo.faction;
  wrong.character = { ...wrong.character, catalogId: definition.play.evolvesFrom[0] === "bb-1" ? "bb-2" : "bb-1" };
  assert.equal(canonicalEvoTargetAllowed(definition, wrong), false);
});

test("the game reducer has no card-resolution compatibility adapter", async () => {
  const [reducer, pipeline, effects] = await Promise.all([
    readFile(new URL("../lib/engine/reducer.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/engine/play-pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/rules/effects.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(reducer, /executePlayPipeline|playCardWithAutoEnergy|resolveManualDamage|submitCardChoice\(/);
  assert.doesNotMatch(pipeline, /executePlayPipeline|Compatibility play pipeline|legacy card resolver/i);
  assert.doesNotMatch(effects, /matchAll\(|compileClause\(|conditionFor\(/);
});

test("Character and Evo held-Core bonuses are active only for their printed Core types", () => {
  const state = match();
  const player = state.players[0];
  const bakugan = player.bakugan[0];
  const cubbo = CARDS.find((card) => card.catalogId === "br-167")!;
  const turtonium = CARDS.find((card) => card.catalogId === "br-178")!;
  assert.ok(cubbo && turtonium);

  assert.deepEqual(conditionFor("[MS] or [FF]: +600 [B]."), {
    kind: "held-core-type",
    coreTypes: ["Magic Shield", "Flaming Fist"],
    subject: "target",
  });
  assert.deepEqual(conditionFor("[HE]: +100 [B] and +3 [Damage Rating]."), {
    kind: "held-core-type",
    coreTypes: ["Helix"],
    subject: "target",
  });
  for (const [symbol, type] of [
    ["FT", "Fist"],
    ["FF", "Flaming Fist"],
    ["SD", "Shield"],
    ["MS", "Magic Shield"],
    ["HE", "Helix"],
  ] as const) {
    assert.deepEqual(conditionFor(`[${symbol}]: +100 [B].`), {
      kind: "held-core-type",
      coreTypes: [type],
      subject: "target",
    });
  }

  const hold = (type: Core["type"]) => {
    const heldCore: Core = {
      id: `held-${type}`,
      catalogId: `held-${type}`,
      number: 999,
      name: type,
      type,
      bonus: 0,
      damageBonus: 0,
      art: "",
    };
    state.placements = [{
      playerId: player.id,
      core: heldCore,
      cell: "held-core-cell",
      order: 1,
      attachedTo: bakugan.id,
    }];
    bakugan.heldCoreCells = ["held-core-cell"];
  };

  bakugan.character = { ...cubbo, id: "aquos-cubbo" };
  bakugan.evoStack = [];
  bakugan.faction = "Aquos";
  bakugan.open = true;
  bakugan.heldCoreCells = [];
  state.placements = [];
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).power, 100);

  hold("Shield");
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).power, 100);
  hold("Magic Shield");
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).power, 700);
  hold("Flaming Fist");
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).power, 700);

  bakugan.character = { ...turtonium, id: "aquos-turtonium-ultra" };
  bakugan.heldCoreCells = [];
  state.placements = [];
  assert.deepEqual(
    (({ power, damage }) => ({ power, damage }))(evaluateBakuganCharacteristics(state, bakugan, player)),
    { power: 500, damage: 2 },
  );
  hold("Helix");
  assert.deepEqual(
    (({ power, damage }) => ({ power, damage }))(evaluateBakuganCharacteristics(state, bakugan, player)),
    { power: 600, damage: 5 },
  );
  hold("Fist");
  assert.deepEqual(
    (({ power, damage }) => ({ power, damage }))(evaluateBakuganCharacteristics(state, bakugan, player)),
    { power: 500, damage: 2 },
  );
});

test("EX Dragonoid Maximus compiles a named-control alternate win condition", () => {
  const maximus = CARDS.find((card) => card.catalogId === "ex-2");
  assert.ok(maximus);
  assert.deepEqual(
    conditionFor(maximus.effect),
    { kind: "controls-named-cards", names: ["Dan", "Wynton", "Lia"] },
  );
  assert.deepEqual(
    parseAtomicEffects(maximus, maximus.effect),
    [{ kind: "win-game", reason: "Dragonoid Maximus's alternate win condition" }],
  );
});

test("Groups 11-15 compile shared state, modal, zone, reveal, and interception primitives", () => {
  const definition = (catalogId: string) => {
    const source = CARDS.find((card) => card.catalogId === catalogId);
    assert.ok(source, `missing ${catalogId}`);
    return ruleDefinitionForCard(source);
  };
  const instructions = (catalogId: string) => definition(catalogId).abilities.flatMap((ability) => ability.instructions);

  assert.deepEqual(
    instructions("aa-40").find((instruction) => instruction.condition.kind === "card-type-played")?.condition,
    { kind: "card-type-played", cardType: "Flip", owner: "opponent" },
  );
  assert.equal(instructions("aa-109")[0].condition.kind, "expression");
  assert.equal(definition("aa-152").abilities.find((ability) => ability.kind === "triggered")?.trigger?.minimumPrintedCost, 5);
  assert.match(definition("aa-208").sourceText, /no cards in hand/i);

  for (const catalogId of ["aa-12", "bb-115", "br-106"]) {
    const modes = instructions(catalogId).flatMap((instruction) => instruction.choices).filter((choice) => choice.id === "mode");
    assert.ok(modes.some((choice) => choice.options?.length === 2), `${catalogId} must expose two exclusive modes`);
  }
  const endless = instructions("bb-115").filter((instruction) => instruction.condition.kind === "mode-selected");
  assert.equal(endless.length, 2);
  assert.ok(endless.every((instruction) => instruction.effects.length === 1));

  assert.equal(instructions("br-50")[0].effects.some((effect) => effect.kind === "energize" && effect.source === "discard"), true);
  assert.equal(instructions("br-120").flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "discard" && effect.amount === 99), true);
  assert.equal(instructions("br-164").flatMap((instruction) => instruction.choices).some((choice) => choice.id === "handCardIds" && choice.maximum === 99), true);
  const keepEnergy = instructions("aa-101").flatMap((instruction) => instruction.choices).find((choice) => choice.id === "targetEnergyIds");
  assert.equal(keepEnergy?.chooser, "each-player");
  assert.equal(keepEnergy?.onlyIfAvailableMoreThan, 3);

  for (const catalogId of ["br-19", "br-65"]) {
    const viewer = instructions(catalogId).flatMap((instruction) => instruction.choices).find((choice) => choice.viewerOnly);
    assert.equal(viewer?.owner, "opponent");
    assert.equal(viewer?.minimum, 0);
    assert.equal(viewer?.maximum, 0);
  }
  const shun = instructions("aa-67");
  assert.ok(shun.flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "reveal" && effect.sourceOwner === "opponent"));
  assert.ok(shun.flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "copy" && effect.target === "revealed-action"));

  const cubbo = instructions("aa-59");
  assert.ok(cubbo.flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "play" && !effect.free && effect.cardType === "Hero" && effect.maximumCost === 6));
  const toshi = definition("bb-193").abilities.find((ability) => ability.trigger?.limit?.kind === "first-each-turn");
  assert.equal(toshi?.trigger?.cardType, "Action");
  assert.ok(toshi?.instructions.flatMap((instruction) => instruction.effects).some((effect) => effect.kind === "copy" && effect.target === "played-action"));
  assert.equal(definition("aa-68").abilities.find((ability) => ability.kind === "triggered")?.trigger?.cardMechanic, "Battle Mastery");
});

test("same-turn Flip promises trigger after their Action has resolved", () => {
  const state = match();
  const player = state.players[0];
  const opponent = state.players[1];
  const regrowth = { ...CARDS.find((card) => card.catalogId === "aa-44")!, id: "regrowth-promise" };
  const ability = ruleDefinitionForCard(regrowth).abilities.find((candidate) => candidate.kind === "spell")!;

  const armed = resolveStructuredEffect(state, createRuleObject({
    controllerId: player.id,
    cardOwnerId: player.id,
    card: regrowth,
    ability,
    kind: "card",
  }));
  assert.equal(ensureRulesState(armed).delayedCardTriggers.length, 1);
  assert.ok(armed.players[0].discard.some((card) => card.id === regrowth.id));

  const flip = { ...CARDS.find((card) => card.type === "Flip")!, id: "later-opponent-flip" };
  recordCardPlayedForTurn(armed.players[1], flip, armed.turn);
  const triggers = emitRuleEvent(armed, {
    id: "later-opponent-flip-event",
    name: "CARD_PLAYED",
    actorId: opponent.id,
    controllerId: opponent.id,
    card: flip,
    cardType: "Flip",
    createdAt: 10,
  });
  const promise = triggers.find((object) => object.card.id === regrowth.id);
  assert.ok(promise);
  assert.equal(promise.effect, "If your opponent plays a Flip card this turn, return this to your hand.");
  assert.equal(ensureRulesState(armed).delayedCardTriggers.length, 0);

  const returned = resolveStructuredEffect(armed, promise);
  assert.ok(returned.players[0].hand.some((card) => card.id === regrowth.id));
  assert.equal(returned.players[0].discard.some((card) => card.id === regrowth.id), false);
});

test("Groups 16-20 compile delayed, global, identity, relative, granted, and face-down primitives", () => {
  const definition = (catalogId: string) => ruleDefinitionForCard(CARDS.find((card) => card.catalogId === catalogId)!);
  const effects = (catalogId: string) => definition(catalogId).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects);

  const powerRoll = effects("aa-52").find((effect) => effect.kind === "schedule");
  assert.equal(powerRoll?.timing, "after-attack");
  assert.ok(powerRoll?.effects.some((effect) => effect.kind === "move" && effect.verb === "retract" && effect.amount === 99));

  const gorthion = effects("br-130").find((effect) => effect.kind === "move" && effect.object === "evo");
  assert.equal(gorthion?.playerScope, "all-players");
  assert.equal(gorthion?.excludeSource, true);
  assert.deepEqual(effectiveCardFactions(CARDS.find((card) => card.catalogId === "br-104")!), [...ALL_FACTIONS]);

  const garganoidDraw = effects("br-140").find((effect) => effect.kind === "draw");
  assert.equal(typeof garganoidDraw?.amount === "object" ? garganoidDraw.amount.kind : undefined, "clamp");

  const vicerox = definition("aa-96");
  assert.equal(vicerox.play.choices.some((choice) => choice.id === "confirmed"), false);
  const staticAbility = vicerox.abilities.find((ability) => ability.kind === "spell")!;
  assert.deepEqual(staticAbility.instructions[0].effects.map((effect) => effect.kind), ["modify-stat", "modify-stat"]);
  const victorAbility = vicerox.abilities.find((ability) => ability.kind === "triggered")!;
  assert.equal(victorAbility.trigger?.interveningCondition?.kind, "expression");
  assert.deepEqual(victorAbility.instructions[0].effects.filter((effect) => effect.kind !== "trigger").map((effect) => effect.kind), ["draw"]);

  assert.ok(effects("br-47").some((effect) => effect.kind === "move"
    && effect.object === "bakucore" && effect.verb === "return"));
});

test("Power Roll schedules one deterministic all-Bakugan retraction after the attack", () => {
  const state = match();
  for (const player of state.players) for (const bakugan of player.bakugan) bakugan.open = true;
  const powerRoll = { ...CARDS.find((card) => card.catalogId === "aa-52")!, id: "power-roll-scheduled" };
  const ability = ruleDefinitionForCard(powerRoll).abilities.find((candidate) => candidate.kind === "spell")!;
  const armed = resolveStructuredEffect(state, createRuleObject({
    controllerId: state.players[0].id,
    cardOwnerId: state.players[0].id,
    card: powerRoll,
    ability,
    kind: "card",
  }));
  assert.equal(ensureRulesState(armed).scheduledActions.length, 1);
  assert.equal(armed.players.flatMap((player) => player.bakugan).every((bakugan) => bakugan.open), true);

  completeScheduledAttackActions(armed);
  assert.equal(ensureRulesState(armed).scheduledActions.length, 0);
  assert.equal(armed.players.flatMap((player) => player.bakugan).every((bakugan) => !bakugan.open), true);
});

test("Titan Gorthion Ultra destroys every other Evo across both players", () => {
  const state = match();
  const source = { ...CARDS.find((card) => card.catalogId === "br-130")!, id: "gorthion-source" };
  const friendlyOther = { ...CARDS.find((card) => card.type === "Evo" && card.catalogId !== "br-130")!, id: "friendly-other-evo" };
  const enemyOne = { ...friendlyOther, id: "enemy-evo-one" };
  const enemyTwo = { ...friendlyOther, id: "enemy-evo-two" };
  state.players[0].bakugan[0].evoStack = [source];
  state.players[0].bakugan[1].evoStack = [friendlyOther];
  state.players[1].bakugan[0].evoStack = [enemyOne];
  state.players[1].bakugan[1].evoStack = [enemyTwo];
  const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind === "triggered")!;
  const resolved = resolveStructuredEffect(state, createRuleObject({
    controllerId: state.players[0].id,
    cardOwnerId: state.players[0].id,
    card: source,
    ability,
    kind: "trigger",
    sourceId: source.id,
  }));

  assert.deepEqual(resolved.players[0].bakugan[0].evoStack.map((card) => card.id), [source.id]);
  assert.equal(resolved.players.flatMap((player) => player.bakugan).flatMap((bakugan) => bakugan.evoStack).length, 1);
  assert.deepEqual(
    new Set(resolved.players.flatMap((player) => player.discard).map((card) => card.id)),
    new Set([friendlyOther.id, enemyOne.id, enemyTwo.id]),
  );
});

test("all-Faction identity and Pandoxx virtual BakuCore membership are live derived characteristics", () => {
  const state = match();
  const player = state.players[0];
  const dragonoid = { ...CARDS.find((card) => card.catalogId === "br-104")!, id: "all-faction-dragonoid" };
  recordCardPlayedForTurn(player, dragonoid, state.turn);
  assert.deepEqual(new Set(player.factionsPlayedThisTurn), new Set(ALL_FACTIONS));

  const pandoxx = { ...CARDS.find((card) => card.catalogId === "aa-130")!, id: "pandoxx-virtual" };
  const sourceBakugan = player.bakugan[0];
  const otherBakugan = player.bakugan[1];
  sourceBakugan.evoStack = [pandoxx];
  const core = { ...player.cores.find((candidate) => candidate.bonus > 0)!, id: "pandoxx-shared-core" };
  state.placements = [{ playerId: player.id, core, cell: "pandoxx-cell", order: 1, attachedTo: otherBakugan.id, revealed: true }];
  otherBakugan.heldCoreCells = ["pandoxx-cell"];

  assert.deepEqual(effectiveBakucoreCells(state, sourceBakugan, player), ["pandoxx-cell"]);
  assert.deepEqual(otherBakugan.heldCoreCells, ["pandoxx-cell"]);
  assert.equal(
    evaluateBakuganCharacteristics(state, sourceBakugan, player).power,
    (pandoxx.bPower ?? sourceBakugan.bPower) + core.bonus + (core.conditionalFactions?.includes(pandoxx.faction) ? core.conditionalBonus ?? 0 : 0),
  );
});

test("Hyper Garganoid draws only the live hand-size deficit", () => {
  const state = match();
  const player = state.players[0];
  const opponent = state.players[1];
  const garganoid = { ...CARDS.find((card) => card.catalogId === "br-140")!, id: "garganoid-parity" };
  player.hand = [{ ...CARDS[0], id: "one-card" }];
  opponent.hand = Array.from({ length: 4 }, (_, index) => ({ ...CARDS[index + 1], id: `opponent-${index}` }));
  state.brawlWinner = player.id;
  const ability = ruleDefinitionForCard(garganoid).abilities.find((candidate) => candidate.kind === "triggered")!;
  const resolved = resolveStructuredEffect(state, createRuleObject({
    controllerId: player.id,
    card: garganoid,
    ability,
    kind: "trigger",
  }));
  const queue = (resolved as typeof resolved & { pendingDrawQueue?: Array<{ total: number }> }).pendingDrawQueue;
  assert.equal(queue?.[0]?.total, 3);

  const ahead = match();
  ahead.brawlWinner = ahead.players[0].id;
  ahead.players[0].hand = Array.from({ length: 4 }, (_, index) => ({ ...CARDS[index], id: `ahead-${index}` }));
  ahead.players[1].hand = [{ ...CARDS[5], id: "behind" }];
  const clamped = resolveStructuredEffect(ahead, createRuleObject({
    controllerId: ahead.players[0].id,
    card: garganoid,
    ability,
    kind: "trigger",
  }));
  assert.equal((clamped as typeof clamped & { pendingDrawQueue?: unknown[] }).pendingDrawQueue, undefined);
});

test("Hyper Vicerox gains stats and its Victor draw only after three played Factions", () => {
  const state = match();
  const player = state.players[0];
  const vicerox = { ...CARDS.find((card) => card.catalogId === "aa-96")!, id: "vicerox-granted-victor" };
  player.bakugan[0].evoStack = [vicerox];
  player.factionsPlayedThisTurn = ["Aquos", "Pyrus"];
  assert.equal(evaluateBakuganCharacteristics(state, player.bakugan[0], player).power, vicerox.bPower);

  player.factionsPlayedThisTurn.push("Haos");
  const enhanced = evaluateBakuganCharacteristics(state, player.bakugan[0], player);
  assert.equal(enhanced.power, (vicerox.bPower ?? 0) + 300);
  assert.equal(enhanced.damage, (vicerox.damage ?? 0) + 3);
  state.brawlWinner = player.id;
  const triggers = emitRuleEvent(state, {
    id: "vicerox-qualified-victor",
    name: "VICTOR_DECLARED",
    actorId: player.id,
    controllerId: player.id,
    targetBakuganId: player.bakugan[0].id,
    createdAt: 11,
  });
  const trigger = triggers.find((object) => object.card.id === vicerox.id);
  assert.ok(trigger);
  assert.equal(trigger.effect, "Victor: You may draw 3 cards.");
});

test("Twisting Inferno returns the chosen physical BakuCore face down through normal placement", () => {
  const state = match();
  const controller = state.players[0];
  const opponent = state.players[1];
  const twisting = { ...CARDS.find((card) => card.catalogId === "br-47")!, id: "twisting-inferno" };
  const enemyCore = { ...opponent.cores[0], id: "twisting-enemy-core" };
  const friendlyFist = { ...controller.cores.find((core) => core.type === "Fist")!, id: "twisting-friendly-fist" };
  state.placements = [
    { playerId: opponent.id, core: enemyCore, cell: "enemy-core-cell", order: 1, attachedTo: opponent.bakugan[0].id, revealed: true },
    { playerId: controller.id, core: friendlyFist, cell: "friendly-fist-cell", order: 2, attachedTo: controller.bakugan[0].id, revealed: true },
  ];
  opponent.bakugan[0].heldCoreCells = ["enemy-core-cell"];
  controller.bakugan[0].heldCoreCells = ["friendly-fist-cell"];
  const ability = ruleDefinitionForCard(twisting).abilities.find((candidate) => candidate.kind === "spell")!;
  const object = createRuleObject({
    controllerId: controller.id,
    cardOwnerId: controller.id,
    card: twisting,
    ability,
    kind: "card",
    choices: { coreCell: "enemy-core-cell" },
  });
  object.resolvedChoices = { "0": { coreCell: "enemy-core-cell" } };
  const resolved = resolveStructuredEffect(state, object);
  const returnedPlacement = resolved.placements.find((placement) => placement.core.id === enemyCore.id);
  assert.equal(returnedPlacement?.attachedTo, undefined);
  assert.equal(returnedPlacement?.revealed, false);
  assert.equal(resolved.players[1].bakugan[0].heldCoreCells.includes("enemy-core-cell"), false);
  assert.equal((resolved as typeof resolved & { pendingDrawQueue?: Array<{ total: number }> }).pendingDrawQueue?.[0]?.total, 1);

  const placementState = captureCoreReturns(state, resolved);
  assert.equal(placementState.phase, "retract");
  assert.equal(pendingCoreReturnsForPlayer(placementState, opponent.id)[0]?.core.id, enemyCore.id);
  assert.equal(placementState.placements.some((placement) => placement.core.id === enemyCore.id), false);
});

test("Titan Nobilious requests secret keep-three answers only from players above three Energy", () => {
  const state = match();
  const source = CARDS.find((card) => card.catalogId === "aa-101")!;
  const instruction = ruleDefinitionForCard(source).abilities
    .flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.choices.some((choice) => choice.id === "targetEnergyIds"))!;
  state.players[0].energyZone = Array.from({ length: 5 }, (_, index) => ({ ...CARDS[0], id: `first-energy-${index}` }));
  state.players[1].energyZone = Array.from({ length: 3 }, (_, index) => ({ ...CARDS[0], id: `second-energy-${index}` }));
  const schema = buildChoiceSchemaFromSpecs(state, state.players[0].id, source, instruction.choices, "resolve");
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0].chooserId, state.players[0].id);
  assert.equal(schema.fields[0].visibility, "secret-until-reveal");
  assert.equal(schema.fields[0].minimum, 3);
  assert.equal(schema.fields[0].maximum, 3);

  const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind === "triggered")!;
  let resolved = resolveStructuredEffect(state, createRuleObject({ controllerId: state.players[0].id, card: source, ability, kind: "trigger" }));
  const keepIds = state.players[0].energyZone.slice(0, 3).map((card) => card.id);
  resolved = submitCardChoice(resolved, state.players[0].id, { targetEnergyIds: keepIds });
  assert.deepEqual(resolved.players[0].energyZone.map((card) => card.id), keepIds);
  assert.equal(resolved.players[0].discard.length, 2);
  assert.equal(resolved.players[1].energyZone.length, 3);
});

test("zone-wide Energize and first-Action triggers execute through generic runtime paths", () => {
  const state = match();
  const player = state.players[0];
  const hugeKnowledge = CARDS.find((card) => card.catalogId === "br-50")!;
  const discarded = [
    { ...CARDS[0], id: "discard-energy-a" },
    { ...CARDS[1], id: "discard-energy-b" },
  ];
  player.discard = discarded;
  const hugeAbility = ruleDefinitionForCard(hugeKnowledge).abilities.find((ability) => ability.kind === "spell")!;
  const energized = resolveStructuredEffect(state, createRuleObject({ controllerId: player.id, card: hugeKnowledge, ability: hugeAbility, kind: "card" }));
  assert.deepEqual(energized.players[0].discard.map((card) => card.catalogId), ["br-50"]);
  assert.deepEqual(new Set(energized.players[0].energyZone.map((card) => card.id)), new Set(discarded.map((card) => card.id)));

  const triggerState = match();
  const triggerPlayer = triggerState.players[0];
  const toshi = { ...CARDS.find((card) => card.catalogId === "bb-193")!, id: "toshi-live" };
  triggerPlayer.heroes = [toshi];
  const firstAction = { ...CARDS.find((card) => card.type === "Action")!, id: "first-action" };
  recordCardPlayedForTurn(triggerPlayer, firstAction, triggerState.turn);
  let triggers = emitRuleEvent(triggerState, { id: "first-action-event", name: "CARD_PLAYED", actorId: triggerPlayer.id, controllerId: triggerPlayer.id, card: firstAction, cardType: "Action", createdAt: 1 });
  assert.ok(triggers.some((object) => object.card.id === toshi.id && object.choices.eventCardId === firstAction.id));
  triggerState.batch = [];
  const secondAction = { ...firstAction, id: "second-action" };
  recordCardPlayedForTurn(triggerPlayer, secondAction, triggerState.turn);
  triggers = emitRuleEvent(triggerState, { id: "second-action-event", name: "CARD_PLAYED", actorId: triggerPlayer.id, controllerId: triggerPlayer.id, card: secondAction, cardType: "Action", createdAt: 2 });
  assert.equal(triggers.some((object) => object.card.id === toshi.id), false);
});

test("continuous hand-size and printed-play filters re-evaluate from authoritative state", () => {
  const state = match();
  const player = state.players[0];
  const opponent = state.players[1];
  const skorporos = { ...CARDS.find((card) => card.catalogId === "aa-109")!, id: "skorporos-live" };
  player.bakugan[0].evoStack = [skorporos];
  const baseDamage = skorporos.damage!;
  opponent.hand = [{ ...CARDS[0], id: "opponent-hand-card" }];
  assert.equal(evaluateBakuganCharacteristics(state, player.bakugan[0], player).damage, baseDamage);
  opponent.hand = [];
  assert.equal(evaluateBakuganCharacteristics(state, player.bakugan[0], player).damage, baseDamage + 10);

  const lupitheon = { ...CARDS.find((card) => card.catalogId === "aa-152")!, id: "lupitheon-live" };
  player.bakugan[0].evoStack = [lupitheon];
  const low = { ...CARDS.find((card) => card.type === "Action" && card.cost !== "X")!, id: "low-card", cost: 4 as const };
  let triggers = emitRuleEvent(state, { id: "printed-cost-four", name: "CARD_PLAYED", actorId: player.id, controllerId: player.id, card: low, cardType: low.type, createdAt: 3 });
  assert.equal(triggers.some((object) => object.card.id === lupitheon.id), false);
  const high = { ...low, id: "printed-cost-five", cost: 5 as const };
  triggers = emitRuleEvent(state, { id: "printed-cost-five", name: "CARD_PLAYED", actorId: player.id, controllerId: player.id, card: high, cardType: high.type, createdAt: 4 });
  assert.equal(triggers.some((object) => object.card.id === lupitheon.id), true);

  player.bakugan[0].evoStack = [];
  const magnus = { ...CARDS.find((card) => card.catalogId === "aa-68")!, id: "magnus-live-filter" };
  player.heroes = [magnus];
  triggers = emitRuleEvent(state, { id: "ordinary-play", name: "CARD_PLAYED", actorId: player.id, controllerId: player.id, card: high, cardType: high.type, createdAt: 5 });
  assert.equal(triggers.some((object) => object.card.id === magnus.id), false);
  const mastery = { ...CARDS.find((card) => card.catalogId === "aa-12")!, id: "mastery-play" };
  triggers = emitRuleEvent(state, { id: "mastery-play", name: "CARD_PLAYED", actorId: player.id, controllerId: player.id, card: mastery, cardType: mastery.type, createdAt: 6 });
  assert.equal(triggers.some((object) => object.card.id === magnus.id), true);
});
