import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  nextTurn,
  totalPower,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";
import { advanceOpponentAi as advanceBaseOpponentAi } from "../lib/opponentAiBase";
import { buildChoiceSchema } from "../lib/rules/choices";
import { additionalTurnDrawCount, turnDrawCount } from "../lib/turnStart";

let serial = 0;

function catalogueCard(catalogId: string, id = `test-${catalogId}-${++serial}`) {
  const source = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function characterFor(faction: Faction, id: string) {
  const source = CARDS.find((card) => (
    card.type === "Character"
    && card.faction === faction
    && !/\bReroll\b/i.test(card.effect)
  ));
  assert.ok(source, `Missing ordinary ${faction} Character`);
  return { ...source, id };
}

function bakugan(id: string, faction: Faction, extra: Partial<Bakugan> = {}): Bakugan {
  const character = characterFor(faction, `${id}-character`);
  return {
    id,
    name: character.displayName,
    faction,
    bPower: character.bPower ?? 500,
    damage: character.damage ?? 5,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: character.art,
    character,
    open: false,
    heldCoreCells: [],
    evoStack: [],
    ...extra,
  };
}

function core(id: string): Core {
  serial += 1;
  return {
    id,
    catalogId: id,
    number: serial,
    name: id,
    type: "Fist",
    bonus: 0,
    damageBonus: 0,
    art: "",
  };
}

function player(
  id: string,
  team: Bakugan[],
  hand: GameCard[] = [],
): PlayerState {
  return {
    id,
    name: id,
    bakugan: team,
    cores: [],
    deck: 0,
    deckCards: [],
    hand,
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    ready: true,
    connected: true,
    lastSeen: Date.now(),
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
  };
}

function addEnergy(owner: PlayerState, amount: number) {
  owner.energyZone = Array.from({ length: amount }, (_, index) => ({
    ...catalogueCard("bb-10", `${owner.id}-energy-${index}`),
  }));
}

function matchWith(
  ai: PlayerState,
  human: PlayerState,
  phase: MatchState["phase"],
) {
  const match = createMatch("REPORTED", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = phase;
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.stepLabel = phase;
  const fieldCore = core("field-core");
  match.placements = [{
    playerId: human.id,
    core: fieldCore,
    cell: CENTER_CELL,
    order: 1,
  }];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;
  return match;
}

function roll(
  playerId: string,
  bakuganId: string,
  result: RollOutcome["result"],
): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result,
    cores: [],
    accuracyRoll: result === "miss-closed" ? 100 : 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 1,
    doubleCore: false,
    path: [],
    note: result,
    simulationProfileId: "test",
    attempt: 1,
    collisionDecisions: [],
  };
}

function establishSingleMiss(match: MatchState, ai: PlayerState, human: PlayerState) {
  ai.bakugan[0].open = false;
  human.bakugan[0].open = true;
  match.rolls[ai.id] = roll(ai.id, ai.bakugan[0].id, "miss-closed");
  match.rolls[human.id] = roll(human.id, human.bakugan[0].id, "open-no-core");
}

function establishPendingDeepDiveReroll(match: MatchState, ai: PlayerState, deepDive: GameCard) {
  const sourceText = deepDive.effect.split(/(?<=\.)\s+/)
    .find((clause) => /may Reroll/i.test(clause));
  assert.ok(sourceText, "Deep Dive Reroll clause missing");
  const effectId = `${deepDive.id}-effect`;
  match.batch = [{
    id: effectId,
    controllerId: ai.id,
    card: deepDive,
    choices: {},
    kind: "card",
    effect: deepDive.effect,
    instructionIndex: 1,
  }];
  match.pendingChoice = {
    id: `${effectId}-choice`,
    kind: "resolution",
    controllerId: ai.id,
    cardId: deepDive.id,
    schema: buildChoiceSchema(match, ai.id, deepDive, sourceText, {}, "resolve"),
    answers: {},
    createdVersion: match.version,
    pendingEffectId: effectId,
    instructionIndex: 1,
  };
}

function establishWinningDoubleCore(match: MatchState, ai: PlayerState, human: PlayerState) {
  ai.bakugan[0].open = true;
  human.bakugan[0].open = true;
  match.placements = [];
  match.rolls[ai.id] = roll(ai.id, ai.bakugan[0].id, "intended-core");
  match.rolls[human.id] = roll(human.id, human.bakugan[0].id, "intended-core");
  const baseGap = totalPower(match, ai.id) - totalPower(match, human.id);
  const aiCoreA = { ...core("ai-double-a"), bonus: 400 };
  const aiCoreB = { ...core("ai-double-b"), bonus: 400 };
  const humanCore = { ...core("human-held"), bonus: baseGap + 400 };
  const fieldA = { ...core("reroll-field-a"), bonus: 0 };
  const fieldB = { ...core("reroll-field-b"), bonus: 0 };
  const aiCells = [CENTER_CELL, "h4-3"];
  ai.bakugan[0].heldCoreCells = [...aiCells];
  human.bakugan[0].heldCoreCells = ["h2-3"];
  match.placements = [
    { playerId: ai.id, core: aiCoreA, cell: aiCells[0], order: 1, attachedTo: ai.bakugan[0].id },
    { playerId: ai.id, core: aiCoreB, cell: aiCells[1], order: 2, attachedTo: ai.bakugan[0].id },
    { playerId: human.id, core: humanCore, cell: "h2-3", order: 3, attachedTo: human.bakugan[0].id },
    { playerId: human.id, core: fieldA, cell: "h3-4", order: 4 },
    { playerId: human.id, core: fieldB, cell: "h3-2", order: 5 },
  ];
  match.rolls[ai.id].cores = [...aiCells];
  match.rolls[ai.id].doubleCore = true;
  match.rolls[human.id].cores = ["h2-3"];
  assert.equal(totalPower(match, ai.id) - totalPower(match, human.id), 400);
}

test("AI reserves Deep Dive until the Brawl can make its optional Reroll relevant", () => {
  const deepDive = catalogueCard("br-6", "deep-dive-pre-roll");
  const ai = player("ai", [bakugan("ai-b", "Aquos")], [deepDive]);
  const human = player("human", [bakugan("human-b", "Pyrus")]);
  addEnergy(ai, 1);
  const preRoll = matchWith(ai, human, "preRoll");

  const held = advanceOpponentAi(preRoll, ai.id);
  assert.ok(held);
  assert.equal(held.phase, "preRoll");
  assert.equal(held.batch.length, 0);
  assert.equal(held.players[0].hand.some((card) => card.id === deepDive.id), true);
  assert.equal(held.priority, human.id);

  const powerDeepDive = { ...deepDive, id: "deep-dive-power" };
  const powerAi = player("power-ai", [bakugan("power-ai-b", "Aquos")], [powerDeepDive]);
  const powerHuman = player("power-human", [bakugan("power-human-b", "Pyrus")]);
  addEnergy(powerAi, 1);
  const power = matchWith(powerAi, powerHuman, "power");
  establishSingleMiss(power, powerAi, powerHuman);

  const played = advanceOpponentAi(power, powerAi.id);
  assert.ok(played);
  assert.equal(played.batch.at(-1)?.card.catalogId, "br-6");
  assert.equal(played.players[0].hand.some((card) => card.id === powerDeepDive.id), false);
});

test("a lone miss never gives the AI an unbacked Reroll", () => {
  const ai = player("ai", [bakugan("ai-b", "Aquos")]);
  const human = player("human", [bakugan("human-b", "Pyrus")]);
  const match = matchWith(ai, human, "power");
  establishSingleMiss(match, ai, human);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.phase, "power");
  assert.equal(next.pendingReroll, undefined);
  assert.equal(next.rerollSequence, 0);
  assert.equal(next.priority, human.id);
});

test("incidental Reroll wording cannot masquerade as a printed intrinsic ability", () => {
  const active = bakugan("ai-b", "Aquos");
  active.character = {
    ...active.character,
    effect: "When you miss a Roll, you may Reroll an Action card from your hand.",
    mechanics: ["Reroll"],
  };
  const ai = player("ai", [active]);
  const human = player("human", [bakugan("human-b", "Pyrus")]);
  const match = matchWith(ai, human, "power");
  establishSingleMiss(match, ai, human);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.phase, "power");
  assert.equal(next.pendingReroll, undefined);
  assert.equal(next.priority, human.id);
});

test("Bakugan Resurgence Strata does not inherit Battle Brawlers Strata's draw effect", () => {
  const advanceToDraw = (initial: ReturnType<typeof matchWith>) => {
    let state = initial;
    for (let step = 0; step < 4 && state.phase !== "draw"; step += 1) {
      state = nextTurn(state);
    }
    assert.equal(state.phase, "draw");
    return state;
  };
  const ai = player("ai", [bakugan("ai-b", "Aquos")]);
  const human = player("human", [bakugan("human-b", "Pyrus")]);
  const match = matchWith(ai, human, "draw");
  const resurgenceStrata = catalogueCard("br-80", "resurgence-strata");
  const battleBrawlersStrata = catalogueCard("bb-192", "battle-brawlers-strata");

  match.players[0].heroes = [resurgenceStrata];
  assert.equal(additionalTurnDrawCount(match), 0);
  assert.equal(turnDrawCount(match), 1);

  match.players[0].heroes = [battleBrawlersStrata];
  assert.equal(additionalTurnDrawCount(match), 1);
  assert.equal(turnDrawCount(match), 2);

  match.players[0].heroes = [resurgenceStrata, battleBrawlersStrata];
  assert.equal(additionalTurnDrawCount(match), 1);
  assert.equal(turnDrawCount(match), 2);

  const resurgenceTurn = matchWith(
    player("resurgence", [bakugan("resurgence-b", "Aquos")]),
    player("opponent", [bakugan("opponent-b", "Pyrus")]),
    "endPlay",
  );
  resurgenceTurn.players[0].heroes = [resurgenceStrata];
  const nextResurgenceTurn = advanceToDraw(resurgenceTurn);
  assert.equal(nextResurgenceTurn.drawRemainingByPlayer?.resurgence, 1);
  assert.equal(nextResurgenceTurn.drawRemainingByPlayer?.opponent, 1);

  const battleBrawlersTurn = matchWith(
    player("battle-brawlers", [bakugan("battle-brawlers-b", "Aquos")]),
    player("other", [bakugan("other-b", "Pyrus")]),
    "endPlay",
  );
  battleBrawlersTurn.players[0].heroes = [battleBrawlersStrata];
  const nextBattleBrawlersTurn = advanceToDraw(battleBrawlersTurn);
  assert.equal(nextBattleBrawlersTurn.drawRemainingByPlayer?.["battle-brawlers"], 2);
  assert.equal(nextBattleBrawlersTurn.drawRemainingByPlayer?.other, 2);
});


test("AI declines Deep Dive's optional Reroll when a Double Core already wins by 400 B", () => {
  for (const reverseDeck of [false, true]) {
    const deepDive = catalogueCard("br-6", `winning-deep-dive-${reverseDeck}`);
    const standTogether = catalogueCard("bb-165", `stand-together-${reverseDeck}`);
    const filler = catalogueCard("bb-10", `deck-filler-${reverseDeck}`);
    const ai = player(`ai-${reverseDeck}`, [bakugan(`ai-b-${reverseDeck}`, "Aquos")]);
    const human = player(`human-${reverseDeck}`, [bakugan(`human-b-${reverseDeck}`, "Pyrus")]);
    addEnergy(ai, 4);
    ai.deckCards = reverseDeck ? [filler, standTogether] : [standTogether, filler];
    ai.deck = ai.deckCards.length;
    const match = matchWith(ai, human, "power");
    establishWinningDoubleCore(match, ai, human);
    establishPendingDeepDiveReroll(match, ai, deepDive);
    const next = advanceBaseOpponentAi(match, ai.id);
    assert.ok(next);
    assert.equal(next.pendingReroll, undefined);
    assert.equal(next.rerollSequence, 0);
    assert.equal(
      next.players.find((candidate) => candidate.id === ai.id)!.bakugan[0].heldCoreCells.length,
      2,
    );
  }
});

test("AI accepts Deep Dive's optional Reroll when it missed and the Reroll can recover", () => {
  const deepDive = catalogueCard("br-6", "losing-deep-dive-choice");
  const ai = player("choice-ai", [bakugan("choice-ai-b", "Aquos")]);
  const human = player("choice-human", [bakugan("choice-human-b", "Pyrus")]);
  const match = matchWith(ai, human, "power");
  establishSingleMiss(match, ai, human);
  match.placements.push({
    playerId: human.id,
    core: { ...core("choice-recovery-core"), bonus: 800 },
    cell: "h4-3",
    order: 2,
  });
  establishPendingDeepDiveReroll(match, ai, deepDive);
  const next = advanceBaseOpponentAi(match, ai.id);
  assert.ok(next);
  assert.ok(next.pendingReroll || next.phase === "reroll");
});

test("AI conserves Deep Dive while already winning a Double-Core Brawl", () => {
  const deepDive = catalogueCard("br-6", "conserve-deep-dive");
  const ai = player("conserve-ai", [bakugan("conserve-ai-b", "Aquos")], [deepDive]);
  const human = player("conserve-human", [bakugan("conserve-human-b", "Pyrus")]);
  addEnergy(ai, 1);
  const match = matchWith(ai, human, "power");
  establishWinningDoubleCore(match, ai, human);
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const nextAi = next.players.find((candidate) => candidate.id === ai.id)!;
  assert.equal(nextAi.hand.some((card) => card.id === deepDive.id), true);
  assert.equal(next.batch.some((effect) => effect.card.id === deepDive.id), false);
  assert.equal(nextAi.bakugan[0].heldCoreCells.length, 2);
});
