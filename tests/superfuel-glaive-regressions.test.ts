import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, playCard, passPriority, submitCardChoice } from "../lib/game";
import { buildChoiceSchema } from "../lib/rules/choices";

function setup() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("GLAIVE", "bo1", [first, second]);
  state.phase = "power";
  state.turn = 2;
  state.priority = state.startingPlayer = first.id;
  first.bakugan[0].open = false;
  first.bakugan[1].open = true;
  const gear = { ...structuredClone(CARDS.find(c => c.catalogId === "av-102")!), id: "glaive" };
  first.hand = [gear];
  first.energyZone = Array.from({length: 4}, (_, i) => ({...CARDS[0], id: `energy-${i}`}));
  state.placements = [{playerId: second.id, core: second.cores[0], cell: "field-core", order: 1}];
  return {state, first, second, gear};
}

for (const accept of [false, true]) test(`Glaive prompts once before its independent core selections: ${accept}`, () => {
  const {state, first, gear} = setup();
  assert.deepEqual(buildChoiceSchema(state, first.id, gear).fields.map(f => f.id), ["targetBakuganId"]);
  let next = playCard(state, first.id, gear.id, {targetBakuganId: first.bakugan[0].id});
  assert.equal(next.batch.filter(e => e.kind === "trigger").length, 1);
  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.deepEqual(next.pendingChoice?.schema.fields.map(f => f.id), ["confirmed"]);
  next = submitCardChoice(next, first.id, {confirmed: accept});
  if (accept) {
    assert.deepEqual(next.pendingChoice?.schema.fields.map(f => f.id).sort(), ["coreCell", "secondaryTargetBakuganId"].sort());
    const recipients = next.pendingChoice!.schema.fields.find(f => f.id === "secondaryTargetBakuganId")!;
    assert.ok(!recipients.options.some(o => o.id === first.bakugan[0].id));
    next = submitCardChoice(next, first.id, {coreCell: "field-core", secondaryTargetBakuganId: first.bakugan[1].id});
  }
  assert.equal(next.pendingChoice, undefined);
  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);
  assert.equal(next.pendingChoice, undefined);
  assert.equal(next.batch.length, 0);
  assert.equal(next.players[0].bakugan[0].bakuGear?.[0]?.id, gear.id);
  assert.deepEqual(next.players[0].bakugan[1].heldCoreCells, accept ? ["field-core"] : []);
});


test("Poison Sting selects an attached enemy BakuCore separately from its Empower field Core", () => {
  const first = makePlayer("poison-first", "First", STARTER_DECKS[0]);
  const second = makePlayer("poison-second", "Second", STARTER_DECKS[1]);
  const state = createMatch("POISON-STING", "bo1", [first, second]);
  state.phase = "power";
  state.turn = 2;
  state.priority = state.startingPlayer = first.id;

  const poison = { ...structuredClone(CARDS.find((card) => card.catalogId === "sv-61")!), id: "poison-sting" };
  first.hand = [poison];
  first.energyZone = Array.from({ length: 5 }, (_, index) => ({ ...CARDS[0], id: `poison-energy-${index}` }));

  const enemy = second.bakugan[0];
  enemy.open = true;
  const heldCore = second.cores[0];
  const fieldCore = first.cores[0];
  enemy.heldCoreCells = ["enemy-held"];
  state.placements = [
    { playerId: second.id, core: heldCore, cell: "enemy-held", order: 1, attachedTo: enemy.id },
    { playerId: first.id, core: fieldCore, cell: "field-core", order: 2 },
  ];

  const schema = buildChoiceSchema(state, first.id, poison);
  assert.deepEqual(schema.fields.map((field) => field.id), ["coreCell", "empower"]);
  const removal = schema.fields.find((field) => field.id === "coreCell")!;
  assert.deepEqual(removal.options.map((option) => option.id), ["enemy-held"]);

  let next = playCard(state, first.id, poison.id, { coreCell: "enemy-held", empower: true });
  next = passPriority(next, next.priority);
  next = passPriority(next, next.priority);

  assert.ok(!next.players[1].bakugan[0].heldCoreCells.includes("enemy-held"));
  const empowerChoice = next.pendingChoice?.schema.fields ?? [];
  assert.deepEqual(
    empowerChoice.map((field) => field.id).sort(),
    ["secondaryCoreCell", "secondaryTargetBakuganId"].sort(),
  );
  assert.deepEqual(
    empowerChoice.find((field) => field.id === "secondaryCoreCell")?.options.map((option) => option.id),
    ["field-core"],
  );
});
