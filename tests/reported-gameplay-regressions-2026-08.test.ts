import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  completeCoinFlip,
  createMatch,
  emitGameEvent,
  flipStopsDamage,
  passPriority,
  playCard,
  resolveStructuredEffect,
  submitCardChoice,
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
import { activeTappedEnergyIds } from "../lib/rules/costs";
import { conditionFor } from "../lib/rules/catalogue-primitives";
import { compileCardEffect } from "../lib/rules/effects";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { createRuleObject } from "../lib/rules/objects";
import { dispatchRulesCommand } from "../lib/rules/runtime";
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
}

function resolveTopBatchObject(state: MatchState) {
  state = passPriority(state, state.priority);
  return passPriority(state, state.priority);
}

function cyclingPowerState(catalogId: string) {
  const controller = makePlayer(`cycling-${catalogId}-controller`, "Cycling Controller", STARTER_DECKS[0]);
  const opponent = makePlayer(`cycling-${catalogId}-opponent`, "Cycling Opponent", STARTER_DECKS[1]);
  const cycling = card(catalogId, `cycling-${catalogId}-instance`);
  const state = createMatch(`CYCLING-${catalogId}`, "bo1", [controller, opponent]);
  const liveController = state.players.find((player) => player.id === controller.id)!;
  const liveOpponent = state.players.find((player) => player.id === opponent.id)!;
  liveController.hand = [cycling];
  liveController.energy = 10;
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = liveController.id;
  state.initialStartingPlayer = liveController.id;
  state.priority = liveController.id;
  state.selected[liveController.id] = liveController.bakugan[0].id;
  state.selected[liveOpponent.id] = liveOpponent.bakugan[0].id;
  liveController.bakugan[0].open = true;
  liveOpponent.bakugan[0].open = true;
  state.rolls[liveController.id] = successfulRoll(liveController.id, liveController.bakugan[0].id);
  state.rolls[liveOpponent.id] = successfulRoll(liveOpponent.id, liveOpponent.bakugan[0].id);
  return { state, controllerId: liveController.id, opponentId: liveOpponent.id, cycling };
}

test("Cycling stat Actions resolve their primary effect and return to the owner deck bottom", () => {
  for (const [catalogId, stat, amount] of [
    ["bb-64", "power", 200],
    ["bb-85", "damage", 2],
    ["bb-113", "damage", -8],
  ] as const) {
    const setup = cyclingPowerState(catalogId);
    const targetId = setup.state.selected[catalogId === "bb-113" ? setup.opponentId : setup.controllerId];
    let state = playCard(setup.state, setup.controllerId, setup.cycling.id);
    state = resolveTopBatchObject(state);
    const owner = state.players.find((player) => player.id === setup.controllerId)!;
    assert.equal(owner.deckCards.at(-1)?.id, setup.cycling.id, `${catalogId} should be the bottom card`);
    assert.equal(owner.discard.some((card) => card.id === setup.cycling.id), false);
    assert.equal(stat === "power" ? state.powerBoost[targetId] : state.damageBoost[targetId], amount);
    assert.ok(state.log.some((entry) => entry.message.includes("returned to the bottom")));
  }
});

test("Cycling Thoughts finishes its queued draws before returning to the owner deck bottom", () => {
  const setup = cyclingPowerState("bb-5");
  const handBefore = setup.state.players.find((player) => player.id === setup.controllerId)!.hand.length;
  let state = playCard(setup.state, setup.controllerId, setup.cycling.id);
  state = resolveTopBatchObject(state);
  assert.equal(activePendingDraw(state)?.playerId, setup.controllerId);
  assert.equal(activePendingDraw(state)?.remaining, 2);
  state = drawPendingCard(state, setup.controllerId);
  state = drawPendingCard(state, setup.controllerId);
  const owner = state.players.find((player) => player.id === setup.controllerId)!;
  assert.equal(activePendingDraw(state), null);
  assert.equal(owner.hand.length, handBefore - 1 + 2);
  assert.equal(owner.deckCards.at(-1)?.id, setup.cycling.id);
  assert.equal(owner.discard.some((card) => card.id === setup.cycling.id), false);
  assert.equal(state.batch.some((effect) => effect.card.id === setup.cycling.id), false);
});

test("Cycling Madness draws for its controller, makes the opponent discard, then recycles", () => {
  const setup = cyclingPowerState("bb-33");
  const opponentBefore = setup.state.players.find((player) => player.id === setup.opponentId)!.hand.length;
  let state = playCard(setup.state, setup.controllerId, setup.cycling.id);
  state = resolveTopBatchObject(state);
  assert.equal(activePendingDraw(state)?.playerId, setup.controllerId);
  state = drawPendingCard(state, setup.controllerId);

  const discardField = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.equal(discardField?.chooserId, setup.opponentId);
  assert.equal(discardField?.options.every((option) => option.ownerId === setup.opponentId), true);
  assert.ok(discardField?.options[0]);
  state = submitCardChoice(state, setup.opponentId, { discardCardIds: [discardField.options[0].id] });

  const owner = state.players.find((player) => player.id === setup.controllerId)!;
  const opponent = state.players.find((player) => player.id === setup.opponentId)!;
  assert.equal(opponent.hand.length, opponentBefore - 1);
  assert.equal(owner.deckCards.at(-1)?.id, setup.cycling.id);
  assert.equal(owner.discard.some((card) => card.id === setup.cycling.id), false);
  assert.equal(state.batch.some((effect) => effect.card.id === setup.cycling.id), false);
});

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
    const alternative = definition.play.costModifiers.find((modifier) => modifier.kind === "cost-alternative");
    assert.ok(alternative);
    assert.ok(alternative.components.some((component) => component.kind === "cost-discard" && component.choiceId === "discardCardIds"));
    assert.equal(definition.play.choices.some((choice) => choice.id === "discardCardIds" && choice.timing === "pay"), false);
    assert.equal(definition.abilities.flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.actions).some((action) => action.kind === "discard"), false);
  }
});


test("typed Energize actions preserve charged and uncharged entry state", () => {
  const trox = card("bb-373", "entry-state-trox");
  const troxAction = ruleDefinitionForCard(trox).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(troxAction && troxAction.kind === "energize");
  assert.equal(troxAction.source, "hand");
  assert.equal(troxAction.enters, "uncharged");

  const chargedCard = CARDS.find((candidate) => (
    /energize the top two cards of their deck/i.test(candidate.effect)
    && !/uncharged/i.test(candidate.effect)
  ));
  assert.ok(chargedCard);
  const chargedAction = ruleDefinitionForCard(chargedCard).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(chargedAction && chargedAction.kind === "energize");
  assert.equal(chargedAction.source, "deck");
  assert.equal(chargedAction.enters, "charged");
});

test("Ventus Trox Ultra energizes the selected hand card uncharged", () => {
  const player = makePlayer("trox-player", "Trox Player", STARTER_DECKS[0]);
  const opponent = makePlayer("trox-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("TROXENERGY", "bo1", [player, opponent]);
  state.turn = 4;
  state.phase = "victor";
  state.stepLabel = "Brawl Phase • Victor Step";
  state.startingPlayer = player.id;
  state.priority = player.id;
  state.brawlWinner = player.id;

  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const trox = card("bb-373", "runtime-trox");
  const existing = card("bb-10", "existing-charged-energy");
  const fodder = card("bb-17", "selected-hand-energy");
  live.hand = [fodder];
  live.energyZone = [existing];
  live.energy = 0;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).energyTapTurn = state.turn;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).tappedEnergyIds = [];
  live.bakugan[0].character = trox;
  live.bakugan[0].open = true;
  state.selected[live.id] = live.bakugan[0].id;

  const ability = ruleDefinitionForCard(trox).abilities.find((candidate) => (
    candidate.trigger?.event === "VICTOR_DECLARED"
  ));
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: live.id,
    card: trox,
    ability,
    kind: "trigger",
    sourceId: trox.id,
    choices: { sourceBakuganId: live.bakugan[0].id },
  });

  let resolving = resolveStructuredEffect(state, pending);
  assert.ok(resolving.pendingChoice);
  assert.ok(resolving.pendingChoice.schema.fields.some((field) => field.id === "confirmed"));
  assert.ok(resolving.pendingChoice.schema.fields.some((field) => field.id === "handCardIds"));
  resolving = submitCardChoice(resolving, live.id, {
    confirmed: true,
    handCardIds: [fodder.id],
  });

  const after = resolving.players.find((candidate) => candidate.id === live.id)!;
  assert.equal(after.hand.some((candidate) => candidate.id === fodder.id), false);
  assert.equal(after.energyZone.some((candidate) => candidate.id === fodder.id), true);
  assert.equal(after.energyZone.length, 2);
  assert.deepEqual(activeTappedEnergyIds(after, resolving.turn), [fodder.id]);
  assert.equal(activeTappedEnergyIds(after, resolving.turn).includes(existing.id), false);
});

test("unqualified Energize effects add Energy cards charged", () => {
  const player = makePlayer("charged-player", "Charged Player", STARTER_DECKS[0]);
  const opponent = makePlayer("charged-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("CHARGEDENERGY", "bo1", [player, opponent]);
  state.turn = 3;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const source = CARDS.find((candidate) => (
    /energize the top two cards of their deck/i.test(candidate.effect)
    && !/uncharged/i.test(candidate.effect)
  ));
  assert.ok(source);
  const sourceCard = { ...source, id: "charged-energize-source" };
  const oldEnergy = card("bb-10", "already-uncharged-energy");
  const first = card("bb-17", "new-charged-energy-one");
  const second = card("bb-18", "new-charged-energy-two");
  live.energyZone = [oldEnergy];
  live.energy = 0;
  live.deckCards = [first, second];
  live.deck = 2;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).energyTapTurn = state.turn;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).tappedEnergyIds = [oldEnergy.id];

  const ability = ruleDefinitionForCard(sourceCard).abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: live.id,
    card: sourceCard,
    ability,
    kind: "card",
  });
  let resolving = resolveStructuredEffect(state, pending);
  assert.ok(resolving.pendingChoice);
  resolving = submitCardChoice(resolving, live.id, { confirmed: true });
  if (resolving.pendingChoice?.schema.fields.some((field) => field.chooserId === opponent.id)) {
    resolving = submitCardChoice(resolving, opponent.id, { confirmed: false });
  }

  const after = resolving.players.find((candidate) => candidate.id === live.id)!;
  assert.deepEqual(after.energyZone.map((candidate) => candidate.id), [oldEnergy.id, first.id, second.id]);
  assert.deepEqual(activeTappedEnergyIds(after, resolving.turn), [oldEnergy.id]);
  assert.equal(after.energyZone.length, 3);
  assert.equal(after.deck, 0);
});


// Coin flip resolution regressions (2026-08-15)
function lostAtSeaDamageState() {
  const defender = makePlayer("coin-defender", "Defender", STARTER_DECKS[0]);
  const attacker = makePlayer("coin-attacker", "Attacker", STARTER_DECKS[1]);
  const lostAtSea = card("br-62", "lost-at-sea-coin-test");
  defender.discard = [lostAtSea];
  addUntappedEnergy(defender, 2);
  const state = createMatch("COINFLIP", "bo1", [defender, attacker]);
  state.turn = 2;
  state.phase = "damage";
  state.stepLabel = "Damage Step • Flip decision • 3 remaining";
  state.startingPlayer = attacker.id;
  state.initialStartingPlayer = defender.id;
  state.priority = defender.id;
  state.pendingLoser = defender.id;
  state.pendingDamage = 3;
  state.damageOrigin = attacker.bakugan[0].id;
  state.damageFaction = attacker.bakugan[0].faction;
  state.revealedFlip = lostAtSea;
  state.selected[defender.id] = defender.bakugan[0].id;
  state.selected[attacker.id] = attacker.bakugan[0].id;
  defender.bakugan[0].open = true;
  attacker.bakugan[0].open = true;
  return { state, defender, attacker, lostAtSea };
}

test("Lost at Sea compiles a coin flip followed by a heads-gated Stop", () => {
  const lostAtSea = card("br-62", "lost-at-sea-compiler-test");
  const program = compileCardEffect(lostAtSea);
  assert.equal(program.instructions.length, 2);
  assert.equal(program.instructions[0].effects[0]?.kind, "coin-flip");
  assert.deepEqual(program.instructions[1].condition, { kind: "coin-result", result: "heads" });
  assert.ok(program.instructions[1].effects.some((effect) => (
    effect.kind === "grant-keyword" && effect.keyword === "Stop"
  )));

  assert.deepEqual(
    conditionFor("If tails, draw a card."),
    { kind: "coin-result", result: "tails" },
  );
});

test("Lost at Sea heads lands through the coin animation gate and stops the attack", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });

  assert.equal(state.pendingCoinFlip?.sourceName, "Lost at Sea");
  assert.ok(["heads", "tails"].includes(state.pendingCoinFlip?.result ?? ""));
  assert.ok(state.batch.some((effect) => effect.card.id === lostAtSea.id));

  const effectId = state.pendingCoinFlip!.sourceEffectId;
  state.pendingCoinFlip!.result = "heads";
  state.coinFlipResults[effectId] = "heads";
  state = dispatchRulesCommand(state, defender.id, { type: "COMPLETE_COIN_FLIP" });

  assert.equal(state.pendingCoinFlip, undefined);
  assert.equal(state.coinFlipResults[effectId], undefined);
  assert.equal(state.pendingDamage, 0);
  assert.equal(state.phase, "postDamage");
  assert.equal(state.batch.some((effect) => effect.card.id === lostAtSea.id), false);
});

test("Lost at Sea tails finalizes cleanly and damage continues", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });

  const effectId = state.pendingCoinFlip!.sourceEffectId;
  state.pendingCoinFlip!.result = "tails";
  state.coinFlipResults[effectId] = "tails";
  state = dispatchRulesCommand(state, defender.id, { type: "COMPLETE_COIN_FLIP" });

  assert.equal(state.pendingCoinFlip, undefined);
  assert.equal(state.coinFlipResults[effectId], undefined);
  assert.equal(state.pendingDamage, 3);
  assert.equal(state.phase, "damage");
  assert.equal(state.priority, defender.id);
  assert.equal(state.batch.some((effect) => effect.card.id === lostAtSea.id), false);
});

test("coin flip completion remains controller-authoritative", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });
  assert.throws(() => completeCoinFlip(state, attacker.id), /controller can finish/i);
});

test("Night Lightning draws once and repeats its paid Damage bonus with refreshed choices", () => {
  const setup = cyclingPowerState("bb-41");
  const live = setup.state.players.find((player) => player.id === setup.controllerId)!;
  const first = card("bb-17", "night-lightning-fodder-one");
  const second = card("bb-18", "night-lightning-fodder-two");
  live.hand = [setup.cycling, first, second];

  let state = playCard(setup.state, setup.controllerId, setup.cycling.id);
  state = resolveTopBatchObject(state);
  assert.equal(activePendingDraw(state)?.remaining, 1);
  state = drawPendingCard(state, setup.controllerId);

  const firstField = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.ok(firstField?.options.some((option) => option.id === first.id));
  state = submitCardChoice(state, setup.controllerId, { discardCardIds: [first.id] });
  assert.equal(state.damageBoost[state.selected[setup.controllerId]], 3);

  const secondField = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.equal(secondField?.options.some((option) => option.id === first.id), false);
  assert.ok(secondField?.options.some((option) => option.id === second.id));
  state = submitCardChoice(state, setup.controllerId, { discardCardIds: [second.id] });
  assert.equal(state.damageBoost[state.selected[setup.controllerId]], 6);

  state = submitCardChoice(state, setup.controllerId, { discardCardIds: [] });
  const after = state.players.find((player) => player.id === setup.controllerId)!;
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.batch.some((effect) => effect.card.id === setup.cycling.id), false);
  assert.equal(after.discard.some((discarded) => discarded.id === first.id), true);
  assert.equal(after.discard.some((discarded) => discarded.id === second.id), true);
});

test("Darkus Hyper Nillious repeats only inside its Victor trigger and requires each discard", () => {
  const player = makePlayer("nillious-player", "Nillious Player", STARTER_DECKS[0]);
  const opponent = makePlayer("nillious-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("NILLIOUSLOOP", "bo1", [player, opponent]);
  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const nillious = card("bb-244", "repeatable-nillious");
  const first = card("bb-17", "nillious-fodder-one");
  const second = card("bb-18", "nillious-fodder-two");
  live.hand = [first, second];
  live.bakugan[0].open = true;
  live.bakugan[0].evoStack = [nillious];
  state.selected[live.id] = live.bakugan[0].id;
  state.brawlWinner = live.id;
  state.phase = "victor";

  const ability = ruleDefinitionForCard(nillious).abilities.find((candidate) => (
    candidate.kind === "triggered" && candidate.trigger?.event === "VICTOR_DECLARED"
  ));
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: live.id,
    card: nillious,
    ability,
    kind: "trigger",
    sourceId: nillious.id,
    choices: { sourceBakuganId: live.bakugan[0].id },
  });

  let resolving = resolveStructuredEffect(state, pending);
  assert.ok(resolving.pendingChoice?.schema.fields.some((field) => field.id === "discardCardIds"));
  resolving = submitCardChoice(resolving, live.id, { discardCardIds: [first.id] });
  assert.equal(resolving.damageBoost[live.bakugan[0].id], 2);
  assert.ok(resolving.pendingChoice?.schema.fields.some((field) => (
    field.id === "discardCardIds" && field.options.some((option) => option.id === second.id)
  )));

  resolving = submitCardChoice(resolving, live.id, { discardCardIds: [] });
  assert.equal(resolving.damageBoost[live.bakugan[0].id], 2, "declining must not grant another bonus");
  assert.equal(resolving.pendingChoice, undefined);
  assert.equal(resolving.batch.some((effect) => effect.id === pending.id), false);
});

test("Flip-discard Victor abilities offer only Flips and require successful payment", () => {
  const beginVictor = (catalogId: string, suffix: string, includeFlip = true) => {
    const player = makePlayer(`flip-cost-player-${suffix}`, "Flip Cost Player", STARTER_DECKS[0]);
    const opponent = makePlayer(`flip-cost-opponent-${suffix}`, "Opponent", STARTER_DECKS[1]);
    const state = createMatch(`FLIPCOST-${suffix}`, "bo1", [player, opponent]);
    const live = state.players.find((candidate) => candidate.id === player.id)!;
    const source = card(catalogId, `flip-cost-source-${suffix}`);
    const flipTemplate = CARDS.find((candidate) => candidate.type === "Flip")!;
    const flip = { ...flipTemplate, id: `legal-flip-${suffix}` };
    const action = card("bb-10", `illegal-action-${suffix}`);
    live.hand = includeFlip ? [flip, action] : [action];
    live.bakugan[0].open = true;
    live.bakugan[0].evoStack = [source];
    state.selected[live.id] = live.bakugan[0].id;
    state.brawlWinner = live.id;
    state.phase = "victor";
    state.priority = live.id;
    const ability = ruleDefinitionForCard(source).abilities.find((candidate) => (
      candidate.kind === "triggered" && candidate.trigger?.event === "VICTOR_DECLARED"
    ));
    assert.ok(ability);
    const pending = createRuleObject({
      controllerId: live.id,
      card: source,
      ability,
      kind: "trigger",
      sourceId: source.id,
      choices: { sourceBakuganId: live.bakugan[0].id },
    });
    return {
      state: resolveStructuredEffect(state, pending),
      playerId: live.id,
      bakuganId: live.bakugan[0].id,
      pendingId: pending.id,
      flip,
      action,
    };
  };

  for (const [catalogId, amount] of [["br-112", 4], ["aa-111", 5]] as const) {
    const paying = beginVictor(catalogId, `${catalogId}-pay`);
    const field = paying.state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
    assert.deepEqual(field?.options.map((option) => option.id), [paying.flip.id]);
    let resolved = submitCardChoice(paying.state, paying.playerId, { discardCardIds: [paying.flip.id] });
    const after = resolved.players.find((candidate) => candidate.id === paying.playerId)!;
    assert.equal(after.hand.some((candidate) => candidate.id === paying.flip.id), false);
    assert.equal(after.discard.some((candidate) => candidate.id === paying.flip.id), true);
    assert.equal(after.hand.some((candidate) => candidate.id === paying.action.id), true);
    assert.equal(resolved.damageBoost[paying.bakuganId], amount);

    const declining = beginVictor(catalogId, `${catalogId}-decline`);
    resolved = submitCardChoice(declining.state, declining.playerId, { discardCardIds: [] });
    assert.equal(resolved.damageBoost[declining.bakuganId] ?? 0, 0);
    assert.equal(resolved.players.find((candidate) => candidate.id === declining.playerId)?.hand.length, 2);
  }

  const unavailable = beginVictor("aa-111", "aa-111-no-flip", false);
  assert.equal(unavailable.state.pendingChoice, undefined);
  assert.equal(unavailable.state.damageBoost[unavailable.bakuganId] ?? 0, 0);
  assert.equal(unavailable.state.batch.some((effect) => effect.id === unavailable.pendingId), false);
});

test("Cyndeous Victor discard abilities make the opponent choose from their own hand", () => {
  const beginVictor = (catalogId: string, suffix: string, opponentHandSize = 2) => {
    const player = makePlayer(`cyndeous-player-${suffix}`, "Cyndeous Player", STARTER_DECKS[0]);
    const opponent = makePlayer(`cyndeous-opponent-${suffix}`, "Cyndeous Opponent", STARTER_DECKS[1]);
    const state = createMatch(`CYNDEOUSDISCARD-${suffix}`, "bo1", [player, opponent]);
    const live = state.players.find((candidate) => candidate.id === player.id)!;
    const victim = state.players.find((candidate) => candidate.id === opponent.id)!;
    const source = card(catalogId, `cyndeous-source-${suffix}`);
    victim.hand = [
      card("bb-10", `cyndeous-victim-one-${suffix}`),
      card("bb-17", `cyndeous-victim-two-${suffix}`),
    ].slice(0, opponentHandSize);
    live.bakugan[0].open = true;
    if (source.type === "Character") live.bakugan[0].character = source;
    else live.bakugan[0].evoStack = [source];
    state.selected[live.id] = live.bakugan[0].id;
    state.brawlWinner = live.id;
    state.phase = "victor";
    state.priority = live.id;
    const ability = ruleDefinitionForCard(source).abilities.find((candidate) => (
      candidate.kind === "triggered" && candidate.trigger?.event === "VICTOR_DECLARED"
    ));
    assert.ok(ability);
    const pending = createRuleObject({
      controllerId: live.id,
      card: source,
      ability,
      kind: "trigger",
      sourceId: source.id,
      choices: { sourceBakuganId: live.bakugan[0].id },
    });
    return {
      state: resolveStructuredEffect(state, pending),
      controllerId: live.id,
      opponentId: victim.id,
      pendingId: pending.id,
      handIds: victim.hand.map((candidate) => candidate.id),
    };
  };

  for (const catalogId of ["bb-311", "br-109"]) {
    const setup = beginVictor(catalogId, catalogId);
    const field = setup.state.pendingChoice?.schema.fields.find((candidate) => candidate.id === "discardCardIds");
    assert.equal(field?.chooserId, setup.opponentId);
    assert.equal(field?.minimum, 1);
    assert.equal(field?.maximum, 1);
    assert.deepEqual(field?.options.map((option) => option.id), setup.handIds);
    assert.equal(field?.options.every((option) => option.ownerId === setup.opponentId), true);
    assert.throws(
      () => submitCardChoice(setup.state, setup.controllerId, { discardCardIds: [setup.handIds[0]] }),
      /belongs to another player/i,
    );

    const resolved = submitCardChoice(setup.state, setup.opponentId, { discardCardIds: [setup.handIds[0]] });
    const opponent = resolved.players.find((candidate) => candidate.id === setup.opponentId)!;
    assert.deepEqual(opponent.hand.map((candidate) => candidate.id), [setup.handIds[1]]);
    assert.equal(opponent.discard.some((candidate) => candidate.id === setup.handIds[0]), true);
    assert.equal(resolved.batch.some((effect) => effect.id === setup.pendingId), false);
  }

  const empty = beginVictor("br-109", "br-109-empty", 0);
  assert.equal(empty.state.pendingChoice, undefined);
  assert.equal(empty.state.batch.some((effect) => effect.id === empty.pendingId), false);
});

test("opponent Flip triggers draw for Bill Kouzo and Titan Trunkanious Ultra's controller", () => {
  const setup = (catalogId: "bb-206" | "aa-159") => {
    const player = makePlayer(`${catalogId}-controller`, "Draw Controller", STARTER_DECKS[0]);
    const opponent = makePlayer(`${catalogId}-opponent`, "Flip Player", STARTER_DECKS[1]);
    const state = createMatch(`OPPONENTFLIPDRAW-${catalogId}`, "bo1", [player, opponent]);
    const live = state.players.find((candidate) => candidate.id === player.id)!;
    const rival = state.players.find((candidate) => candidate.id === opponent.id)!;
    const source = card(catalogId, `${catalogId}-source`);
    const flip = { ...CARDS.find((candidate) => candidate.type === "Flip")!, id: `${catalogId}-played-flip` };
    if (source.type === "Hero") live.heroes = [source];
    else {
      live.bakugan[0].open = true;
      live.bakugan[0].evoStack = [source];
      state.selected[live.id] = live.bakugan[0].id;
      state.brawlWinner = live.id;
    }
    const created = emitRuleEvent(state, {
      id: `${catalogId}-opponent-flip-event`,
      name: "CARD_PLAYED",
      actorId: rival.id,
      controllerId: rival.id,
      card: flip,
      cardType: "Flip",
      createdAt: Date.now(),
    });
    assert.equal(created.length, 1);
    return { state, controllerId: live.id, opponentId: rival.id, pending: created[0] };
  };

  const bill = setup("bb-206");
  let resolving = resolveStructuredEffect(bill.state, bill.pending);
  assert.equal(resolving.pendingChoice?.controllerId, bill.controllerId);
  assert.ok(resolving.pendingChoice?.schema.fields.some((field) => field.id === "confirmed"));
  resolving = submitCardChoice(resolving, bill.controllerId, { confirmed: true });
  assert.equal(activePendingDraw(resolving)?.playerId, bill.controllerId);
  assert.notEqual(activePendingDraw(resolving)?.playerId, bill.opponentId);

  const titan = setup("aa-159");
  resolving = resolveStructuredEffect(titan.state, titan.pending);
  assert.equal(activePendingDraw(resolving)?.playerId, titan.controllerId);
  assert.notEqual(activePendingDraw(resolving)?.playerId, titan.opponentId);
});

test("Group 6 card-play triggers fire only for their printed factions", () => {
  const player = makePlayer("faction-trigger-player", "Faction Trigger", STARTER_DECKS[0]);
  const opponent = makePlayer("faction-trigger-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("FACTION-TRIGGER", "bo1", [player, opponent]);
  const live = state.players[0];
  const source = card("aa-164", "aquos-goreene-source");
  live.bakugan[0].character = source;
  live.bakugan[0].open = true;
  state.selected[live.id] = live.bakugan[0].id;
  const eventCard = card("bb-10", "played-faction-card");

  assert.equal(emitRuleEvent(state, {
    id: "wrong-faction-play",
    name: "CARD_PLAYED",
    actorId: live.id,
    controllerId: live.id,
    card: { ...eventCard, faction: "Pyrus", factions: ["Pyrus"] },
    cardType: "Action",
    createdAt: Date.now(),
  }).length, 0);
  assert.equal(emitRuleEvent(state, {
    id: "matching-faction-play",
    name: "CARD_PLAYED",
    actorId: live.id,
    controllerId: live.id,
    card: { ...eventCard, faction: "Aquos", factions: ["Aquos"] },
    cardType: "Action",
    createdAt: Date.now(),
  }).length, 1);
});

test("Group 7 Energize resolution follows each chooser without changing zone ownership", () => {
  const player = makePlayer("energize-player", "Energize Player", STARTER_DECKS[0]);
  const opponent = makePlayer("energize-opponent", "Energize Opponent", STARTER_DECKS[1]);
  let state = createMatch("EACH-PLAYER-ENERGIZE", "bo1", [player, opponent]);
  const hyperdrive = card("bb-175", "hyperdrive-source");
  const hyperdriveAbility = ruleDefinitionForCard(hyperdrive).abilities.find((ability) => ability.kind === "spell")!;
  const hyperdriveObject = createRuleObject({
    controllerId: player.id,
    card: hyperdrive,
    ability: hyperdriveAbility,
    kind: "spell",
    sourceId: hyperdrive.id,
    choices: {},
  });
  const decksBefore = state.players.map((candidate) => candidate.deckCards.length);
  state = resolveStructuredEffect(state, hyperdriveObject);
  assert.equal(state.pendingChoice?.schema.simultaneous, true);
  assert.deepEqual(state.pendingChoice?.schema.fields.map((field) => field.chooserId), [player.id, opponent.id]);
  state = submitCardChoice(state, player.id, { confirmed: true });
  state = submitCardChoice(state, opponent.id, { confirmed: false });
  assert.equal(state.players[0].deckCards.length, decksBefore[0] - 2);
  assert.equal(state.players[0].energyZone.length, 2);
  assert.equal(state.players[1].deckCards.length, decksBefore[1]);
  assert.equal(state.players[1].energyZone.length, 0);

  const controller = state.players[0];
  const chooser = state.players[1];
  const pandoxx = card("aa-212", "pandoxx-source");
  const offered = card("bb-17", "pandoxx-offered-card");
  controller.hand = [offered];
  controller.bakugan[0].character = pandoxx;
  controller.bakugan[0].open = true;
  state.selected[controller.id] = controller.bakugan[0].id;
  state.brawlWinner = controller.id;
  state.phase = "victor";
  const victor = ruleDefinitionForCard(pandoxx).abilities.find((ability) => ability.trigger?.event === "VICTOR_DECLARED")!;
  state = resolveStructuredEffect(state, createRuleObject({
    controllerId: controller.id,
    card: pandoxx,
    ability: victor,
    kind: "trigger",
    sourceId: pandoxx.id,
    choices: { sourceBakuganId: controller.bakugan[0].id },
  }));
  const handChoice = state.pendingChoice?.schema.fields.find((field) => field.id === "handCardIds");
  assert.equal(handChoice?.chooserId, chooser.id);
  assert.deepEqual(handChoice?.options.map((option) => [option.id, option.ownerId]), [[offered.id, controller.id]]);
  state = submitCardChoice(state, chooser.id, { confirmed: true, handCardIds: [offered.id] });
  assert.equal(state.players[0].hand.some((candidate) => candidate.id === offered.id), false);
  assert.equal(state.players[0].energyZone.some((candidate) => candidate.id === offered.id), true);
  assert.equal(state.players[1].energyZone.some((candidate) => candidate.id === offered.id), false);
});

test("Group 8 printed bonuses turn on at two attached BakuCores", () => {
  for (const [catalogId, stat, amount] of [
    ["br-123", "power", 1000],
    ["br-126", "power", 500],
    ["br-127", "damage", 10],
  ] as const) {
    const player = makePlayer(`${catalogId}-player`, "Core Threshold", STARTER_DECKS[0]);
    const opponent = makePlayer(`${catalogId}-opponent`, "Opponent", STARTER_DECKS[1]);
    const state = createMatch(`CORE-THRESHOLD-${catalogId}`, "bo1", [player, opponent]);
    const live = state.players[0];
    const bakugan = live.bakugan[0];
    const source = card(catalogId, `${catalogId}-source`);
    bakugan.evoStack = [source];
    bakugan.open = true;
    state.selected[live.id] = bakugan.id;
    bakugan.heldCoreCells = ["threshold-one"];
    assert.equal(evaluateBakuganCharacteristics(state, bakugan, live).applied.some((modifier) => (
      modifier.sourceId === source.id && modifier.stat === stat && modifier.amount === amount
    )), false);
    bakugan.heldCoreCells.push("threshold-two");
    assert.equal(evaluateBakuganCharacteristics(state, bakugan, live).applied.some((modifier) => (
      modifier.sourceId === source.id && modifier.stat === stat && modifier.amount === amount
    )), true);
  }
});

test("Group 9 scaling reads live stats, team factions, Heroes, and the chosen player's hand", () => {
  const resolveSpell = (catalogId: string, configure: (state: MatchState) => void) => {
    const player = makePlayer(`${catalogId}-player`, "Scaling Player", STARTER_DECKS[0]);
    const opponent = makePlayer(`${catalogId}-opponent`, "Scaling Opponent", STARTER_DECKS[1]);
    let state = createMatch(`LIVE-SCALING-${catalogId}`, "bo1", [player, opponent]);
    state.players[0].bakugan[0].open = true;
    state.selected[player.id] = state.players[0].bakugan[0].id;
    configure(state);
    const source = card(catalogId, `${catalogId}-source`);
    const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind === "spell")!;
    state = resolveStructuredEffect(state, createRuleObject({
      controllerId: player.id,
      card: source,
      ability,
      kind: "spell",
      sourceId: source.id,
      choices: {},
    }));
    return state;
  };

  let state = resolveSpell("bb-31", (candidate) => {
    candidate.damageBoost[candidate.players[0].bakugan[0].id] = 2;
  });
  assert.equal(state.powerBoost[state.players[0].bakugan[0].id], 700);

  state = resolveSpell("bb-60", (candidate) => {
    candidate.frostStrike[candidate.players[0].bakugan[0].id] = 2;
  });
  assert.equal(state.frostStrike[state.players[0].bakugan[0].id], 3);
  assert.equal(state.damageBoost[state.players[0].bakugan[0].id], 3);

  state = resolveSpell("bb-98", (candidate) => {
    const live = candidate.players[0];
    for (let index = 0; index < 2; index += 1) {
      live.bakugan[index].character = { ...live.bakugan[index].character, faction: "Pyrus", factions: ["Pyrus"] };
    }
    live.bakugan[2].character = { ...live.bakugan[2].character, faction: "Aquos", factions: ["Aquos"] };
  });
  assert.equal(state.damageBoost[state.players[0].bakugan[0].id], 4);

  const bentonPlayer = makePlayer("benton-player", "Benton Player", STARTER_DECKS[0]);
  const bentonOpponent = makePlayer("benton-opponent", "Opponent", STARTER_DECKS[1]);
  state = createMatch("BENTON-LIVE-HEROES", "bo1", [bentonPlayer, bentonOpponent]);
  const benton = card("aa-73", "benton-source");
  state.players[0].heroes = [benton, card("bb-199", "second-hero")];
  const bentonBakugan = state.players[0].bakugan[0];
  const baseDamage = bentonBakugan.character.damage ?? bentonBakugan.damage;
  assert.equal(evaluateBakuganCharacteristics(state, bentonBakugan, state.players[0]).damage, baseDamage + 2);
  state.players[0].heroes.pop();
  assert.equal(evaluateBakuganCharacteristics(state, bentonBakugan, state.players[0]).damage, baseDamage + 1);

  const ritePlayer = makePlayer("rite-player", "Rite Player", STARTER_DECKS[0]);
  const riteOpponent = makePlayer("rite-opponent", "Rite Opponent", STARTER_DECKS[1]);
  state = createMatch("RITE-DYNAMIC-DISCARD", "bo1", [ritePlayer, riteOpponent]);
  for (let index = 0; index < 2; index += 1) {
    state.players[0].bakugan[index].character = {
      ...state.players[0].bakugan[index].character,
      faction: "Darkus",
      factions: ["Darkus"],
    };
  }
  state.players[0].bakugan[2].character = {
    ...state.players[0].bakugan[2].character,
    faction: "Aquos",
    factions: ["Aquos"],
  };
  const discarded = [card("bb-10", "rite-one"), card("bb-17", "rite-two")];
  state.players[1].hand = [...discarded, card("bb-18", "rite-three")];
  const rite = card("bb-44", "rite-source");
  const riteAbility = ruleDefinitionForCard(rite).abilities.find((ability) => ability.kind === "spell")!;
  state = resolveStructuredEffect(state, createRuleObject({
    controllerId: ritePlayer.id,
    card: rite,
    ability: riteAbility,
    kind: "spell",
    sourceId: rite.id,
    choices: {},
  }));
  state = submitCardChoice(state, ritePlayer.id, { targetPlayerId: riteOpponent.id });
  const discardField = state.pendingChoice?.schema.fields.find((field) => field.id === "discardCardIds");
  assert.equal(discardField?.chooserId, riteOpponent.id);
  assert.deepEqual([discardField?.minimum, discardField?.maximum], [2, 2]);
  state = submitCardChoice(state, riteOpponent.id, { discardCardIds: discarded.map((candidate) => candidate.id) });
  assert.equal(state.players[1].discard.filter((candidate) => discarded.some((item) => item.id === candidate.id)).length, 2);
});

test("Group 10 resolves a discarded or revealed card's printed Energy cost before scaling", () => {
  const player = makePlayer("card-cost-player", "Card Cost Player", STARTER_DECKS[0]);
  const opponent = makePlayer("card-cost-opponent", "Opponent", STARTER_DECKS[1]);
  let state = createMatch("DISCARDED-CARD-COST", "bo1", [player, opponent]);
  const magnus = card("bb-199", "magnus-cost-source");
  const discarded = { ...card("bb-10", "magnus-cost-card"), cost: 4 };
  state.players[0].heroes = [magnus];
  state.players[0].hand = [discarded];
  state.players[0].bakugan[0].open = true;
  state.selected[player.id] = state.players[0].bakugan[0].id;
  state.brawlWinner = player.id;
  state.phase = "victor";
  const magnusAbility = ruleDefinitionForCard(magnus).abilities.find((ability) => ability.trigger?.event === "VICTOR_DECLARED")!;
  state = resolveStructuredEffect(state, createRuleObject({
    controllerId: player.id,
    card: magnus,
    ability: magnusAbility,
    kind: "trigger",
    sourceId: magnus.id,
    choices: {},
  }));
  state = submitCardChoice(state, player.id, {
    targetBakuganId: state.players[0].bakugan[0].id,
    discardCardIds: [discarded.id],
  });
  assert.equal(state.damageBoost[state.players[0].bakugan[0].id], 4);
  assert.equal(state.players[0].discard.some((candidate) => candidate.id === discarded.id), true);

  const pegatrixPlayer = makePlayer("pegatrix-cost-player", "Pegatrix Player", STARTER_DECKS[0]);
  const pegatrixOpponent = makePlayer("pegatrix-cost-opponent", "Opponent", STARTER_DECKS[1]);
  state = createMatch("REVEALED-CARD-COST", "bo1", [pegatrixPlayer, pegatrixOpponent]);
  const pegatrix = card("br-97", "pegatrix-cost-source");
  const revealed = { ...card("bb-17", "pegatrix-revealed-card"), cost: 3 };
  state.players[0].deckCards = [revealed, ...state.players[0].deckCards];
  state.players[0].bakugan[0].evoStack = [pegatrix];
  state.players[0].bakugan[0].open = true;
  state.selected[pegatrixPlayer.id] = state.players[0].bakugan[0].id;
  state.brawlWinner = pegatrixPlayer.id;
  state.phase = "victor";
  const pegatrixAbility = ruleDefinitionForCard(pegatrix).abilities.find((ability) => ability.trigger?.event === "VICTOR_DECLARED")!;
  state = resolveStructuredEffect(state, createRuleObject({
    controllerId: pegatrixPlayer.id,
    card: pegatrix,
    ability: pegatrixAbility,
    kind: "trigger",
    sourceId: pegatrix.id,
    choices: { sourceBakuganId: state.players[0].bakugan[0].id },
  }));
  state = submitCardChoice(state, pegatrixPlayer.id, { orderedCardIds: [revealed.id] });
  assert.equal(state.damageBoost[state.players[0].bakugan[0].id], 6);
});

test("AA-84 Hyper Pyravian Ultra grants FrostStrike only while it is the controller's sole open Bakugan", () => {
  const player = makePlayer("pyravian", "Pyravian", STARTER_DECKS[0]);
  const opponent = makePlayer("pyravian-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("PYRAVIAN-ONLY-OPEN", "bo1", [player, opponent]);
  const livePlayer = state.players.find((candidate) => candidate.id === player.id)!;
  const source = livePlayer.bakugan[0];
  const other = livePlayer.bakugan[1];
  const evo = card("aa-84", "aa-84-regression");
  source.evoStack = [evo];
  source.open = true;
  other.open = false;

  const instruction = compileCardEffect(evo).instructions.find((candidate) => /only open Bakugan/i.test(candidate.sourceText));
  assert.ok(instruction);
  assert.deepEqual(instruction.condition, { kind: "source-only-open-bakugan" });
  assert.equal(evaluateBakuganCharacteristics(state, source, livePlayer).frostStrike, 3);

  other.open = true;
  assert.equal(evaluateBakuganCharacteristics(state, source, livePlayer).frostStrike, 0);

  source.open = false;
  other.open = true;
  assert.equal(evaluateBakuganCharacteristics(state, source, livePlayer).frostStrike, 0);
});

test("AA-19 Nova Burst selects and copies only an Action actually discarded this turn", () => {
  const player = makePlayer("nova", "Nova", STARTER_DECKS[0]);
  const opponent = makePlayer("nova-opponent", "Opponent", STARTER_DECKS[1]);
  const nova = card("aa-19", "aa-19-regression");
  const eligible = card("aa-19", "nova-eligible-action");
  const stale = card("aa-19", "nova-stale-action");
  player.hand = [nova];
  player.discard = [eligible, stale];
  player.discardedCardIdsThisTurn = [eligible.id];
  addUntappedEnergy(player, 3);

  let state = createMatch("NOVA-BURST-DISCARD", "bo1", [player, opponent]);
  const livePlayer = state.players.find((candidate) => candidate.id === player.id)!;
  const liveOpponent = state.players.find((candidate) => candidate.id === opponent.id)!;
  livePlayer.hand = [nova];
  livePlayer.discard = [eligible, stale];
  livePlayer.discardedCardIdsThisTurn = [eligible.id];
  addUntappedEnergy(livePlayer, 3);
  state.turn = 2;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = livePlayer.id;
  state.initialStartingPlayer = livePlayer.id;
  state.priority = livePlayer.id;
  livePlayer.bakugan[0].open = true;
  liveOpponent.bakugan[0].open = true;
  state.selected[livePlayer.id] = livePlayer.bakugan[0].id;
  state.selected[liveOpponent.id] = liveOpponent.bakugan[0].id;
  state.rolls[livePlayer.id] = successfulRoll(livePlayer.id, livePlayer.bakugan[0].id);
  state.rolls[liveOpponent.id] = successfulRoll(liveOpponent.id, liveOpponent.bakugan[0].id);

  const definition = ruleDefinitionForCard(nova);
  const targetChoice = definition.play.choices.find((choice) => choice.id === "targetCardId");
  assert.equal(targetChoice?.selector, "discarded-card-this-turn");
  assert.equal(targetChoice?.timing, "announce");
  const copyAction = definition.abilities.flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "copy");
  assert.equal(copyAction?.kind === "copy" ? copyAction.target : undefined, "discarded-action-this-turn");

  state = playCard(state, livePlayer.id, nova.id, { targetCardId: eligible.id });
  state = resolveTopBatchObject(state);
  assert.ok(state.batch.some((object) => object.kind === "copy" && object.card.id === eligible.id));

  const illegalState = structuredClone(state);
  illegalState.batch = [];
  const spell = definition.abilities.find((ability) => ability.kind === "spell")!;
  illegalState.batch = [createRuleObject({
    controllerId: livePlayer.id,
    card: nova,
    ability: spell,
    choices: { targetCardId: stale.id },
    kind: "card",
    sourceId: nova.id,
  })];
  illegalState.priority = livePlayer.id;
  const afterIllegal = resolveTopBatchObject(illegalState);
  assert.equal(afterIllegal.batch.some((object) => object.kind === "copy" && object.card.id === stale.id), false);
});

test("BR-104 Titan Dragonoid Ultra counts as every faction for faction and non-faction Stops", () => {
  const attacker = makePlayer("titan-attacker", "Attacker", STARTER_DECKS[0]);
  const defender = makePlayer("titan-defender", "Defender", STARTER_DECKS[1]);
  const state = createMatch("TITAN-STOP-FACTIONS", "bo1", [attacker, defender]);
  const liveAttacker = state.players.find((candidate) => candidate.id === attacker.id)!;
  const liveDefender = state.players.find((candidate) => candidate.id === defender.id)!;
  const titan = card("br-104", "br-104-regression");
  const attacking = liveAttacker.bakugan[0];
  attacking.evoStack = [titan];
  attacking.open = true;
  state.phase = "damage";
  state.pendingLoser = liveDefender.id;
  state.pendingDamage = 5;
  state.damageOrigin = attacking.id;
  state.damageFaction = "Aurelus";

  for (const faction of ["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"] as const) {
    const positive = {
      ...card("bb-140", `positive-stop-${faction}`),
      effect: `[Stop] [${faction}].`,
    };
    assert.equal(flipStopsDamage(state, positive), true, `${faction} Stop should match Titan Dragonoid Ultra`);

    const negative = {
      ...card("bb-140", `negative-stop-${faction}`),
      effect: `[Stop] non-[${faction}].`,
    };
    assert.equal(flipStopsDamage(state, negative), false, `non-${faction} Stop should not match Titan Dragonoid Ultra`);
  }

  state.damageOrigin = "card-generated-attack";
  state.damageFaction = "Pyrus";
  const pyrusStop = { ...card("bb-140", "pyrus-card-attack-stop"), effect: "[Stop] [Pyrus]." };
  const aquosStop = { ...card("bb-140", "aquos-card-attack-stop"), effect: "[Stop] [Aquos]." };
  assert.equal(flipStopsDamage(state, pyrusStop), true);
  assert.equal(flipStopsDamage(state, aquosStop), false);
});
