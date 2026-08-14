import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import type { ChoiceSpec } from "../lib/rules/model";

function card(catalogId: string) {
  const value = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(value, `Missing ${catalogId} from the catalogue fixture.`);
  return value;
}

function choice(definition: ReturnType<typeof ruleDefinitionForCard>, id: ChoiceSpec["id"]) {
  const value = definition.play.choices.find((candidate) => candidate.id === id)
    ?? definition.abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.choices)
      .find((candidate) => candidate.id === id);
  assert.ok(value, `Expected ${definition.cardId} to expose ${String(id)}.`);
  return value;
}

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("CORE-CHOICES", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected = { [first.id]: first.bakugan[0].id, [second.id]: second.bakugan[0].id };
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return state;
}

test("Consort creates legal Field-core and open-Bakugan selections", () => {
  const definition = ruleDefinitionForCard(card("bb-62"));
  const core = choice(definition, "coreCell");
  const target = choice(definition, "targetBakuganId");

  assert.equal(core.selector, "bakucore");
  assert.equal(core.attachmentState, "unattached");
  assert.equal(core.targetOwner, "any");
  assert.equal(target.selector, "chosen-bakugan");
  assert.equal(target.openState, "open");
});

test("Mega Punch compiles its printed Fist attachment into a complete choice sequence", () => {
  const definition = ruleDefinitionForCard(card("br-33"));
  const instructions = definition.abilities.flatMap((ability) => ability.instructions);
  assert.ok(instructions.some((instruction) => instruction.effects.some((effect) => (
    effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore"
  ))));

  const core = choice(definition, "coreCell");
  const target = choice(definition, "targetBakuganId");
  assert.deepEqual(core.coreTypes, ["Fist"]);
  assert.equal(core.attachmentState, "unattached");
  assert.equal(core.targetOwner, "any");
  assert.equal(target.openState, "open");
});

test("typed BakuCore choices expose only matching Field cores from either player's setup", () => {
  const state = match();
  const first = state.players[0];
  assert.ok(state.placements.length >= 2);
  state.placements[0].core.type = "Fist";
  state.placements[0].playerId = state.players[0].id;
  state.placements[0].attachedTo = undefined;
  state.placements[1].core.type = "Fist";
  state.placements[1].playerId = state.players[1].id;
  state.placements[1].attachedTo = undefined;

  const megaPunch = card("br-33");
  const core = choice(ruleDefinitionForCard(megaPunch), "coreCell");
  const schema = buildChoiceSchemaFromSpecs(state, first.id, megaPunch, [core], core.timing);
  const field = schema.fields[0];
  assert.ok(field.options.length >= 2);
  assert.ok(field.options.every((option) => state.placements.find((placement) => placement.cell === option.id)?.core.type === "Fist"));
  assert.ok(field.options.some((option) => option.ownerId === state.players[0].id));
  assert.ok(field.options.some((option) => option.ownerId === state.players[1].id));
});

test("other singular Field-core attachment effects share the repaired parser", () => {
  const drumWave = ruleDefinitionForCard(card("aa-22"));
  assert.equal(choice(drumWave, "coreCell").attachmentState, "unattached");
  assert.equal(choice(drumWave, "targetBakuganId").openState, "open");

  const nobilious = ruleDefinitionForCard(card("br-213"));
  const core = choice(nobilious, "coreCell");
  assert.deepEqual(core.coreTypes, ["Fist"]);
  assert.equal(core.attachmentState, "unattached");
  assert.ok(nobilious.abilities.flatMap((ability) => ability.instructions).some((instruction) => instruction.effects.some((effect) => (
    effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore"
  ))));
});

test("up-to-three Field-core effects resolve as three sequential optional legal selections", () => {
  const definition = ruleDefinitionForCard(card("aa-129"));
  const coreInstructions = definition.abilities.flatMap((ability) => ability.instructions)
    .filter((instruction) => instruction.choices.some((candidate) => candidate.id === "coreCell"));

  assert.equal(coreInstructions.length, 3);
  for (const instruction of coreInstructions) {
    const core = instruction.choices.find((candidate) => candidate.id === "coreCell");
    const confirmed = instruction.choices.find((candidate) => candidate.id === "confirmed");
    assert.deepEqual(core?.coreTypes, ["Fist"]);
    assert.equal(core?.attachmentState, "unattached");
    assert.ok(confirmed, "Each up-to selection must remain optional.");
    assert.ok(instruction.effects.some((effect) => effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore"));
  }
});

test("highlighted SVG BakuCores retain a painted pointer hit target", async () => {
  const css = await readFile(new URL("../components/game-screen-v2/ChoiceQueueLayer.module.css", import.meta.url), "utf8");
  assert.match(css, /\[data-choice-target-valid=\\?"true\\?"\]\[data-core-cell\]\s*>\s*image\)\s*\{\s*pointer-events:\s*all\s*!important/s);
});
