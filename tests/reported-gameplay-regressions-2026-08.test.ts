import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  emitGameEvent,
  passPriority,
  playCard,
  type Core,
  type GameCard,
  type MatchState,
  type RollOutcome,
} from "../lib/game";
import { playCardWithAutoEnergy } from "../lib/cardPayment";
import {
  legalCoreReturnCells,
  placeCoreOrReturnCore,
  type CoreReturnMatchState,
} from "../lib/coreReturns";
import { activePendingDraw, drawPendingCard } from "../lib/drawQueue";
import { advanceOpponentAi } from "../lib/opponentAi";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { emitRuleEvent } from "../lib/rules/triggers";
import { handDiscardRequirement } from "../components/game-screen-v2/matchHudState";

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

test("AI does not play Tides after the Victor has already been declared", () => {
  const ai = makePlayer("training-bot", "Opponent", STARTER_DECKS[0]);
  const human = makePlayer("human", "Player", STARTER_DECKS[1]);
  const tides = card("bb-24", "locked-victor-tides");
  ai.hand = [tides];
  addUntappedEnergy(ai, 1);
  ai.cardsPlayedThisTurn = 1;

  const state = createMatch("TIDESLOCK", "bo1", [ai, human]);
  state.turn = 2;
  state.phase = "victor";
  state.stepLabel = "Brawl Phase • Victor Step";
  state.startingPlayer = human.id;
  state.initialStartingPlayer = ai.id;
  state.priority = ai.id;
  state.brawlWinner = human.id;
  state.selected[ai.id] = ai.bakugan[0].id;
  state.selected[human.id] = human.bakugan[0].id;
  ai.bakugan[0].open = true;
  human.bakugan[0].open = true;
  ai.bakugan[0].bPower = 500;
  ai.bakugan[0].character.bPower = 500;
  human.bakugan[0].bPower = 800;
  human.bakugan[0].character.bPower = 800;
  state.rolls[ai.id] = successfulRoll(ai.id, ai.bakugan[0].id);
  state.rolls[human.id] = successfulRoll(human.id, human.bakugan[0].id);

  const next = advanceOpponentAi(state, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players.find((player) => player.id === ai.id)?.hand.some((candidate) => candidate.id === tides.id));
  assert.equal(next.brawlWinner, human.id);
  assert.equal(next.priority, human.id);
});

test("two legacy duplicate Magic Shield copies can both be returned while another is on the field", () => {
  const owner = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const state = createMatch("DUPMS", "bo1", [owner, opponent]) as CoreReturnMatchState;
  const staleId = "core-37";
  const magicShield = (name: string): Core => ({
    id: staleId,
    catalogId: "core-37",
    number: 37,
    name,
    type: "Magic Shield",
    bonus: 500,
    damageBonus: 0,
    art: "/assets/cores/full/37.webp",
  });

  state.phase = "retract";
  state.priority = owner.id;
  state.stepLabel = "Retracting Step • 2 BakuCores to return";
  state.placements = [{
    playerId: opponent.id,
    core: magicShield("Magic Shield already on field"),
    cell: CENTER_CELL,
    order: 1,
  }];
  state.pendingCoreReturns = [
    {
      id: "return-one",
      placerId: owner.id,
      ownerId: owner.id,
      core: magicShield("First returned Magic Shield"),
      originalCell: "held:first",
      sourceBakuganId: owner.bakugan[0].id,
      sequence: 1,
    },
    {
      id: "return-two",
      placerId: owner.id,
      ownerId: owner.id,
      core: magicShield("Second returned Magic Shield"),
      originalCell: "held:second",
      sourceBakuganId: owner.bakugan[1].id,
      sequence: 2,
    },
  ];
  state.coreReturnResume = {
    phase: "endPlay",
    stepLabel: "End Phase • Play Step",
    priority: owner.id,
    passes: [],
    deadline: Date.now() + 30_000,
  };

  const firstCell = legalCoreReturnCells(state)[0];
  assert.ok(firstCell);
  let returned = placeCoreOrReturnCore(state, owner.id, staleId, firstCell) as CoreReturnMatchState;
  assert.equal(returned.pendingCoreReturns?.length, 1);

  const secondCell = legalCoreReturnCells(returned)[0];
  assert.ok(secondCell);
  returned = placeCoreOrReturnCore(returned, owner.id, staleId, secondCell) as CoreReturnMatchState;

  const magicShields = returned.placements.filter((placement) => placement.core.type === "Magic Shield");
  assert.equal(magicShields.length, 3);
  assert.equal(new Set(magicShields.map((placement) => placement.core.id)).size, 3);
  assert.ok(magicShields.every((placement) => placement.core.catalogId === "core-37"));
  assert.equal(returned.phase, "endPlay");
  assert.equal(returned.pendingCoreReturns, undefined);
});

test("Bakugan Resurgence Shun enters play without drawing and draws only after a successful open", () => {
  const player = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const shun = card("br-77", "shun-resurgence-test");
  const drawCard = card("bb-10", "shun-draw-card");
  player.hand = [shun];
  player.deckCards = [drawCard];
  player.deck = 1;
  addUntappedEnergy(player, 3);

  let state = createMatch("SHUNOPEN", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = player.id;
  state.initialStartingPlayer = player.id;
  state.priority = player.id;
  state.selected[player.id] = player.bakugan[0].id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  player.bakugan[0].open = true;
  opponent.bakugan[0].open = true;

  const definition = ruleDefinitionForCard(shun);
  assert.ok(definition.abilities.some((ability) => ability.kind === "spell"));
  assert.ok(definition.abilities.some((ability) => (
    ability.kind === "triggered" && ability.trigger?.event === "BAKUGAN_OPENED"
  )));

  state = playCardWithAutoEnergy(state, player.id, shun.id);
  state = resolveTopBatchObject(state);
  const inPlay = state.players.find((candidate) => candidate.id === player.id)!;
  assert.ok(inPlay.heroes.some((hero) => hero.id === shun.id));
  assert.equal(inPlay.hand.length, 0);
  assert.equal(inPlay.deckCards.length, 1);
  assert.equal(activePendingDraw(state), null);

  emitRuleEvent(state, {
    id: "successful-open-after-shun",
    name: "BAKUGAN_OPENED",
    actorId: player.id,
    controllerId: player.id,
    targetBakuganId: player.bakugan[0].id,
    createdAt: Date.now(),
  });
  assert.ok(state.batch.some((object) => object.card.id === shun.id && object.kind === "trigger"));

  state = resolveTopBatchObject(state);
  assert.equal(activePendingDraw(state)?.sourceName, "Shun Kazami");
  state = drawPendingCard(state, player.id);

  const afterDraw = state.players.find((candidate) => candidate.id === player.id)!;
  assert.equal(afterDraw.deckCards.length, 0);
  assert.equal(afterDraw.hand.at(-1)?.id, drawCard.id);
});

test("Dragonoid Maximus wins when its controller has Dan, Wynton, and Lia", () => {
  const player = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const opponent = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const titanSource = BAKUGAN.find((bakugan) => bakugan.id === "ex-1");
  assert.ok(titanSource);
  const titan = {
    ...titanSource,
    id: "ex-titan-alpha",
    character: { ...titanSource.character, id: "ex-titan-character-alpha" },
    open: true,
    heldCoreCells: [],
    evoStack: [],
  };
  player.bakugan[0] = titan;
  player.heroes = [
    card("bb-207", "dan-for-maximus"),
    card("bb-215", "wynton-for-maximus"),
    card("bb-202", "lia-for-maximus"),
  ];
  const maximus = card("ex-2", "maximus-alternate-win");
  player.hand = [maximus];
  addUntappedEnergy(player, 10);

  let state = createMatch("EXMAXWIN", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = player.id;
  state.initialStartingPlayer = player.id;
  state.priority = player.id;
  state.selected[player.id] = titan.id;

  state = playCardWithAutoEnergy(state, player.id, maximus.id, { targetBakuganId: titan.id });
  state = resolveTopBatchObject(state);

  assert.equal(state.phase, "result");
  assert.equal(state.winner, player.id);
  assert.equal(state.series[player.id], 1);
  assert.equal(state.resultReason, "Dragonoid Maximus's alternate win condition");
});

test("normal simultaneous opens trigger Lia and Shargo for both players on every occurrence", () => {
  const alpha = makePlayer("a", "Alpha", STARTER_DECKS[0]);
  const beta = makePlayer("b", "Beta", STARTER_DECKS[1]);
  const shargo = card("br-79", "shargo-open-source");
  const lia = card("aa-71", "lia-open-source");
  alpha.heroes = [shargo];
  beta.heroes = [lia];

  const state = createMatch("OPENEVERY", "bo1", [alpha, beta]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = alpha.id;
  state.priority = alpha.id;
  state.selected[alpha.id] = alpha.bakugan[0].id;
  state.selected[beta.id] = beta.bakugan[0].id;
  alpha.bakugan[0].open = true;
  beta.bakugan[0].open = true;

  emitGameEvent(state, {
    id: "turn-2-open-occurrence-1",
    type: "open",
    playerId: "*",
    playerIds: [alpha.id, beta.id],
  });
  assert.deepEqual(
    state.batch.map((effect) => effect.card.id).sort(),
    [lia.id, shargo.id].sort(),
  );
  assert.equal(state.batch.find((effect) => effect.card.id === shargo.id)?.choices.targetBakuganId, alpha.bakugan[0].id);
  assert.equal(state.batch.find((effect) => effect.card.id === lia.id)?.choices.targetBakuganId, beta.bakugan[0].id);

  emitGameEvent(state, {
    id: "turn-2-open-occurrence-2",
    type: "open",
    playerId: "*",
    playerIds: [alpha.id, beta.id],
  });
  assert.equal(state.batch.filter((effect) => effect.card.id === shargo.id).length, 2);
  assert.equal(state.batch.filter((effect) => effect.card.id === lia.id).length, 2);

  emitGameEvent(state, {
    id: "turn-2-open-occurrence-2",
    type: "open",
    playerId: "*",
    playerIds: [alpha.id, beta.id],
  });
  assert.equal(state.batch.length, 4);
});

test("Sifting Ashes completes both manual draws before offering the discard", () => {
  const player = makePlayer("sifting-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("sifting-opponent", "Opponent", STARTER_DECKS[1]);
  const sifting = card("bb-108", "sifting-ashes-test");
  player.hand = [sifting, ...player.hand];
  const drawnIds = player.deckCards.slice(0, 2).map((candidate) => candidate.id);
  addUntappedEnergy(player, 1);

  let state = createMatch("SIFTORDER", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const instructions = ruleDefinitionForCard(sifting).abilities.flatMap((ability) => ability.instructions);
  assert.deepEqual(instructions.map((instruction) => instruction.actions.map((action) => action.kind)), [
    ["draw"],
    ["discard"],
  ]);
  assert.equal(instructions[0].choices.length, 0);
  assert.deepEqual(instructions[1].choices.map((choice) => choice.id), ["discardCardIds"]);

  state = playCard(state, player.id, sifting.id);
  state = resolveTopBatchObject(state);
  assert.equal(activePendingDraw(state)?.remaining, 2);
  assert.equal(state.pendingChoice, undefined, "discard is not requested before the draws");

  state = drawPendingCard(state, player.id);
  state = drawPendingCard(state, player.id);
  const discard = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.ok(discard);
  assert.equal(discard.minimum, 2);
  assert.ok(drawnIds.every((id) => discard.options.some((option) => option.id === id)));
});

test("Aquos Hyper Cubbo applies its held-Core bonus exactly once after evolving", () => {
  const player = makePlayer("cubbo-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("cubbo-opponent", "Opponent", STARTER_DECKS[1]);
  const character = card("br-167", "aquos-cubbo-character");
  const hyper = card("aa-80", "aquos-hyper-cubbo");
  const bakugan = player.bakugan[0];
  Object.assign(bakugan, {
    character,
    name: character.name,
    faction: character.faction,
    bPower: character.bPower ?? 0,
    damage: character.damage ?? 0,
    open: true,
    evoStack: [],
    heldCoreCells: [CENTER_CELL],
  });
  player.hand = [hyper, ...player.hand];
  addUntappedEnergy(player, 2);

  let state = createMatch("CUBBO800", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = player.id;
  state.priority = player.id;
  state.selected[player.id] = bakugan.id;
  state.placements = [{
    playerId: player.id,
    core: { id: "cubbo-ms", number: 0, name: "Magic Shield", type: "Magic Shield", bonus: 0, damageBonus: 0, art: "" },
    cell: CENTER_CELL,
    order: 1,
    attachedTo: bakugan.id,
    revealed: true,
  }];

  const modifier = ruleDefinitionForCard(hyper).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.actions)
    .find((action) => action.kind === "modify-stat");
  assert.ok(modifier && modifier.kind === "modify-stat");
  assert.equal(modifier.duration, "while-source-active");

  state = playCard(state, player.id, hyper.id, { targetBakuganId: bakugan.id });
  state = resolveTopBatchObject(state);
  const evolvedPlayer = state.players.find((candidate) => candidate.id === player.id)!;
  const evolved = evolvedPlayer.bakugan.find((candidate) => candidate.id === bakugan.id)!;
  const characteristics = evaluateBakuganCharacteristics(state, evolved, evolvedPlayer);
  assert.equal(characteristics.power, 1_100);
  assert.equal(state.powerBoost[evolved.id] ?? 0, 0, "the intrinsic +800 is not also stored as a temporary bonus");
  assert.equal(characteristics.applied.filter((entry) => entry.sourceId === hyper.id && entry.stat === "power").length, 1);
});

test("discard choices and hand-limit cleanup are represented by the in-hand HUD contract", () => {
  const player = makePlayer("discard-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("discard-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("HUDDISCARD", "bo1", [player, opponent]);
  const available = player.hand.slice(0, 2);
  state.pendingChoice = {
    id: "discard-choice",
    kind: "resolution",
    controllerId: player.id,
    cardId: "source",
    schema: {
      id: "discard-schema",
      sourceId: "source",
      sourceName: "Discard effect",
      controllerId: player.id,
      timing: "resolve",
      simultaneous: false,
      fields: [{
        id: "discardCardIds",
        kind: "hand-cards",
        label: "Choose two cards to discard",
        chooserId: player.id,
        visibility: "private",
        timing: "resolve",
        minimum: 2,
        maximum: 2,
        required: true,
        options: available.map((candidate) => ({ id: candidate.id, label: candidate.name, ownerId: player.id })),
      }],
    },
    answers: {},
    createdVersion: state.version,
  };
  assert.deepEqual(handDiscardRequirement(state, player.id), {
    minimum: 2,
    maximum: 2,
    optionIds: available.map((candidate) => candidate.id),
    source: "choice",
  });

  state.pendingChoice = undefined;
  player.hand.push(...player.deckCards.splice(0, 3));
  state.phase = "handLimit";
  state.priority = player.id;
  const handLimit = handDiscardRequirement(state, player.id);
  assert.equal(handLimit?.source, "hand-limit");
  assert.equal(handLimit?.minimum, player.hand.length - 7);
});

test("the catalogue does not invent discard choices from ordinary hand-card wording", () => {
  const exposed = CARDS.filter((candidate) => (
    /cards? from your hand/i.test(candidate.effect)
    && !/discard/i.test(candidate.effect)
    && ruleDefinitionForCard(candidate).abilities.some((ability) => ability.instructions.some((instruction) => (
      instruction.choices.some((choice) => choice.id === "discardCardIds")
    )))
  ));
  assert.deepEqual(exposed.map((candidate) => candidate.catalogId), []);
  for (const catalogId of ["bb-152", "aa-112"]) {
    const source = card(catalogId, `${catalogId}-cost-test`);
    const definition = ruleDefinitionForCard(source);
    assert.ok(definition.play.choices.some((choice) => choice.id === "discardCardIds" && choice.timing === "pay"));
    assert.equal(definition.abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.actions).some((action) => action.kind === "discard"), false);
  }
});
