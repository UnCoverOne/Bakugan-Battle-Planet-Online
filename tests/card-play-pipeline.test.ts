import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, resolveStructuredEffect, submitCardChoice } from "../lib/game";
import { resolveManualDamage } from "../lib/manualDamage";
import { cardCostBreakdown, cardPaymentModes } from "../lib/rules/costs";
import { createRuleObject } from "../lib/rules/objects";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { compileCardEffect } from "../lib/rules/effects";
import type { RuleAction } from "../lib/rules/model";

function card(id: string, instance: string) {
  const template = CARD_BY_ID.get(id);
  assert.ok(template, `Missing ${id}`);
  return { ...structuredClone(template), id: instance };
}

function baseMatch(code = "PLAYPIPE") {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch(code, "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.priority = first.id;
  state.startingPlayer = first.id;
  return { state, first, second };
}

test("Pact of Darkness exposes an unaffordable Sacrifice route instead of allowing a late failed discard", () => {
  const { state, first, second } = baseMatch("PACTFROST");
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;
  const pact = card("bb-152", "pact-frost");
  const fodder = card("bb-1", "pact-fodder");
  first.hand = [fodder];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = [card("bb-1", "energy-a"), card("bb-1", "energy-b")];
  first.maxEnergy = 2;
  const attacker = second.bakugan[0];
  attacker.open = true;
  state.damageOrigin = attacker.id;
  state.frostStrike[attacker.id] = 3;
  state.revealedFlip = pact;

  const next = resolveManualDamage(state, first.id, pact.id);
  const payment = next.pendingChoice?.schema.fields.find((field) => field.id === "paymentMode");
  assert.ok(payment);
  const sacrifice = payment.options.find((option) => option.id.endsWith(":discard-for-free"));
  assert.equal(sacrifice?.disabled, true);
  assert.match(sacrifice?.description ?? "", /Not enough Energy.*3 required.*2 available/i);
  assert.throws(() => submitCardChoice(next, first.id, { paymentMode: sacrifice!.id }), /illegal selection/i);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === fodder.id), true);
});

test("Pact of Darkness Sacrifice is a generic atomic alternative cost and free base still pays FrostStrike", () => {
  const { state, first, second } = baseMatch("PACTLEGAL");
  state.phase = "damage";
  state.pendingLoser = first.id;
  state.pendingDamage = 2;
  state.priority = first.id;
  const pact = card("bb-152", "pact-legal");
  const fodder = card("bb-1", "pact-fodder-legal");
  first.hand = [fodder];
  first.discard = [pact];
  first.energy = 0;
  first.energyZone = [card("bb-1", "pe-a"), card("bb-1", "pe-b"), card("bb-1", "pe-c")];
  first.maxEnergy = 3;
  const attacker = second.bakugan[0];
  attacker.open = true;
  state.damageOrigin = attacker.id;
  state.frostStrike[attacker.id] = 3;
  state.revealedFlip = pact;

  let next = resolveManualDamage(state, first.id, pact.id);
  const payment = next.pendingChoice!.schema.fields.find((field) => field.id === "paymentMode")!;
  const sacrifice = payment.options.find((option) => option.id.endsWith(":discard-for-free"))!;
  assert.equal(sacrifice.disabled, false);
  next = submitCardChoice(next, first.id, { paymentMode: sacrifice.id });
  assert.equal(next.pendingChoice?.schema.fields[0]?.id, "discardCardIds");
  next = submitCardChoice(next, first.id, { discardCardIds: [fodder.id] });
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.players[0].energy, 0);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === fodder.id), false);
  assert.equal(next.players[0].discard.some((candidate) => candidate.id === fodder.id), true);
  assert.equal(next.batch.some((object) => object.card.id === pact.id && object.rulesObjectVersion === 3), true);
  assert.equal(next.revealedFlip, undefined);
});

test("conditional self-free cards expose normal and free payment routes", () => {
  const { state, first } = baseMatch("SELF_FREE");
  const fangzor = card("br-102", "fangzor-free");
  first.hand = [fangzor];
  first.discard = Array.from({ length: 20 }, (_, index) => card("bb-1", `discard-${index}`));
  const modes = cardPaymentModes(state, first.id, fangzor);
  const normal = modes.find((mode) => mode.id === "normal");
  const free = modes.find((mode) => mode.id === "br-102:self-free");
  assert.ok(normal && free);
  assert.equal(normal.freeBase, false);
  assert.equal(free.freeBase, true);
  assert.equal(free.energyCost, 0);
  const selected = cardCostBreakdown(state, first.id, fangzor, { paymentMode: free.id }, { selectedAlternativeId: free.id });
  assert.equal(selected.freeBase, true);
  assert.equal(selected.total, 0);
});

test("Sneak Attack stores a turn-scoped free Evo permission for both players", () => {
  const { state, first, second } = baseMatch("SNEAK_FREE");
  const sneak = card("br-10", "sneak-effect");
  const definition = ruleDefinitionForCard(sneak);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);
  state.batch = [createRuleObject({ controllerId: first.id, card: sneak, ability, kind: "card" })];
  let next = passPriority(state, first.id);
  next = passPriority(next, second.id);
  const firstEvo = card("br-102", "first-evo");
  const secondEvo = card("br-128", "second-evo");
  first.hand = [firstEvo];
  second.hand = [secondEvo];
  const liveFirst = next.players.find((player) => player.id === first.id)!;
  const liveSecond = next.players.find((player) => player.id === second.id)!;
  liveFirst.hand = [firstEvo];
  liveSecond.hand = [secondEvo];
  assert.equal(cardCostBreakdown(next, first.id, firstEvo).freeBase, true);
  assert.equal(cardCostBreakdown(next, second.id, secondEvo).freeBase, true);
});


function containsFreePlayPrimitive(actions: RuleAction[]): boolean {
  return actions.some((action) => {
    if (action.kind === "play") return action.free;
    if (action.kind === "cost") return action.operation === "free";
    if (action.kind === "sequence") return containsFreePlayPrimitive(action.effects);
    if (action.kind === "conditional") return containsFreePlayPrimitive(action.whenTrue) || containsFreePlayPrimitive(action.whenFalse ?? []);
    if (action.kind === "replacement") return containsFreePlayPrimitive(action.replaceWith);
    return false;
  });
}

test("every printed free-play card maps to the shared play or payment primitives", () => {
  const printed = CARDS.filter((candidate) => /for free|this is free/i.test(candidate.effect));
  assert.ok(printed.length > 0);
  for (const candidate of printed) {
    const definition = ruleDefinitionForCard(candidate);
    const paymentPrimitive = definition.play.costModifiers.some((modifier) => (
      modifier.kind === "cost-free" || modifier.kind === "cost-alternative"
    ));
    const programPrimitive = compileCardEffect(candidate).instructions.some((instruction) => containsFreePlayPrimitive(instruction.effects));
    assert.ok(paymentPrimitive || programPrimitive, `${candidate.catalogId} ${candidate.name} is missing a generalized free-play primitive`);
  }
});

test("Luck Aura's free play becomes a normal typed card play without paying the printed base cost", () => {
  const { state, first } = baseMatch("LUCK_AURA");
  const luck = card("bb-163", "luck-aura-effect");
  const playableTemplate = CARDS.find((candidate) => (
    candidate.type === "Action"
    && candidate.cost !== "X"
    && candidate.cost > 0
    && ruleDefinitionForCard(candidate).play.choices.every((choice) => !["announce", "pay"].includes(choice.timing))
    && !/must Reroll/i.test(candidate.effect)
  ));
  assert.ok(playableTemplate);
  const played = { ...structuredClone(playableTemplate), id: "luck-aura-free-card" };
  first.hand = [played];
  first.energy = 0;
  first.energyZone = [];
  first.maxEnergy = 0;
  const definition = ruleDefinitionForCard(luck);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);

  let next = resolveStructuredEffect(state, createRuleObject({ controllerId: first.id, card: luck, ability, kind: "card" }));
  const hand = next.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds");
  assert.ok(hand?.options.some((option) => option.id === played.id));
  next = submitCardChoice(next, first.id, { handCardIds: [played.id], confirmed: true });
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === played.id), false);
  const object = next.batch.find((candidate) => candidate.card.id === played.id);
  assert.ok(object);
  assert.equal(object.rulesObjectVersion, 3);
  assert.equal(object.controllerId, first.id);
  assert.equal(next.players[0].cardsPlayedThisTurn, 1);
  assert.ok(next.log.some((entry) => entry.cardInstanceId === played.id && entry.cardEvent === "played"));
});

test("free-play compiler preserves Mind Control source and physical destination ownership", () => {
  const mind = card("br-19", "mind-control-model");
  const actions = compileCardEffect(mind).instructions.flatMap((instruction) => instruction.effects);
  const play = actions.find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.free, true);
  assert.equal(play.source, "hand");
  assert.equal(play.sourceOwner, "opponent");
  assert.equal(play.destinationOwner, "opponent");
});

test("Trick Trap's shared free-play selector retains Hero type and printed-cost ceiling", () => {
  const trick = card("br-70", "trick-trap-model");
  const actions = compileCardEffect(trick).instructions.flatMap((instruction) => instruction.effects);
  const play = actions.find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.cardType, "Hero");
  assert.equal(play.maximumCost, 3);
});


test("faction-qualified free plays retain faction and cost restrictions", () => {
  for (const [id, expectedMaximum] of [["bb-222", 4], ["bb-226", undefined]] as const) {
    const source = card(id, `${id}-free-model`);
    const play = compileCardEffect(source).instructions
      .flatMap((instruction) => instruction.effects)
      .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
    assert.ok(play, `${id} should compile a free play`);
    assert.deepEqual(play.factions, ["Aquos"]);
    assert.equal(play.maximumCost, expectedMaximum);
    const choice = ruleDefinitionForCard(source).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.choices)
      .find((candidate) => candidate.id === "handCardIds");
    assert.deepEqual(choice?.factions, ["Aquos"]);
    assert.equal(choice?.maximumCost, expectedMaximum);
    assert.equal(choice?.playForFree, true);
  }
});

test("named Underdog free plays compile to an exact-card shared play request", () => {
  for (const id of ["aa-91", "aa-167", "aa-171", "aa-178", "aa-197", "aa-201"] as const) {
    const source = card(id, `${id}-named-free`);
    const play = compileCardEffect(source).instructions
      .flatMap((instruction) => instruction.effects)
      .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
    assert.ok(play?.cardName, `${id} should retain the named card identity`);
    const choice = ruleDefinitionForCard(source).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.choices)
      .find((candidate) => candidate.id === "handCardIds");
    assert.equal(choice?.cardName, play.cardName);
    assert.equal(choice?.playForFree, true);
  }
});

test("Darkus Titan Hydranoid carries the opponent-owned chosen Action into the shared play request", () => {
  const source = card("aa-118", "hydranoid-chosen-card");
  const definition = ruleDefinitionForCard(source);
  const instructions = definition.abilities.flatMap((ability) => ability.instructions);
  const selection = instructions.flatMap((instruction) => instruction.choices).find((choice) => choice.id === "handCardIds");
  assert.equal(selection?.owner, "opponent");
  assert.equal(selection?.cardType, "Action");
  const play = instructions.flatMap((instruction) => instruction.effects)
    .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.sourceOwner, "opponent");
  assert.equal(play.free, true);
});
