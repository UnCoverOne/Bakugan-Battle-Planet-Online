import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARD_BY_ID, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, prepareCardPlay, submitCardChoice } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
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
  prepared = prepareCardPlay(waneState.state, waneState.first.id, wane.id);
  const evoField = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetEvoId");
  assert.deepEqual(evoField?.options.map((option) => option.id), [oldEvo.id]);
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
