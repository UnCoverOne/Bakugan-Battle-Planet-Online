import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  cardChoiceSpec,
  passPriority,
  type MatchState,
  type PendingEffect,
} from "../lib/game";
import { playCardAndPassPriority } from "../lib/priority";
import {
  brawlCombatants,
  brawlIsEngaged,
  orderedBatchEffects,
  powerStepStatus,
} from "../components/game-screen-v2/brawlState";

function engagedPowerMatch() {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("BRL123", "bo1", [player, opponent]);
  match.turn = 1;
  match.phase = "power";
  match.stepLabel = "Brawl Phase • Power Step";
  match.priority = player.id;
  for (const participant of match.players) {
    const bakugan = participant.bakugan[0];
    bakugan.open = true;
    match.selected[participant.id] = bakugan.id;
    match.rolls[participant.id] = {
      playerId: participant.id,
      bakuganId: bakugan.id,
      target: "h3-3",
      resolvedTarget: "h3-3",
      result: "open-no-core",
      cores: [],
      accuracyRoll: 50,
      doubleRoll: 50,
      note: "Test roll",
    };
  }
  return match;
}

function pending(match: MatchState, playerId: string, id: string, name: string): PendingEffect {
  const template = CARDS.find((card) => card.type === "Action");
  assert.ok(template);
  return {
    id,
    controllerId: playerId,
    card: { ...template, id: `${id}-card`, name, displayName: name, effect: "" },
    choices: {},
    kind: "card",
  };
}

test("the Brawl HUD exposes both engaged active Bakugan and live modifiers", () => {
  const match = engagedPowerMatch();
  const player = match.players[0];
  const active = player.bakugan[0];
  match.powerBoost[active.id] = 300;
  match.damageBoost[active.id] = 2;

  assert.equal(brawlIsEngaged(match), true);
  const views = brawlCombatants(match, player.id);
  assert.equal(views.length, 2);
  assert.equal(views[0].bakuganId, active.id);
  assert.equal(views[0].power, views[0].basePower + 300);
  assert.equal(views[0].damage, views[0].baseDamage + 2);
  assert.match(views[0].modifiers.join(" "), /Power modifier \+300 B/i);
  assert.equal(powerStepStatus(match).active, true);
});

test("a played Power Step card enters the batch and transfers priority", () => {
  const match = engagedPowerMatch();
  const player = match.players[0];
  const opponent = match.players[1];
  const card = CARDS.find((candidate) => (
    candidate.type === "Action"
    && candidate.cost !== "X"
    && candidate.cost <= 3
    && cardChoiceSpec(match, player.id, candidate).length === 0
  ));
  assert.ok(card);
  player.hand = [{ ...card, id: "power-action" }];
  player.energyZone = Array.from({ length: 3 }, (_, index) => ({ ...card, id: `power-energy-${index}` }));
  player.maxEnergy = 3;
  player.energy = 3;
  Object.assign(player, { energyTapTurn: 1, tappedEnergyIds: player.energyZone.map((energy) => energy.id) });

  const next = playCardAndPassPriority(match, player.id, "power-action", {});
  assert.equal(next.batch.length, 1);
  assert.equal(next.batch[0].card.id, "power-action");
  assert.equal(next.priority, opponent.id);
  assert.deepEqual(next.passes, []);
});

test("the newest batch effect is displayed on the left and resolves first", () => {
  const match = engagedPowerMatch();
  const player = match.players[0];
  const opponent = match.players[1];
  const oldest = pending(match, player.id, "oldest", "Oldest Effect");
  const newest = pending(match, opponent.id, "newest", "Newest Effect");
  match.batch = [oldest, newest];

  assert.deepEqual(orderedBatchEffects(match).map((effect) => effect.id), ["newest", "oldest"]);

  const afterFirstPass = passPriority(match, player.id);
  const afterSecondPass = passPriority(afterFirstPass, opponent.id);
  assert.deepEqual(afterSecondPass.batch.map((effect) => effect.id), ["oldest"]);
  assert.equal(afterSecondPass.priority, match.startingPlayer);
});

test("two consecutive passes with an empty Power Step batch advance to Victor", () => {
  const match = engagedPowerMatch();
  const player = match.players[0];
  const opponent = match.players[1];

  const afterFirstPass = passPriority(match, player.id);
  const afterSecondPass = passPriority(afterFirstPass, opponent.id);
  assert.equal(afterSecondPass.phase, "victor");
  assert.ok(afterSecondPass.brawlWinner);
});
