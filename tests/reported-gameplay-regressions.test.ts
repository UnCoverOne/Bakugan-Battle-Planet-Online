import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  nextTurn,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";
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
    maxEnergy: 0,
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
  owner.maxEnergy = amount;
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
  const nextResurgenceTurn = nextTurn(resurgenceTurn);
  assert.equal(nextResurgenceTurn.drawRemainingByPlayer?.resurgence, 1);
  assert.equal(nextResurgenceTurn.drawRemainingByPlayer?.opponent, 1);

  const battleBrawlersTurn = matchWith(
    player("battle-brawlers", [bakugan("battle-brawlers-b", "Aquos")]),
    player("other", [bakugan("other-b", "Pyrus")]),
    "endPlay",
  );
  battleBrawlersTurn.players[0].heroes = [battleBrawlersStrata];
  const nextBattleBrawlersTurn = nextTurn(battleBrawlersTurn);
  assert.equal(nextBattleBrawlersTurn.drawRemainingByPlayer?.["battle-brawlers"], 2);
  assert.equal(nextBattleBrawlersTurn.drawRemainingByPlayer?.other, 2);
});
