import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  emitGameEvent,
  passPriority,
  recordCardPlayedForTurn,
  submitCardChoice,
  type Core,
} from "../lib/game";
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
    kind: "factions-played",
    comparison: "at-least",
    amount: 3,
  });
  assert.deepEqual(conditionFor("If you have ten or more Energy cards in play, +15 [Damage Rating] instead."), {
    kind: "energy-count",
    comparison: "at-least",
    amount: 10,
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

test("open Bakugan count parser preserves exact and threshold comparisons", () => {
  assert.deepEqual(conditionFor("If you only have one open Bakugan."), { kind: "open-bakugan-count", comparison: "exactly", amount: 1 });
  assert.deepEqual(conditionFor("If you have only two open Bakugan."), { kind: "open-bakugan-count", comparison: "exactly", amount: 2 });
  assert.deepEqual(conditionFor("If you have three or more open Bakugan."), { kind: "open-bakugan-count", comparison: "at-least", amount: 3 });
  assert.deepEqual(conditionFor("If you have at most two open Bakugan."), { kind: "open-bakugan-count", comparison: "at-most", amount: 2 });
  assert.deepEqual(conditionFor("If you have more than one open Bakugan."), { kind: "open-bakugan-count", comparison: "more-than", amount: 1 });
  assert.deepEqual(conditionFor("If you have fewer than three open Bakugan."), { kind: "open-bakugan-count", comparison: "fewer-than", amount: 3 });
  assert.deepEqual(conditionFor("If you have no open Bakugan."), { kind: "open-bakugan-count", comparison: "exactly", amount: 0 });
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
      kind: "open-bakugan-count",
      comparison: "exactly",
      amount: 1,
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
    amount: 2,
    duration: "instant",
    condition: { kind: "always" },
    appliesTo: "self",
    scale: "cards-played-this-turn",
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
  player.maxEnergy = 6;
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, player).damage, baseDamage + 6);
  player.maxEnergy = 9;
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
  const shadowTrap = ruleDefinitionForCard(CARDS.find((card) => card.number === 152)!);
  assert.ok(shadowTrap.play.choices.some((choice) => choice.id === "discardCardIds" && choice.timing === "pay"));
  const schema = buildChoiceSchemaFromSpecs(state, state.players[0].id, absorb, absorbDefinition.play.choices, "announce");
  assert.equal(schema.fields[0]?.id, "mode");
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
        schema.fields.map((field) => field.id),
        expectedIds,
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
  const top = { ...CARDS.find((card) => card.type === "Action")!, id: "dan-revealed-action" };
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
  assert.ok(definition.play.costModifiers.some((effect) => effect.kind === "cost-alternative"));
  assert.ok(definition.play.costModifiers.some((effect) => effect.kind === "cost-discard"));
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
  });
  assert.deepEqual(conditionFor("[HE]: +100 [B] and +3 [Damage Rating]."), {
    kind: "held-core-type",
    coreTypes: ["Helix"],
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
