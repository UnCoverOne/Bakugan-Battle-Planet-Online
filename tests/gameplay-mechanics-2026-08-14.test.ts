import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  submitCardChoice,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { activeTappedEnergyIds } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { createRuleObject } from "../lib/rules/objects";
import { ensureRulesState } from "../lib/rules/state";
import { resolveStructuredEffect } from "../lib/game";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function addUntappedEnergy(player: ReturnType<typeof makePlayer>, amount: number) {
  player.energyZone = Array.from({ length: amount }, (_, index) => card("bb-10", `${player.id}-energy-${index}`));
  player.energy = 0;
}

function effectState(catalogId: string, withMagnus = false) {
  const player = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("b", "Beta", STARTER_DECKS[1]);
  if (withMagnus) player.heroes = [card("aa-68", "magnus-live")];
  const source = card(catalogId, `${catalogId}-source`);
  const state = createMatch(`MODE-${catalogId}-${withMagnus}`, "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = player.id;
  state.priority = player.id;
  state.selected[player.id] = player.bakugan[0].id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  player.bakugan[0].open = true;
  opponent.bakugan[0].open = true;
  const definition = ruleDefinitionForCard(source);
  const ability = definition.abilities.find((candidate) => candidate.kind === "spell") ?? definition.abilities[0];
  assert.ok(ability);
  const object = createRuleObject({ controllerId: player.id, card: source, ability, choices: {}, kind: "card" });
  return { state, player, opponent, source, object, definition };
}

test("Battle Mastery uses each card's printed choices instead of the generic B-Power/Damage pair", () => {
  const parasitic = effectState("aa-12");
  const state = resolveStructuredEffect(parasitic.state, parasitic.object);
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "mode");
  assert.ok(field);
  assert.deepEqual(field.options.map((option) => option.label), [
    "Your opponent discards three cards",
    "You draw three cards",
  ]);

  const phoenix = ruleDefinitionForCard(card("aa-13", "phoenix"));
  const phoenixMode = phoenix.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.choices)
    .find((choice) => choice.id === "mode");
  assert.deepEqual(phoenixMode?.options?.map((option) => option.label), ["+3 [FrostStrike]", "+[DoubleStrike]"]);

  const gorthion = ruleDefinitionForCard(card("aa-99", "gorthion"));
  const gorthionInstructions = gorthion.abilities.flatMap((ability) => ability.instructions);
  const gorthionMode = gorthionInstructions.flatMap((instruction) => instruction.choices).find((choice) => choice.id === "mode");
  assert.deepEqual(gorthionMode?.options?.map((option) => option.label), ["A Bakugan gets +600 [B]", "Recharge 6 Energy cards"]);
  assert.ok(gorthionInstructions.some((instruction) => (
    instruction.condition.kind === "mode-selected"
    && instruction.choices.some((choice) => choice.id === "targetBakuganId")
  )));
});

test("Magnus, Living Arm of Tiko adds Both and both Battle Mastery branches resolve", () => {
  const bodybreaker = effectState("aa-11", true);
  let state = resolveStructuredEffect(bodybreaker.state, bodybreaker.object);
  const field = state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "mode");
  assert.ok(field);
  assert.deepEqual(field.options.map((option) => option.id), ["battle-mastery-1", "battle-mastery-2", "both"]);
  state = submitCardChoice(state, bodybreaker.player.id, { mode: "both" });
  const activeId = bodybreaker.player.bakugan[0].id;
  assert.equal(state.powerBoost[activeId], 300);
  assert.equal(state.damageBoost[activeId], 4);
});

function pactState(frostStrike: number, energy: number) {
  const payer = makePlayer("payer", "Payer", STARTER_DECKS[0]);
  const attacker = makePlayer("attacker", "Attacker", STARTER_DECKS[1]);
  addUntappedEnergy(payer, energy);
  payer.hand = [card("bb-10", "sacrifice-card")];
  const pact = card("bb-152", "pact-reveal");
  payer.discard = [pact];
  const state = createMatch(`PACT-${frostStrike}-${energy}`, "bo1", [payer, attacker]);
  state.turn = 2;
  state.phase = "damage";
  state.pendingLoser = payer.id;
  state.pendingDamage = 3;
  state.revealedFlip = pact;
  state.damageOrigin = attacker.bakugan[0].id;
  state.damageFaction = "Pyrus";
  state.frostStrike[attacker.bakugan[0].id] = frostStrike;
  state.priority = payer.id;
  return { state, payer, attacker, pact };
}

test("Pact of Darkness does not offer Sacrifice when the post-free FrostStrike cost is unaffordable", () => {
  const setup = pactState(2, 1);
  assert.throws(
    () => resolveManualDamage(setup.state, setup.payer.id, setup.pact.id),
    /cannot be played by Sacrifice.*2 Energy.*1 is available/i,
  );
  assert.equal(setup.state.pendingChoice, undefined);
});

test("paying Pact of Darkness Sacrifice immediately plays it and still pays FrostStrike", () => {
  const setup = pactState(1, 1);
  let state = resolveManualDamage(setup.state, setup.payer.id, setup.pact.id);
  assert.equal(state.pendingChoice?.kind, "payment");
  state = submitCardChoice(state, setup.payer.id, { confirmed: true });
  assert.equal(state.pendingChoice?.schema.fields[0]?.id, "discardCardIds");
  state = submitCardChoice(state, setup.payer.id, { discardCardIds: ["sacrifice-card"] });

  const payer = state.players.find((candidate) => candidate.id === setup.payer.id)!;
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.revealedFlip, undefined);
  assert.equal(state.phase, "postDamage");
  assert.ok(state.batch.some((object) => object.card.id === setup.pact.id));
  assert.ok(payer.discard.some((candidate) => candidate.id === "sacrifice-card"));
  assert.equal(payer.discard.some((candidate) => candidate.id === setup.pact.id), false);
  assert.equal(activeTappedEnergyIds(payer, state.turn).length, 1);
  assert.equal((ensureRulesState(state) as ReturnType<typeof ensureRulesState> & { pactOfDarknessPayment?: unknown }).pactOfDarknessPayment, undefined);
});

function ceeDamageState(amount: number) {
  const dealer = makePlayer("dealer", "Dealer", STARTER_DECKS[0]);
  const damaged = makePlayer("damaged", "Damaged", STARTER_DECKS[1]);
  const cee = card("bb-195", "cee-live");
  dealer.heroes = [cee];
  damaged.deckCards = Array.from({ length: amount + 2 }, (_, index) => card("bb-10", `damage-${amount}-${index}`));
  damaged.deck = damaged.deckCards.length;
  const state = createMatch(`CEE-${amount}`, "bo1", [dealer, damaged]);
  state.turn = 2;
  state.phase = "damage";
  state.pendingLoser = damaged.id;
  state.pendingDamage = amount;
  state.damageOrigin = dealer.bakugan[0].id;
  state.damageFaction = dealer.bakugan[0].faction;
  state.priority = damaged.id;
  state.selected[dealer.id] = dealer.bakugan[0].id;
  return { state, dealer, damaged, cee };
}

function takeAllDamage(setup: ReturnType<typeof ceeDamageState>) {
  let state: MatchState = setup.state;
  while (state.phase === "damage" && state.pendingDamage > 0) {
    state = flipDamageCard(state, setup.damaged.id);
  }
  return state;
}

test("Cee triggers only after at least 10 cards of attack damage were actually taken", () => {
  const definition = ruleDefinitionForCard(card("bb-195", "cee-definition"));
  const trigger = definition.abilities.find((ability) => ability.kind === "triggered")?.trigger;
  assert.equal(trigger?.event, "ATTACK_DAMAGE_DEALT");
  assert.equal(trigger?.minimumEventAmount, 10);

  const nine = ceeDamageState(9);
  const afterNine = takeAllDamage(nine);
  assert.equal(afterNine.batch.some((object) => object.card.id === nine.cee.id && object.kind === "trigger"), false);

  const ten = ceeDamageState(10);
  const afterTen = takeAllDamage(ten);
  assert.equal(afterTen.batch.some((object) => object.card.id === ten.cee.id && object.kind === "trigger"), true);
});
