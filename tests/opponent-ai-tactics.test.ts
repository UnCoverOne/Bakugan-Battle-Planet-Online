import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  HEX_CELLS,
  createMatch,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";

let serial = 0;

function printedCard(number: number, instanceId?: string): GameCard {
  const source = CARDS.find((candidate) => candidate.number === number);
  assert.ok(source, `Missing catalogue card ${number}`);
  serial += 1;
  return { ...source, id: instanceId ?? `printed-card-${number}-${serial}` };
}

function bakugan(
  id: string,
  faction: Faction,
  bPower: number,
  damage: number,
  extra: Partial<Bakugan> = {},
): Bakugan {
  const printedCharacter = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);
  assert.ok(printedCharacter, `Missing ${faction} Character definition`);
  const character: GameCard = {
    ...printedCharacter,
    id: `${id}-character`,
    bPower,
    damage,
  };
  return {
    id,
    name: id,
    faction,
    bPower,
    damage,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character,
    open: false,
    heldCoreCells: [],
    evoStack: [],
    ...extra,
  };
}

function core(id: string, bonus = 0, damageBonus = 0): Core {
  serial += 1;
  return {
    id,
    catalogId: id,
    number: serial,
    name: id,
    type: "Fist",
    bonus,
    damageBonus,
    art: "",
  };
}

function player(
  id: string,
  bakuganTeam: Bakugan[],
  cores: Core[] = [],
  hand: GameCard[] = [],
): PlayerState {
  return {
    id,
    name: id,
    bakugan: bakuganTeam,
    cores,
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

function matchWith(
  ai: PlayerState,
  human: PlayerState,
  phase: MatchState["phase"] = "power",
) {
  const match = createMatch("AITACTICS", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = phase;
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.stepLabel = phase;
  return match;
}

function addEnergy(owner: PlayerState, amount: number) {
  owner.energyZone = Array.from(
    { length: amount },
    (_, index) => printedCard(10, `${owner.id}-energy-${index}`),
  );
  owner.maxEnergy = amount;
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
    cores: result === "miss-closed" ? [] : [CENTER_CELL],
    accuracyRoll: 0,
    deviationRoll: 0,
    doubleRoll: 0,
    secondCoreRoll: 0,
    doubleCore: false,
    path: [],
    note: "test",
  };
}

function setBrawl(
  match: MatchState,
  ai: PlayerState,
  human: PlayerState,
  aiOpen: boolean,
  humanOpen: boolean,
) {
  const aiBakugan = ai.bakugan[0];
  const humanBakugan = human.bakugan[0];
  aiBakugan.open = aiOpen;
  humanBakugan.open = humanOpen;
  match.selected[ai.id] = aiBakugan.id;
  match.selected[human.id] = humanBakugan.id;
  match.rolls[ai.id] = roll(
    ai.id,
    aiBakugan.id,
    aiOpen ? "open-no-core" : "miss-closed",
  );
  match.rolls[human.id] = roll(
    human.id,
    humanBakugan.id,
    humanOpen ? "open-no-core" : "miss-closed",
  );
}

function cell(q: number, r: number) {
  const found = HEX_CELLS.find((candidate) => candidate.q === q && candidate.r === r);
  assert.ok(found);
  return found.id;
}

test("AI does not spend a pure temporary combat card after its Bakugan misses", () => {
  const boost = printedCard(16, "missed-boost"); // Ice Wall: +900 B for 4 Energy.
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [boost]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  addEnergy(ai, 4);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, false, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === boost.id));
});

test("AI keeps a temporary B-Power card that cannot turn a loss into a win", () => {
  const boost = printedCard(49, "too-small-boost"); // Smoke Armor: +500 B for 3 Energy.
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [boost]);
  const human = player("human", [bakugan("human-b", "Pyrus", 1200, 5)]);
  addEnergy(ai, 3);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === boost.id));
});

test("AI commits a temporary B-Power card when the complete effect wins the Brawl", () => {
  const boost = printedCard(49, "winning-boost"); // Smoke Armor: +500 B for 3 Energy.
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [boost]);
  const human = player("human", [bakugan("human-b", "Pyrus", 900, 5)]);
  addEnergy(ai, 3);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, boost.id);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === boost.id), false);
});

test("independent card value remains playable even when its combat clause is insufficient", () => {
  const utility = printedCard(2, "study-the-fight"); // Aquos Shield: +200 B and conditional draw.
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [utility]);
  const human = player("human", [bakugan("human-b", "Pyrus", 1500, 5)]);
  addEnergy(ai, 2);
  ai.deckCards = [printedCard(10, "draw-target")];
  ai.deck = 1;
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, utility.id);
});

test("Core placement branches instead of extending a player-facing straight line", () => {
  const lineOne = core("line-one");
  const lineTwo = core("line-two");
  const remaining = core("remaining");
  const ai = player(
    "ai",
    [bakugan("ai-b", "Aquos", 500, 5)],
    [lineOne, lineTwo, remaining],
  );
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)], [core("centre")]);
  const match = matchWith(ai, human, "placement");
  match.placements = [
    { playerId: human.id, core: human.cores[0], cell: CENTER_CELL, order: 1 },
    { playerId: ai.id, core: lineOne, cell: cell(0, 1), order: 2 },
    { playerId: ai.id, core: lineTwo, cell: cell(0, 2), order: 3 },
  ];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const placed = next.placements.at(-1);
  assert.equal(placed?.core.id, remaining.id);
  const placedCell = HEX_CELLS.find((candidate) => candidate.id === placed?.cell);
  assert.ok(placedCell);
  assert.notEqual(placedCell.q, 0);
});
