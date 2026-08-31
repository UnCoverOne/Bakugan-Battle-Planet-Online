import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS, CORES, makePlayer, STARTER_DECKS } from "../lib/data";
import {
  activateFusion,
  createMatch,
  fusionActivationRequirements,
  passPriority,
  type Bakugan,
  type MatchState,
} from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";

function fusionState(catalogId: string, energy = 0): { state: MatchState; bakugan: Bakugan } {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const character = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(character?.fusionPairId);
  const template = BAKUGAN.find((candidate) => candidate.character.id === character.id);
  assert.ok(template);
  const bakugan: Bakugan = {
    ...structuredClone(template),
    id: "fusion-target",
    character,
    fusionCharacter: CARDS.find((card) => card.fusionPairId === character.fusionPairId && card.fusionFace === "b"),
    fused: false,
    evoStack: [],
    heldCoreCells: [],
    bakuGear: [],
  };
  first.bakugan = [bakugan];
  first.energy = energy;
  const state = createMatch("FUSION", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.priority = first.id;
  return { state, bakugan };
}

test("Fusion requirements work while closed and require the printed payment", () => {
  const { state } = fusionState("ff-203a", 8);
  const requirements = fusionActivationRequirements(state, "first", "fusion-target");
  assert.deepEqual(requirements.map(({ id, energyCost, legal }) => ({ id, energyCost, legal })), [
    { id: "energy:8", energyCost: 8, legal: true },
  ]);
  assert.equal(state.players[0].bakugan[0].open, false);
});

test("Fusion payment enters the batch and flips only on resolution", () => {
  const { state } = fusionState("ff-203a", 8);
  let afterActivation = activateFusion(state, "first", "fusion-target");
  assert.equal(afterActivation.players[0].energy, 0);
  assert.equal(afterActivation.players[0].bakugan[0].fused, false);
  afterActivation = passPriority(afterActivation, "first");
  afterActivation = passPriority(afterActivation, "second");
  assert.equal(afterActivation.players[0].bakugan[0].fused, true);
  assert.equal(afterActivation.players[0].bakugan[0].fusionCharacter?.catalogId, "ff-203b");
});

test("Fusion Core requirements accept a held matching Core and reject an Evo", () => {
  const { state } = fusionState("sv-216a", 0);
  const bakugan = state.players[0].bakugan[0];
  bakugan.heldCoreCells = ["core-cell"];
  state.placements.push({
    playerId: "first",
    core: { ...CORES.find((core) => core.type === "Shield")!, id: "held-shield" },
    cell: "core-cell",
    order: 1,
    attachedTo: bakugan.id,
  });
  const requirements = fusionActivationRequirements(state, "first", bakugan.id);
  assert.equal(requirements.length, 2);
  assert.ok(requirements.some((requirement) => requirement.id === "core:Shield" && requirement.legal));
  assert.ok(requirements.some((requirement) => requirement.id === "core:Fist" && !requirement.legal));

  bakugan.evoStack = [CARDS.find((card) => card.type === "Evo")!];
  assert.ok(fusionActivationRequirements(state, "first", bakugan.id).every((requirement) => !requirement.legal));
});

test("Fusion-triggered self effects use the triggering Fusion Bakugan", () => {
  const source = CARDS.find((card) => card.catalogId === "sv-260a")!;
  const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind === "triggered");
  assert.equal(ability?.trigger?.event, "FUSION_COMPLETED");
  assert.equal(ability?.instructions[0]?.choices.length, 0);
  assert.deepEqual(ability?.instructions[0]?.actions.find((action) => action.kind === "fusion"), {
    kind: "fusion",
    operation: "fuse",
    targetChoiceId: "sourceBakuganId",
  });
});
