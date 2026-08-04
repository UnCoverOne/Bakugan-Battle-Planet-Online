import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  passPriority,
  type GameCard,
  type MatchState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi, chooseCardChoices } from "../lib/opponentAi";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import type { RuleAction } from "../lib/rules/model";

const SINGULAR_NON_FACTION_BAKUGAN = /\b(?:a|an|one)\s+non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan\b/i;

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function successfulRoll(playerId: string, bakuganId: string): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result: "open-no-core",
    cores: [],
    accuracyRoll: 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 100,
    doubleCore: false,
    path: [],
    note: "test open",
    simulationProfileId: "test",
    attempt: 1,
    collisionDecisions: [],
  };
}

function addUntappedEnergy(player: ReturnType<typeof makePlayer>, amount: number) {
  player.energyZone = Array.from({ length: amount }, (_, index) => (
    card("bb-10", `${player.id}-energy-${index}`)
  ));
  player.energy = 0;
  player.maxEnergy = amount;
}

function resolveTopBatchObject(state: MatchState) {
  state = passPriority(state, state.priority);
  return passPriority(state, state.priority);
}

function leafActions(actions: readonly RuleAction[]): RuleAction[] {
  return actions.flatMap((action) => {
    if (action.kind === "conditional") {
      return leafActions([...action.whenTrue, ...(action.whenFalse ?? [])]);
    }
    if (action.kind === "replacement") return leafActions(action.replaceWith);
    if (action.kind === "sequence") return leafActions(action.effects);
    return [action];
  });
}

test("singular non-Faction stat effects select one legal Bakugan while plural effects stay global", () => {
  const singularCards = CARDS.filter((candidate) => SINGULAR_NON_FACTION_BAKUGAN.test(candidate.effect));
  assert.deepEqual(
    singularCards.map((candidate) => candidate.catalogId).sort(),
    ["bb-120", "bb-66"],
    "Fragile to Light and Nature's Power are the current singular non-Faction stat effects",
  );

  for (const source of singularCards) {
    const excludedFaction = source.effect.match(SINGULAR_NON_FACTION_BAKUGAN)?.[1];
    assert.ok(excludedFaction);
    const definition = ruleDefinitionForCard(source);
    const targetChoice = definition.play.choices.find((choice) => choice.id === "targetBakuganId");
    assert.ok(targetChoice, `${source.displayName} must request a Bakugan target before play`);
    assert.equal(targetChoice.selector, "chosen-bakugan");
    assert.equal(targetChoice.targetOwner, "any");
    assert.equal(targetChoice.factions?.includes(excludedFaction as GameCard["faction"]), false);
    assert.equal(targetChoice.factions?.length, 5);

    const statActions = definition.abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => leafActions(instruction.actions))
      .filter((action): action is Extract<RuleAction, { kind: "modify-stat" }> => (
        action.kind === "modify-stat"
      ));
    assert.ok(statActions.length > 0);
    assert.ok(statActions.every((action) => action.scope === "target"));
  }

  const olivia = CARDS.find((candidate) => candidate.displayName === "Olivia Styles");
  assert.ok(olivia);
  const oliviaDefinition = ruleDefinitionForCard(olivia);
  assert.equal(
    oliviaDefinition.play.choices.some((choice) => choice.id === "targetBakuganId"),
    false,
    "plural Non-Ventus wording must remain a global continuous effect",
  );
  const oliviaStatActions = oliviaDefinition.abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => leafActions(instruction.actions))
    .filter((action): action is Extract<RuleAction, { kind: "modify-stat" }> => (
      action.kind === "modify-stat"
    ));
  assert.ok(oliviaStatActions.some((action) => action.scope === "all-bakugan"));
});

test("opponent AI targets only the player's Bakugan with Nature's Power", () => {
  const ai = makePlayer("training-bot", "Opponent", STARTER_DECKS[0]);
  const human = makePlayer("human", "Player", STARTER_DECKS[1]);
  const naturePower = card("bb-120", "nature-power-ai-test");
  ai.hand = [naturePower];
  addUntappedEnergy(ai, 1);

  let state = createMatch("NATURETARGET", "bo1", [ai, human]);
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = human.id;
  state.initialStartingPlayer = human.id;
  state.priority = ai.id;

  for (const player of state.players) {
    for (const bakugan of player.bakugan) {
      bakugan.faction = "Ventus";
      bakugan.character.faction = "Ventus";
      bakugan.character.factions = ["Ventus"];
    }
  }

  const aiActive = state.players.find((player) => player.id === ai.id)!.bakugan[0];
  const humanActive = state.players.find((player) => player.id === human.id)!.bakugan[0];
  humanActive.faction = "Aquos";
  humanActive.character.faction = "Aquos";
  humanActive.character.factions = ["Aquos"];
  aiActive.open = true;
  humanActive.open = true;
  aiActive.bPower = 500;
  aiActive.character.bPower = 500;
  humanActive.bPower = 900;
  humanActive.character.bPower = 900;
  state.selected[ai.id] = aiActive.id;
  state.selected[human.id] = humanActive.id;
  state.rolls[ai.id] = successfulRoll(ai.id, aiActive.id);
  state.rolls[human.id] = successfulRoll(human.id, humanActive.id);

  assert.equal(chooseCardChoices(state, ai.id, naturePower).targetBakuganId, humanActive.id);

  const played = advanceOpponentAi(state, ai.id);
  assert.ok(played);
  const pending = played.batch.find((effect) => effect.card.id === naturePower.id);
  assert.ok(pending, "AI should play Nature's Power when the reduction changes the Victor");
  assert.equal(pending.choices.targetBakuganId, humanActive.id);

  state = resolveTopBatchObject(played);
  assert.equal(state.powerBoost[humanActive.id], -500);
  assert.equal(state.powerBoost[aiActive.id] ?? 0, 0);
});
