import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  emitRuleEvent,
  evaluateBakuganCharacteristics,
  ruleDefinitionForCard,
} from "../lib/rules";
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
  state.placements = [
    { playerId: first.id, core: first.cores[0], cell: "test-core-first", order: 1 },
    { playerId: second.id, core: second.cores[0], cell: "test-core-second", order: 2 },
  ];
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

test("Haos Titan Nillious separates its static Core bonuses from its on-open attachment", () => {
  const definition = ruleDefinitionForCard(card("bb-257"));
  const triggered = definition.abilities.find((ability) => (
    ability.kind === "triggered" && ability.trigger?.event === "BAKUGAN_OPENED"
  ));
  assert.ok(triggered, "Haos Titan Nillious must expose a BAKUGAN_OPENED trigger.");
  assert.ok(triggered.instructions.some((instruction) => instruction.effects.some((effect) => (
    effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore"
  ))));
  const triggerCore = triggered.instructions.flatMap((instruction) => instruction.choices)
    .find((candidate) => candidate.id === "coreCell");
  assert.equal(triggerCore?.timing, "resolve");
  assert.equal(triggerCore?.attachmentState, "unattached");
  assert.ok(triggered.instructions.flatMap((instruction) => instruction.choices)
    .some((candidate) => candidate.id === "confirmed"));
  assert.equal(
    definition.play.choices.some((candidate) => candidate.id === "coreCell" && candidate.timing !== "resolve"),
    false,
    "The additional Core must not be selected while the Evo is being played.",
  );

  const staticInstructions = definition.abilities
    .filter((ability) => ability.kind !== "triggered")
    .flatMap((ability) => ability.instructions);
  const powerInstruction = staticInstructions.find((instruction) => instruction.effects.some((effect) => (
    effect.kind === "modify-stat" && effect.stat === "power" && effect.amount === 200
  )));
  const damageInstruction = staticInstructions.find((instruction) => instruction.effects.some((effect) => (
    effect.kind === "modify-stat" && effect.stat === "damage" && effect.amount === 4
  )));
  assert.deepEqual(powerInstruction?.condition, {
    kind: "held-core-type",
    coreTypes: ["Magic Shield"],
    subject: "target",
  });
  assert.deepEqual(damageInstruction?.condition, {
    kind: "held-core-type",
    coreTypes: ["Flaming Fist"],
    subject: "target",
  });
  assert.equal(staticInstructions.some((instruction) => instruction.effects.some((effect) => (
    effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore"
  ))), false);
});

test("Haos Titan Nillious Core bonuses stay active exactly while the matching Core is held", () => {
  const state = match();
  const first = state.players[0];
  const bakugan = first.bakugan[0];
  const titan = { ...card("bb-257"), id: "test-haos-titan-nillious-static" };
  bakugan.evoStack = [titan];
  const basePower = titan.bPower ?? bakugan.bPower;
  const baseDamage = titan.damage ?? bakugan.damage;
  const placement = state.placements[0];
  assert.ok(placement);
  Object.assign(placement.core, {
    type: "Magic Shield",
    bonus: 0,
    damageBonus: 0,
    frostStrike: undefined,
    shadowStrike: false,
    conditionalFactions: undefined,
    conditionalBonus: undefined,
    conditionalDamage: undefined,
  });
  placement.attachedTo = bakugan.id;
  bakugan.heldCoreCells = [placement.cell];

  let evaluated = evaluateBakuganCharacteristics(state, bakugan, first);
  assert.equal(evaluated.power, basePower + 200);
  assert.equal(evaluated.damage, baseDamage);

  placement.core.type = "Flaming Fist";
  evaluated = evaluateBakuganCharacteristics(state, bakugan, first);
  assert.equal(evaluated.power, basePower);
  assert.equal(evaluated.damage, baseDamage + 4);

  delete placement.attachedTo;
  bakugan.heldCoreCells = [];
  evaluated = evaluateBakuganCharacteristics(state, bakugan, first);
  assert.equal(evaluated.power, basePower);
  assert.equal(evaluated.damage, baseDamage);
});

test("Haos Titan Nillious attaches only when its own Bakugan opens with the Evo already in play", () => {
  const state = match();
  const first = state.players[0];
  const sourceBakugan = first.bakugan[0];
  const otherBakugan = first.bakugan[1];
  const titan = { ...card("bb-257"), id: "test-haos-titan-nillious-open" };
  const shun = { ...card("br-77"), id: "test-shun-open" };
  sourceBakugan.evoStack = [titan];
  sourceBakugan.open = true;
  otherBakugan.open = true;
  first.heroes = [shun];
  state.selected[first.id] = otherBakugan.id;

  emitRuleEvent(state, {
    id: "nillious-other-bakugan-opened",
    name: "BAKUGAN_OPENED",
    actorId: first.id,
    controllerId: first.id,
    targetBakuganId: otherBakugan.id,
    createdAt: Date.now(),
  });
  assert.equal(state.batch.filter((object) => object.card.id === titan.id).length, 0);
  assert.equal(
    state.batch.filter((object) => object.card.id === shun.id).length,
    1,
    "Shun Kazami remains a controller-wide 'When you open a Bakugan' trigger.",
  );

  emitRuleEvent(state, {
    id: "nillious-source-bakugan-opened",
    name: "BAKUGAN_OPENED",
    actorId: first.id,
    controllerId: first.id,
    targetBakuganId: sourceBakugan.id,
    createdAt: Date.now(),
  });
  const titanTriggers = state.batch.filter((object) => object.card.id === titan.id);
  assert.equal(titanTriggers.length, 1);
  assert.equal(titanTriggers[0].choices.sourceBakuganId, sourceBakugan.id);
  assert.equal(state.batch.filter((object) => object.card.id === shun.id).length, 2);

  const lateState = match();
  const latePlayer = lateState.players[0];
  const lateBakugan = latePlayer.bakugan[0];
  const lateTitan = { ...card("bb-257"), id: "test-haos-titan-nillious-late" };
  emitRuleEvent(lateState, {
    id: "nillious-open-before-evo",
    name: "BAKUGAN_OPENED",
    actorId: latePlayer.id,
    controllerId: latePlayer.id,
    targetBakuganId: lateBakugan.id,
    createdAt: Date.now(),
  });
  lateBakugan.evoStack = [lateTitan];
  assert.equal(
    lateState.batch.filter((object) => object.card.id === lateTitan.id).length,
    0,
    "Playing the Evo after the Bakugan has opened must not retroactively create the open trigger.",
  );
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
