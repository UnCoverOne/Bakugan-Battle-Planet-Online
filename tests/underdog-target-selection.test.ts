import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, prepareCardPlay, submitCardChoice } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { buildChoiceSchema, schemaHasLegalCompletion } from "../lib/rules/choices";
import { parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { collectRuleTriggers } from "../lib/rules/triggers";
import { createRuleObject } from "../lib/rules/objects";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const card = (id: string, instance = id) => {
  const template = CARD_BY_ID.get(id);
  assert.ok(template, `Missing ${id}`);
  return { ...structuredClone(template), id: instance };
};

function underdogState(ownPower: number, opposingPower: number) {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("UNDERDOG", "bo1", [first, second]);
  state.turn = 4;
  state.phase = "power";
  const cubbo = card("aa-106", "darkus-hyper-cubbo");
  first.bakugan[0].evoStack = [{ ...cubbo, bPower: ownPower }];
  first.bakugan[0].open = true;
  second.bakugan[0].character = { ...second.bakugan[0].character, bPower: opposingPower };
  second.bakugan[0].bPower = opposingPower;
  second.bakugan[0].open = true;
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  return { state, first, second, cubbo };
}

test("Underdog is a typed intervening condition for every printed Underdog trigger", () => {
  const underdogIds = ["aa-82", "aa-85", "aa-91", "aa-94", "aa-106", "aa-125", "aa-143", "aa-148", "aa-155", "aa-161", "aa-167", "aa-171", "aa-178", "aa-197", "aa-201", "aa-220"];
  for (const id of underdogIds) {
    const definition = ruleDefinitionForCard(card(id));
    const trigger = definition.abilities.find((ability) => ability.kind === "triggered")?.trigger;
    assert.equal(trigger?.interveningCondition?.kind, "underdog", id);
  }
});

test("Darkus Hyper Cubbo enters the Batch only while its opening Bakugan is the Underdog", () => {
  const lower = underdogState(400, 700);
  const lowerTriggers = collectRuleTriggers(lower.state, {
    id: "open-lower",
    name: "BAKUGAN_OPENED",
    actorId: lower.first.id,
    controllerId: lower.first.id,
    targetBakuganId: lower.first.bakugan[0].id,
    createdAt: Date.now(),
  });
  assert.equal(lowerTriggers.some((effect) => effect.card.catalogId === "aa-106"), true);

  const equal = underdogState(700, 700);
  const equalTriggers = collectRuleTriggers(equal.state, {
    id: "open-equal",
    name: "BAKUGAN_OPENED",
    actorId: equal.first.id,
    controllerId: equal.first.id,
    targetBakuganId: equal.first.bakugan[0].id,
    createdAt: Date.now(),
  });
  assert.equal(equalTriggers.some((effect) => effect.card.catalogId === "aa-106"), false);

  const higher = underdogState(900, 700);
  const higherTriggers = collectRuleTriggers(higher.state, {
    id: "open-higher",
    name: "BAKUGAN_OPENED",
    actorId: higher.first.id,
    controllerId: higher.first.id,
    targetBakuganId: higher.first.bakugan[0].id,
    createdAt: Date.now(),
  });
  assert.equal(higherTriggers.some((effect) => effect.card.catalogId === "aa-106"), false);
});

function priorityState() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("TARGETS", "bo1", [first, second]);
  state.turn = 3;
  state.phase = "power";
  state.priority = first.id;
  first.energyZone = Array.from({ length: 10 }, (_, index) => card("bb-2", `first-energy-${index}`));
  first.maxEnergy = first.energyZone.length;
  return { state, first, second };
}

function objectFor(controllerId: string, source: ReturnType<typeof card>, kind: "card" | "trigger" | "copy" = "card") {
  const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind !== "triggered")
    ?? ruleDefinitionForCard(source).abilities[0];
  assert.ok(ability);
  return createRuleObject({ controllerId, card: source, ability, kind });
}

test("Deep Illusion targets only the initial Hero card play before it enters the Batch", () => {
  const { state, first, second } = priorityState();
  const deepIllusion = card("bb-6", "deep-illusion");
  first.hand = [deepIllusion];
  const heroPlay = objectFor(second.id, card("bb-202", "hero-play"), "card");
  const heroTrigger = objectFor(second.id, card("bb-202", "hero-trigger"), "trigger");
  const actionPlay = objectFor(second.id, card("bb-2", "action-play"), "card");
  state.batch = [heroPlay, heroTrigger, actionPlay];

  const prepared = prepareCardPlay(state, first.id, deepIllusion.id);
  assert.equal(prepared.batch.some((effect) => effect.card.id === deepIllusion.id), false);
  assert.equal(prepared.players[0].hand.some((candidate) => candidate.id === deepIllusion.id), true);
  const field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEffectId");
  assert.deepEqual(field?.options.map((option) => option.id), [heroPlay.id]);

  assert.throws(() => submitCardChoice(prepared, first.id, { targetEffectId: heroTrigger.id }), /illegal selection/i);
  const played = submitCardChoice(prepared, first.id, { targetEffectId: heroPlay.id });
  const object = played.batch.find((effect) => effect.card.id === deepIllusion.id);
  assert.equal(object?.choices.targetEffectId, heroPlay.id);
});

test("Blinding Ink filters Batch targets by Action type, initial card play, and printed cost", () => {
  const { state, first, second } = priorityState();
  const ink = card("br-3", "blinding-ink");
  first.hand = [ink];
  const cheap = objectFor(second.id, card("br-4", "cheap-action"), "card");
  const expensive = objectFor(second.id, card("bb-1", "expensive-action"), "card");
  const actionTrigger = objectFor(second.id, card("br-4", "action-trigger"), "trigger");
  const hero = objectFor(second.id, card("bb-202", "hero-card"), "card");
  state.batch = [cheap, expensive, actionTrigger, hero];

  const prepared = prepareCardPlay(state, first.id, ink.id);
  const field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEffectId");
  assert.deepEqual(field?.options.map((option) => option.id), [cheap.id]);
});

test("printed permanent-card restrictions are enforced before Batch entry", () => {
  const { state, first, second } = priorityState();
  const gaze = card("bb-37", "garganoid-gaze");
  first.hand = [gaze];
  second.heroes = [card("bb-201", "cheap-hero"), card("bb-202", "expensive-hero")];
  second.heroes[0].cost = 4;
  second.heroes[1].cost = 5;
  let prepared = prepareCardPlay(state, first.id, gaze.id);
  const heroField = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetHeroId");
  assert.deepEqual(heroField?.options.map((option) => option.id), [second.heroes[0].id]);

  const waneState = priorityState();
  const wane = card("bb-80", "wane");
  waneState.first.hand = [wane];
  const oldEvo = card("bb-231", "old-evo");
  const newEvo = card("bb-232", "new-evo");
  oldEvo.playedTurn = waneState.state.turn - 1;
  newEvo.playedTurn = waneState.state.turn;
  waneState.second.bakugan[0].evoStack = [oldEvo, newEvo];
  assert.throws(
    () => prepareCardPlay(waneState.state, waneState.first.id, wane.id),
    /no legal targets/i,
  );
  newEvo.playedTurn = waneState.state.turn - 1;
  prepared = prepareCardPlay(waneState.state, waneState.first.id, wane.id);
  const evoField = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEvoId");
  assert.deepEqual(evoField?.options.map((option) => option.id), [newEvo.id]);
});

test("click targeting is wired to Batch, Hero, Evo, Energy, Bakugan, and BakuCore entities", async () => {
  const [choice, screen, batch, image, css] = await Promise.all([
    read("components/game-screen-v2/ChoiceQueueLayer.tsx"),
    read("components/game-screen-v2/GameScreen.tsx"),
    read("components/game-screen-v2/BrawlExperienceLayer.tsx"),
    read("components/game-screen-v2/ResponsiveCardImage.tsx"),
    read("components/game-screen-v2/ChoiceQueueLayer.module.css"),
  ]);
  for (const contract of ["batch-object", "hero", "evo", "energy", "bakugan", "core", "data-choice-target-valid", "Only highlighted legal targets"] ) assert.match(choice, new RegExp(contract));
  assert.match(batch, /data-rule-object-id=\{effect\.id\}/);
  assert.match(screen, /data-evo-card-id=\{bakugan\?\.evoStack\.at\(-1\)\?\.id\}/);
  assert.match(screen, /dataCardId=\{card\.id\}/);
  assert.match(image, /data-card-id=\{dataCardId\}/);
  assert.match(css, /legal-target-pulse/);
  assert.match(css, /pointer-events:none!important/);
});


test("required announcement targets cannot become optional when no legal object exists", () => {
  const { state, first } = priorityState();
  const deep = card("bb-6", "deep-no-target");
  first.hand = [deep];
  assert.throws(() => prepareCardPlay(state, first.id, deep.id), /no legal targets/i);
  const schema = buildChoiceSchema(state, first.id, deep);
  assert.equal(schema.fields.find((field) => field.id === "targetEffectId")?.minimum, 1);
  assert.equal(schemaHasLegalCompletion(schema), false);
});

test("mass Core removal stays targetless and Shadow Breath can target only an opposing Hero", () => {
  const inferno = ruleDefinitionForCard(card("bb-99"));
  assert.equal(inferno.play.choices.some((candidate) => candidate.id === "coreCell"), false);

  const { state, first, second } = priorityState();
  const shadow = card("bb-154", "shadow-breath");
  first.heroes = [card("bb-201", "friendly-hero")];
  second.heroes = [card("bb-202", "enemy-hero")];
  const schema = buildChoiceSchema(state, first.id, shadow);
  const field = schema.fields.find((candidate) => candidate.id === "targetHeroId");
  assert.deepEqual(field?.options.map((candidate) => candidate.id), ["enemy-hero"]);
});

test("Implosion locks exactly one normal target or two Fury targets before Batch entry", () => {
  const normal = priorityState();
  const implosion = card("bb-97", "implosion-normal");
  normal.first.hand = [implosion, card("bb-2", "remaining-card")];
  normal.second.energyZone = [card("bb-3", "energy-a"), card("bb-4", "energy-b")];
  let prepared = prepareCardPlay(normal.state, normal.first.id, implosion.id);
  let field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEnergyIds");
  assert.equal(field?.minimum, 1);
  assert.equal(field?.maximum, 1);

  const fury = priorityState();
  const furyImplosion = card("bb-97", "implosion-fury");
  fury.first.hand = [furyImplosion];
  fury.second.energyZone = [card("bb-3", "fury-energy-a"), card("bb-4", "fury-energy-b")];
  prepared = prepareCardPlay(fury.state, fury.first.id, furyImplosion.id);
  field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEnergyIds");
  assert.equal(field?.minimum, 2);
  assert.equal(field?.maximum, 2);

  const short = priorityState();
  const shortImplosion = card("bb-97", "implosion-short");
  short.first.hand = [shortImplosion];
  short.second.energyZone = [card("bb-3", "only-energy")];
  assert.throws(() => prepareCardPlay(short.state, short.first.id, shortImplosion.id), /no legal targets/i);
});

test("trigger source Bakugan is separate from an actual target and another excludes the source", () => {
  const { state, first, second } = priorityState();
  const phaedrus = card("aa-83", "phaedrus-source");
  first.bakugan[0].open = true;
  first.bakugan[0].evoStack = [phaedrus];
  first.bakugan[1].open = true;
  second.bakugan[0].open = true;
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  state.brawlWinner = first.id;
  const [trigger] = collectRuleTriggers(state, {
    id: "victor-phaedrus",
    name: "VICTOR_DECLARED",
    actorId: first.id,
    controllerId: first.id,
    targetBakuganId: first.bakugan[0].id,
    createdAt: Date.now(),
  }).filter((candidate) => candidate.card.id === phaedrus.id);
  assert.ok(trigger);
  assert.equal(trigger.choices.sourceBakuganId, first.bakugan[0].id);
  assert.equal(trigger.choices.targetBakuganId, undefined);
  const instruction = ruleDefinitionForCard(phaedrus).abilities.find((ability) => ability.kind === "triggered")!.instructions[0];
  const schema = buildChoiceSchema(state, first.id, phaedrus, instruction.sourceText, trigger.choices, "resolve");
  const field = schema.fields.find((candidate) => candidate.id === "targetBakuganId");
  assert.equal(field?.options.some((candidate) => candidate.id === first.bakugan[0].id), false);
  assert.equal(field?.options.some((candidate) => candidate.id === first.bakugan[1].id), true);
});

test("When-you-play targets are announced before Batch entry and copied onto the trigger", () => {
  const { state, first } = priorityState();
  const magnus = card("bb-199", "magnus-targeted-trigger");
  first.hand = [magnus];
  const prepared = prepareCardPlay(state, first.id, magnus.id);
  assert.equal(prepared.batch.some((candidate) => candidate.card.id === magnus.id), false);
  const field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetBakuganId");
  assert.ok(field?.options.length);
  const targetId = field!.options[0].id;
  const played = submitCardChoice(prepared, first.id, { targetBakuganId: targetId });
  const trigger = played.batch.find((candidate) => candidate.kind === "trigger" && candidate.card.id === magnus.id);
  assert.equal(trigger?.choices.targetBakuganId, targetId);
});

test("target grammar covers faction Bakugan, Ventus Trap's two targets, and visible cards in play", () => {
  const karmic = ruleDefinitionForCard(card("br-32"));
  const karmicTarget = karmic.play.choices.find((candidate) => candidate.id === "targetBakuganId");
  assert.deepEqual(karmicTarget?.factions, ["Haos"]);

  const trap = card("aa-50");
  const trapDefinition = ruleDefinitionForCard(trap);
  assert.deepEqual(
    trapDefinition.play.choices.filter((candidate) => candidate.timing === "announce").map((candidate) => candidate.id),
    ["targetBakuganId", "secondaryTargetBakuganId"],
  );
  const trapActions = parseAtomicEffects(trap, trap.effect).filter((candidate) => candidate.kind === "modify-stat");
  assert.deepEqual(trapActions.map((candidate) => candidate.kind === "modify-stat" ? candidate.targetChoiceId : undefined), [
    "targetBakuganId",
    "secondaryTargetBakuganId",
  ]);

  const floodState = priorityState();
  const flood = card("br-63", "flash-flood");
  floodState.second.heroes = [card("bb-202", "flood-hero")];
  floodState.second.bakugan[0].evoStack = [card("bb-231", "covered-evo"), card("bb-232", "top-evo")];
  const schema = buildChoiceSchema(floodState.state, floodState.first.id, flood);
  const field = schema.fields.find((candidate) => candidate.id === "targetCardId");
  assert.deepEqual(field?.options.map((candidate) => candidate.id), ["flood-hero", "top-evo"]);
});

test("target-click state updates are functional and generic card targets use visible entities", async () => {
  const choice = await read("components/game-screen-v2/ChoiceQueueLayer.tsx");
  assert.match(choice, /setAnswers\(\(current\) => \{/);
  assert.match(choice, /valuesFor\(current, field\)/);
  assert.match(choice, /field\.kind === "card"/);
  assert.match(choice, /data-evo-card-id/);
});
