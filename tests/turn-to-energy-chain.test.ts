import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  playCard,
  type MatchState,
} from "../lib/game";
import { reduceMatch } from "../lib/engine/reducer";
import type { CommandEnvelope, GameCommand } from "../lib/engine/types";
import { advanceOpponentAi, opponentAiCanAct } from "../lib/opponentAi";
import { activeTappedEnergyIds } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { dispatchRulesCommand } from "../lib/rules/runtime";
import { isRuleObject, normalizeRuleObjects } from "../lib/rules/state";

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

function turnToEnergyState(opponentId = "turn-energy-opponent") {
  const player = makePlayer("turn-energy-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer(opponentId, "Opponent", STARTER_DECKS[1]);
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
  return { state, playerId: player.id, opponentId: opponent.id, source, firstEnergy, secondEnergy };
}

function assertResolved(
  resolved: MatchState,
  playerId: string,
  sourceId: string,
  paymentIds: readonly string[],
) {
  const after = resolved.players.find((candidate) => candidate.id === playerId)!;
  assert.equal(resolved.pendingChoice, undefined);
  assert.equal(resolved.batch.length, 0);
  assert.equal(after.hand.some((card) => card.id === sourceId), false);
  assert.equal(after.discard.some((card) => card.id === sourceId), false);
  assert.equal(after.energyZone.some((card) => card.id === sourceId), true);
  assert.equal(after.maxEnergy, 3);
  assert.deepEqual(
    new Set(activeTappedEnergyIds(after, resolved.turn)),
    new Set([...paymentIds, sourceId]),
  );
}

function reduce(
  state: MatchState,
  actorId: string,
  sequence: number,
  command: GameCommand,
) {
  const envelope: CommandEnvelope = {
    commandId: `turn-to-energy-command-${sequence}`,
    gameId: state.id,
    actorId,
    expectedVersion: state.version,
    issuedAt: 1_780_000_000_000 + sequence,
    randomSeed: `turn-to-energy-seed-${sequence}`,
    requestHash: `turn-to-energy-hash-${sequence}`,
    command,
  };
  return reduceMatch(state, envelope).state;
}

test("Turn to Energy resolves from the batch into the Energy Zone uncharged", () => {
  const { state, playerId, opponentId, source, firstEnergy, secondEnergy } = turnToEnergyState();
  const definition = ruleDefinitionForCard(source);
  const energize = definition.abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(energize && energize.kind === "energize");
  assert.equal(energize.source, "self");
  assert.equal(energize.enters, "uncharged");

  const played = playCard(state, playerId, source.id);
  assert.equal(played.batch.length, 1);
  const afterFirstPass = passPriority(played, playerId);
  const resolved = passPriority(afterFirstPass, opponentId);
  assertResolved(resolved, playerId, source.id, [firstEnergy.id, secondEnergy.id]);
});

test("Turn to Energy resolves through the production rules-command path", () => {
  const { state, playerId, opponentId, source, firstEnergy, secondEnergy } = turnToEnergyState();
  const played = dispatchRulesCommand(state, playerId, {
    type: "PLAY_CARD",
    cardId: source.id,
    choices: {},
  });
  assert.equal(played.batch.length, 1);
  const afterFirstPass = dispatchRulesCommand(played, playerId, { type: "PASS_PRIORITY" });
  const resolved = dispatchRulesCommand(afterFirstPass, opponentId, { type: "PASS_PRIORITY" });
  assertResolved(resolved, playerId, source.id, [firstEnergy.id, secondEnergy.id]);
});

test("Turn to Energy resolves through the deterministic server reducer", () => {
  const { state, playerId, opponentId, source, firstEnergy, secondEnergy } = turnToEnergyState();
  const played = reduce(state, playerId, 1, {
    type: "PLAY_CARD",
    cardId: source.id,
    choices: {},
  });
  const afterFirstPass = reduce(played, playerId, 2, { type: "PASS_PRIORITY" });
  const resolved = reduce(afterFirstPass, opponentId, 3, { type: "PASS_PRIORITY" });
  assertResolved(resolved, playerId, source.id, [firstEnergy.id, secondEnergy.id]);
});

test("the Training AI passes and resolves Turn to Energy after the player passes", () => {
  const { state, playerId, opponentId, source, firstEnergy, secondEnergy } = turnToEnergyState("training-bot");
  const bot = state.players.find((candidate) => candidate.id === opponentId)!;
  bot.hand = [];
  const played = dispatchRulesCommand(state, playerId, {
    type: "PLAY_CARD",
    cardId: source.id,
    choices: {},
  });
  const waitingForBot = dispatchRulesCommand(played, playerId, { type: "PASS_PRIORITY" });
  assert.equal(waitingForBot.priority, opponentId);
  assert.equal(opponentAiCanAct(waitingForBot, opponentId), true);
  const resolved = advanceOpponentAi(waitingForBot, opponentId);
  assert.ok(resolved);
  assertResolved(resolved, playerId, source.id, [firstEnergy.id, secondEnergy.id]);
});


test("normalization removes a completed Turn to Energy object stranded in the batch", () => {
  const { state, playerId, source } = turnToEnergyState();
  const played = dispatchRulesCommand(state, playerId, {
    type: "PLAY_CARD",
    cardId: source.id,
    choices: {},
  });
  const pending = played.batch[0];
  assert.ok(pending && isRuleObject(pending));

  const player = played.players.find((candidate) => candidate.id === playerId)!;
  player.energyZone.push(pending.card);
  player.maxEnergy = player.energyZone.length;
  pending.status = "resolved";
  pending.instructionIndex = 1;
  pending.cursor.instructionIndex = 1;

  normalizeRuleObjects(played);
  assert.equal(played.batch.length, 0);
  assert.equal(player.energyZone.some((card) => card.id === source.id), true);
});
