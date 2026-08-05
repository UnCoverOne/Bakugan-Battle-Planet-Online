import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  playCard,
} from "../lib/game";
import { activeTappedEnergyIds } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function instance(catalogId: string, id: string) {
  const template = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(template, `Missing ${catalogId}`);
  return {
    ...template,
    id,
    factions: [...template.factions],
    mechanics: [...template.mechanics],
    coreTypes: [...template.coreTypes],
  };
}

test("Turn to Energy resolves from the batch into the Energy Zone uncharged", () => {
  const player = makePlayer("turn-energy-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("turn-energy-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("TURNTOENERGY", "bo1", [player, opponent]);
  state.turn = 3;
  state.phase = "preRoll";
  state.stepLabel = "Roll Phase • Pre-roll priority";
  state.startingPlayer = player.id;
  state.initialStartingPlayer = player.id;
  state.priority = player.id;
  state.passes = [];

  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const source = instance("bb-134", "turn-to-energy-runtime");
  const firstEnergy = instance("bb-1", "turn-to-energy-payment-one");
  const secondEnergy = instance("bb-2", "turn-to-energy-payment-two");
  live.hand = [source];
  live.energyZone = [firstEnergy, secondEnergy];
  live.maxEnergy = 2;
  live.energy = 0;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).energyTapTurn = state.turn;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).tappedEnergyIds = [];

  const definition = ruleDefinitionForCard(source);
  const energize = definition.abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(energize && energize.kind === "energize");
  assert.equal(energize.source, "self");
  assert.equal(energize.enters, "uncharged");

  const played = playCard(state, player.id, source.id);
  assert.equal(played.batch.length, 1);
  const afterFirstPass = passPriority(played, player.id);
  const resolved = passPriority(afterFirstPass, opponent.id);

  const after = resolved.players.find((candidate) => candidate.id === player.id)!;
  assert.equal(resolved.pendingChoice, undefined);
  assert.equal(resolved.batch.length, 0);
  assert.equal(after.hand.some((card) => card.id === source.id), false);
  assert.equal(after.discard.some((card) => card.id === source.id), false);
  assert.equal(after.energyZone.some((card) => card.id === source.id), true);
  assert.equal(after.maxEnergy, 3);
  assert.deepEqual(
    new Set(activeTappedEnergyIds(after, resolved.turn)),
    new Set([firstEnergy.id, secondEnergy.id, source.id]),
  );
});
