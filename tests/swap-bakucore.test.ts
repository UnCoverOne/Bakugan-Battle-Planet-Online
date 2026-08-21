import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, resolveStructuredEffect } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";

function card(catalogId: string) {
  const value = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(value, `Missing ${catalogId} from the catalogue fixture.`);
  return value;
}

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("SWAP-CORE", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected = { [first.id]: first.bakugan[0].id, [second.id]: second.bakugan[0].id };
  state.placements = [
    { playerId: first.id, core: first.cores[0], cell: "source-core", order: 1, attachedTo: first.bakugan[0].id },
    { playerId: second.id, core: second.cores[0], cell: "opponent-core", order: 2, attachedTo: second.bakugan[0].id },
    { playerId: first.id, core: first.cores[1], cell: "other-friendly-core", order: 3, attachedTo: first.bakugan[1].id },
  ];
  first.bakugan[0].open = true;
  first.bakugan[0].heldCoreCells = ["source-core"];
  first.bakugan[1].open = true;
  first.bakugan[1].heldCoreCells = ["other-friendly-core"];
  second.bakugan[0].open = true;
  second.bakugan[0].heldCoreCells = ["opponent-core"];
  return state;
}

test("SwapBakucore compiles for every printed BR swap card", () => {
  for (const [catalogId, leftHolder] of [
    ["br-1", "controller-active"],
    ["br-90", "source-bakugan"],
    ["br-151", "source-bakugan"],
    ["br-165", "source-bakugan"],
  ] as const) {
    const definition = ruleDefinitionForCard(card(catalogId));
    const action = definition.abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.effects)
      .find((effect) => effect.kind === "swap-bakucore");
    assert.ok(action, `${catalogId} must compile a SwapBakucore effect.`);
    assert.equal(action.leftHolder, leftHolder);
    assert.equal(action.rightHolder, "opponent-active");
    assert.equal(action.leftCoreChoiceId, "coreCell");
    assert.equal(action.rightCoreChoiceId, "secondaryCoreCell");
  }
});

test("Aquify choices are limited to the participating Bakugan's attached BakuCores", () => {
  const state = match();
  const first = state.players[0];
  const aquify = card("br-1");
  const definition = ruleDefinitionForCard(aquify);
  const specs = definition.play.choices.filter((choice) => choice.id === "coreCell" || choice.id === "secondaryCoreCell");
  const schema = buildChoiceSchemaFromSpecs(state, first.id, aquify, specs, "announce");
  assert.deepEqual(schema.fields.find((field) => field.id === "coreCell")?.options.map((option) => option.id), ["source-core"]);
  assert.deepEqual(schema.fields.find((field) => field.id === "secondaryCoreCell")?.options.map((option) => option.id), ["opponent-core"]);
});

test("when-this-opens swap choices bind to the triggering Bakugan", () => {
  const state = match();
  const first = state.players[0];
  const mantonoid = card("br-90");
  const definition = ruleDefinitionForCard(mantonoid);
  const specs = definition.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.choices)
    .filter((choice) => choice.id === "coreCell" || choice.id === "secondaryCoreCell");
  const schema = buildChoiceSchemaFromSpecs(state, first.id, mantonoid, specs, "resolve", { sourceBakuganId: first.bakugan[1].id });
  assert.deepEqual(schema.fields.find((field) => field.id === "coreCell")?.options.map((option) => option.id), ["other-friendly-core"]);
  assert.deepEqual(schema.fields.find((field) => field.id === "secondaryCoreCell")?.options.map((option) => option.id), ["opponent-core"]);
});

test("SwapBakucore atomically exchanges attachment and held-Core bookkeeping", () => {
  const state = match();
  const first = state.players[0];
  const second = state.players[1];
  const aquify = { ...card("br-1"), id: "aquify-instance" };
  const resolved = resolveStructuredEffect(state, {
    id: "swap-bakucore-effect",
    controllerId: first.id,
    cardOwnerId: first.id,
    card: aquify,
    choices: { coreCell: "source-core", secondaryCoreCell: "opponent-core" },
    kind: "card",
  });
  assert.equal(resolved.placements.find((placement) => placement.cell === "source-core")?.attachedTo, second.bakugan[0].id);
  assert.equal(resolved.placements.find((placement) => placement.cell === "opponent-core")?.attachedTo, first.bakugan[0].id);
  assert.deepEqual(resolved.players[0].bakugan[0].heldCoreCells, ["opponent-core"]);
  assert.deepEqual(resolved.players[1].bakugan[0].heldCoreCells, ["source-core"]);
});

test("SwapBakucore has no opposing-Core option when the opposing Bakugan holds none", () => {
  const state = match();
  const first = state.players[0];
  const second = state.players[1];
  const placement = state.placements.find((candidate) => candidate.cell === "opponent-core");
  assert.ok(placement);
  delete placement.attachedTo;
  second.bakugan[0].heldCoreCells = [];
  const aquify = card("br-1");
  const definition = ruleDefinitionForCard(aquify);
  const specs = definition.play.choices.filter((choice) => choice.id === "coreCell" || choice.id === "secondaryCoreCell");
  const schema = buildChoiceSchemaFromSpecs(state, first.id, aquify, specs, "announce");
  assert.equal(schema.fields.find((field) => field.id === "secondaryCoreCell")?.options.length, 0);
});
