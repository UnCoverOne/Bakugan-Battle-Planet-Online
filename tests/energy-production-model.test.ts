import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, energizeCard, type GameCard } from "../lib/game";
import { energyZoneView } from "../lib/energy";
import { authorRuleDefinitionForCard } from "../lib/rules/catalogue";
import {
  activeUnchargedEnergyIds,
  beginCardPayment,
  commitCardPayment,
  energyProductionValue,
  maximumPayableEnergy,
  normalizeEnergyCardState,
  prepareDeclaredEnergyPayment,
  rechargeEnergyCards,
  setEnergyCardChargeState,
  unchargeEnergyCards,
} from "../lib/rules/costs";
import { setPhysicalEnergy } from "./helpers/energy";

function matchWithPlayers() {
  const player = makePlayer("energy-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("energy-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("ENERGY-MODEL", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.priority = player.id;
  match.startingPlayer = player.id;
  return { match, player: match.players[0], opponent: match.players[1] };
}

function actionCard(cost: number): GameCard {
  const source = CARDS.find((card) => card.type === "Action" && card.cost === cost);
  assert.ok(source, `Missing Action card with printed cost ${cost}`);
  return { ...source, id: `energy-action-${cost}` };
}

test("ordinary Energize adds a charged card without producing Energy", () => {
  const { match, player, opponent } = matchWithPlayers();
  const card = player.hand[0];
  assert.ok(card);
  match.phase = "energize";
  player.energizedThisTurn = false;
  opponent.energizedThisTurn = true;
  const next = energizeCard(match, player.id, card.id);
  const updated = next.players[0];
  assert.equal(updated.energy, 0);
  assert.equal(updated.energyZone.length, 1);
  assert.deepEqual(activeUnchargedEnergyIds(updated, next.turn), []);
});

test("Energy production can overproduce and leave the remainder in the Energy indicator pool", () => {
  const { match, player } = matchWithPlayers();
  setPhysicalEnergy(player, 2);
  player.bakugan[0].character = {
    ...player.bakugan[0].character,
    id: "double-energy-character",
    effect: "All Energy cards make 2 [Energy] instead of 1 [Energy].",
  };
  normalizeEnergyCardState(player, match.turn);
  assert.equal(energyProductionValue(match, player.id), 2);
  assert.equal(maximumPayableEnergy(match, player.id), 4);

  const card = actionCard(3);
  player.hand = [card];
  beginCardPayment(match, player.id, card);
  prepareDeclaredEnergyPayment(match, player.id, 3);
  assert.equal(player.energy, 4);
  assert.equal(activeUnchargedEnergyIds(player, match.turn).length, 2);
  commitCardPayment(match, player.id);
  assert.equal(player.energy, 1);
});

test("forced uncharge does not produce Energy and Charge-Step locks affect only automatic recharge", () => {
  const { match, opponent } = matchWithPlayers();
  setPhysicalEnergy(opponent, 4);
  normalizeEnergyCardState(opponent, match.turn);
  const ids = opponent.energyZone.slice(0, 3).map((card) => card.id);
  const result = unchargeEnergyCards(match, opponent.id, ids, {
    producesEnergy: false,
    preventChargeStepRecharge: true,
  });
  assert.equal(result.count, 3);
  assert.equal(opponent.energy, 0);
  assert.deepEqual(activeUnchargedEnergyIds(opponent, match.turn), ids);
  assert.equal(rechargeEnergyCards(match, opponent.id, undefined, { respectChargeStepLocks: true }), 0);
  assert.equal(rechargeEnergyCards(match, opponent.id, [ids[0]]), 1, "explicit Recharge can charge a locked card");
  assert.deepEqual(activeUnchargedEnergyIds(opponent, match.turn), ids.slice(1));

  match.turn += 1;
  normalizeEnergyCardState(opponent, match.turn);
  assert.equal(rechargeEnergyCards(match, opponent.id, undefined, { respectChargeStepLocks: true }), 2);
  assert.deepEqual(activeUnchargedEnergyIds(opponent, match.turn), []);
});

test("Energize-uncharged state does not itself generate Energy and the zone view reports charged/total", () => {
  const { match, player } = matchWithPlayers();
  setPhysicalEnergy(player, 3);
  normalizeEnergyCardState(player, match.turn);
  setEnergyCardChargeState(match, player.id, [player.energyZone[0].id], "uncharged");
  assert.equal(player.energy, 0);
  const view = energyZoneView(player, match.turn);
  assert.equal(view.chargedEnergyCount, 2);
  assert.equal(view.cards.length, 3);
  assert.equal(view.availableEnergy, 0);
});

test("Uncharge grammar compiles opponent selection, no production, and Charge-Step prevention", () => {
  const source = actionCard(2);
  const draft = authorRuleDefinitionForCard({
    ...source,
    id: "energy-drain-draft",
    catalogId: "bb-999",
    effect: "Uncharge 3 Energy cards an opponent controls. They do not recharge at the end of the turn.",
  });
  const instruction = draft.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.actions.some((action) => action.kind === "uncharge-energy"));
  assert.ok(instruction);
  const action = instruction.actions.find((candidate) => candidate.kind === "uncharge-energy");
  assert.ok(action && action.kind === "uncharge-energy");
  assert.equal(action.amount, 3);
  assert.equal(action.playerScope, "opponent");
  assert.equal(action.producesEnergy, false);
  assert.equal(action.preventChargeStepRecharge, true);
  const choice = instruction.choices.find((candidate) => candidate.id === "targetEnergyIds");
  assert.equal(choice?.energyState, "charged");
  assert.equal(choice?.owner, "opponent");
  assert.equal(choice?.minimum, 3);
  assert.equal(choice?.maximum, 3);
});
