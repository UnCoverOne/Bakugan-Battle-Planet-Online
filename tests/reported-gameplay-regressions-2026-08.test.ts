import assert from "node:assert/strict";
import test from "node:test";
import { BAKUGAN, CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  emitGameEvent,
  passPriority,
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
import { emitRuleEvent } from "../lib/rules/triggers";

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
