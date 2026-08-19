import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, passPriority, submitCardChoice } from "../lib/game";
import { resolveManualDamage } from "../lib/manualDamage";
import { cardCostBreakdown } from "../lib/rules/costs";
import { createRuleObject } from "../lib/rules/objects";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

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
  assert.match(sacrifice?.description ?? "", /3 Energy.*only 2/i);
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

test("conditional self-free Evos use the normal cost calculation", () => {
  const { state, first } = baseMatch("SELF_FREE");
  const fangzor = card("br-102", "fangzor-free");
  first.hand = [fangzor];
  first.discard = Array.from({ length: 20 }, (_, index) => card("bb-1", `discard-${index}`));
  const breakdown = cardCostBreakdown(state, first.id, fangzor);
  assert.equal(breakdown.freeBase, true);
  assert.equal(breakdown.total, 0);
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
