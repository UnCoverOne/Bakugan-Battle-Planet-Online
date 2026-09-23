import assert from "node:assert/strict";
import test from "node:test";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  HEX_CELLS,
  createMatch,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { bestAiRollTarget } from "../lib/aiRollForecast";
import { chooseOpponentAiCommand } from "../lib/opponentAi";
import { recoverOpponentAiCommand } from "../lib/opponentAiCanAct";
import { decideOpponentAiWorkerRequest } from "../lib/opponentAiWorkerProtocol";

let serial = 0;

function namedCard(name: string, instanceId?: string): GameCard {
  const source = CARDS.find((candidate) => (
    candidate.name === name || candidate.displayName === name
  ));
  assert.ok(source, `Missing catalogue card ${name}`);
  serial += 1;
  return { ...source, id: instanceId ?? `${source.catalogId}-test-${serial}` };
}

function mightOfCyndeus(instanceId?: string) {
  const source = CARDS.find((candidate) => (
    /Might of Cynde(?:us|ous)/i.test(candidate.name)
    || /Might of Cynde(?:us|ous)/i.test(candidate.displayName)
  ));
  assert.ok(source, "Missing Might of Cyndeus printing");
  serial += 1;
  return { ...source, id: instanceId ?? `${source.catalogId}-test-${serial}` };
}

function bakugan(
  id: string,
  faction: Faction,
  bPower: number,
  damage: number,
): Bakugan {
  const printedCharacter = CARDS.find((candidate) => (
    candidate.type === "Character" && candidate.faction === faction
  ));
  assert.ok(printedCharacter, `Missing ${faction} Character definition`);
  return {
    id,
    name: id,
    faction,
    bPower,
    damage,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character: {
      ...printedCharacter,
      id: `${id}-character`,
      bPower,
      damage,
    },
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
}


function catalogueBakugan(catalogId: string, id: string): Bakugan {
  const character = CARDS.find((candidate) => (
    candidate.catalogId === catalogId && candidate.type === "Character"
  ));
  assert.ok(character, `Missing Character ${catalogId}`);
  return {
    id,
    name: character.displayName || character.name,
    faction: character.faction,
    bPower: character.bPower ?? 0,
    damage: character.damage ?? 0,
    rollAccuracy: catalogId === "br-227" ? 85 : 90,
    doubleCoreChance: catalogId === "br-227" ? 10 : 5,
    art: character.art,
    character: { ...character, id: `${id}-character` },
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
}

function core(
  id: string,
  bonus = 0,
  damageBonus = 0,
  type: Core["type"] = "Fist",
): Core {
  serial += 1;
  return {
    id,
    catalogId: id,
    number: 9000 + serial,
    name: id,
    type,
    bonus,
    damageBonus,
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
  const source = CARDS.find((candidate) => candidate.type === "Action");
  assert.ok(source);
  owner.energyZone = Array.from({ length: amount }, (_, index) => ({
    ...source,
    id: `${owner.id}-energy-${index}`,
  }));
}

function roll(
  playerId: string,
  bakuganId: string,
  result: RollOutcome["result"] = "open-no-core",
): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result,
    cores: [],
    accuracyRoll: 0,
    deviationRoll: 0,
    doubleRoll: 0,
    secondCoreRoll: 0,
    doubleCore: false,
    path: [],
    note: "test",
  };
}

function powerMatch(
  aiPower: number,
  aiDamage: number,
  humanPower: number,
  humanDamage: number,
  hand: GameCard[],
) {
  const ai = player("training-bot", [bakugan("ai-bakugan", "Pyrus", aiPower, aiDamage)], hand);
  const human = player("human", [bakugan("human-bakugan", "Aquos", humanPower, humanDamage)]);
  addEnergy(ai, 8);
  const match = createMatch("AI-SEQUENCING", "bo1", [ai, human]);
  const matchAi = match.players.find((candidate) => candidate.id === ai.id)!;
  const matchHuman = match.players.find((candidate) => candidate.id === human.id)!;
  match.turn = 3;
  match.phase = "power";
  match.stepLabel = "Brawl Phase • Power Step";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  matchAi.bakugan[0].open = true;
  matchHuman.bakugan[0].open = true;
  match.selected[ai.id] = matchAi.bakugan[0].id;
  match.selected[human.id] = matchHuman.bakugan[0].id;
  match.rolls[ai.id] = roll(ai.id, matchAi.bakugan[0].id);
  match.rolls[human.id] = roll(human.id, matchHuman.bakugan[0].id);
  return { match, ai: matchAi, human: matchHuman };
}

function farCell() {
  const found = HEX_CELLS.find((candidate) => candidate.q === 3 && candidate.r === 0);
  assert.ok(found);
  return found.id;
}

test("AI reserves Superfuel while already winning if its next-card discount has no useful follow-up", () => {
  const superfuel = namedCard("Superfuel", "superfuel-no-follow-up");
  const { match, ai } = powerMatch(800, 4, 500, 7, [superfuel]);

  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PASS_PRIORITY");
});

test("AI evaluates Superfuel and its discounted follow-up as one continuation line", () => {
  const superfuel = namedCard("Superfuel", "superfuel-combo");
  const payoff = namedCard("Smoke Armor", "superfuel-payoff");
  const { match, ai } = powerMatch(500, 4, 900, 5, [superfuel, payoff]);
  addEnergy(ai, 1);
  match.placements = [
    { playerId: ai.id, core: core("superfuel-neutral-core"), cell: CENTER_CELL, order: 1 },
  ];

  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PLAY_CARD");
  if (command?.type === "PLAY_CARD") assert.equal(command.cardId, superfuel.id);

  // The same evaluator used by the planner must select the winning payoff once
  // the setup has actually created the next-card reduction.
  ai.hand = [payoff];
  match.nextCardCostReduction[ai.id] = 3;
  const followUp = chooseOpponentAiCommand(match, ai.id);
  assert.equal(followUp?.type, "PLAY_CARD");
  if (followUp?.type === "PLAY_CARD") assert.equal(followUp.cardId, payoff.id);
});

test("AI does not throw away a B-Power lead with an unnecessary Might of Cyndeus switch", () => {
  const might = mightOfCyndeus("might-unneeded");
  const expensivePower = namedCard("Lava Boost", "retained-power-buff");
  const { match, ai } = powerMatch(900, 2, 500, 8, [might, expensivePower]);

  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PASS_PRIORITY");
});

test("AI still uses Might of Cyndeus when changing to Damage converts a loss into a win", () => {
  const might = mightOfCyndeus("might-needed");
  const { match, ai } = powerMatch(400, 8, 800, 3, [might]);

  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PLAY_CARD");
  if (command?.type === "PLAY_CARD") assert.equal(command.cardId, might.id);
});

test("Damage-Victor rerolls target the BakuCore that creates the Damage lead instead of generic B-Power", () => {
  const { match, ai, human } = powerMatch(700, 2, 400, 7, []);
  match.phase = "reroll";
  match.victorByDamage = true;
  const highPower = core("high-power-core", 1000, 0);
  const highDamage = core("high-damage-core", 0, 6);
  const damageCell = farCell();
  match.placements = [
    { playerId: ai.id, core: highPower, cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: highDamage, cell: damageCell, order: 2 },
  ];

  assert.equal(bestAiRollTarget(match, ai.id)?.cell, damageCell);
});

test("Damage-Victor AI spends a reroll card when a high-Damage target is its only credible winning route", () => {
  const superfuel = namedCard("Superfuel", "superfuel-damage-recovery");
  const { match, ai, human } = powerMatch(900, 2, 400, 7, [superfuel]);
  match.victorByDamage = true;
  const highPower = core("reroll-high-power-core", 1000, 0);
  const highDamage = core("reroll-high-damage-core", 0, 6);
  match.placements = [
    { playerId: ai.id, core: highPower, cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: highDamage, cell: farCell(), order: 2 },
  ];

  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PLAY_CARD");
  if (command?.type === "PLAY_CARD") assert.equal(command.cardId, superfuel.id);
});

test("AI retains chained Superfuel when losing and no available core improves the brawl", () => {
  const fuel = namedCard("Superfuel", "fuel-first");
  const otherFuel = namedCard("Superfuel", "fuel-second");
  const {match, ai} = powerMatch(400, 2, 2100, 7, [fuel, otherFuel]);
  addEnergy(ai, 1);
  const weakCore = core("no-improvement", 0, 0);
  match.placements = [{playerId: ai.id, core: weakCore, cell: CENTER_CELL, order: 1}];
  assert.equal(chooseOpponentAiCommand(match, ai.id)?.type, "PASS_PRIORITY");
  ai.hand = [otherFuel];
  match.nextCardCostReduction[ai.id] = 3;
  assert.equal(chooseOpponentAiCommand(match, ai.id)?.type, "PASS_PRIORITY");
});

test("AI retains a useful Superfuel reroll that can overcome a B-Power deficit", () => {
  const fuel = namedCard("Superfuel", "fuel-winning-reroll");
  const {match, ai} = powerMatch(400, 2, 700, 7, [fuel]);
  match.placements = [{playerId: ai.id, core: core("winning-core", 1000, 0), cell: CENTER_CELL, order: 1}];
  const command = chooseOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "PLAY_CARD");
  if (command?.type === "PLAY_CARD") assert.equal(command.cardId, fuel.id);
});


test("emergency Energize recovery always develops a nonempty hand at zero Energy", () => {
  const nillious = catalogueBakugan("bb-337", "recovery-nillious");
  const ai = player("training-bot", [nillious], [
    namedCard("Haos Titan Nillious", "recovery-titan"),
    namedCard("Tides", "recovery-tides"),
  ]);
  const human = player("human", [bakugan("recovery-human", "Aquos", 500, 5)]);
  const match = createMatch("AI-RECOVERY-ENERGY", "bo1", [ai, human]);
  match.turn = 1;
  match.phase = "energize";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.players.find((candidate) => candidate.id === ai.id)!.energizedThisTurn = false;

  const command = recoverOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "ENERGIZE");
  if (command?.type === "ENERGIZE") {
    assert.ok(command.cardId);
    assert.ok(ai.hand.some((card) => card.id === command.cardId));
  }
});

test("emergency Bakugan recovery ranks Core-aware strength instead of taking array position zero", () => {
  const nillious = catalogueBakugan("bb-337", "recovery-haos-nillious");
  const cubbo = catalogueBakugan("br-167", "recovery-aquos-cubbo");
  const nobilious = catalogueBakugan("br-227", "recovery-pyrus-nobilious");
  const ai = player("training-bot", [nillious, cubbo, nobilious]);
  const human = player("human", [bakugan("recovery-selection-human", "Aquos", 500, 5)]);
  const match = createMatch("AI-RECOVERY-SELECTION", "bo1", [ai, human]);
  match.turn = 1;
  match.phase = "selection";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.placements = [{
    playerId: ai.id,
    core: core("recovery-magic-shield", 0, 0, "Magic Shield"),
    cell: CENTER_CELL,
    order: 1,
  }];

  const command = recoverOpponentAiCommand(match, ai.id);
  assert.equal(command?.type, "SELECT_BAKUGAN");
  if (command?.type === "SELECT_BAKUGAN") {
    assert.equal(command.bakuganId, cubbo.id);
    assert.notEqual(command.bakuganId, nillious.id);
  }
});

test("an unaffordable Titan Nillious in hand does not force tactical selection of base Nillious", () => {
  const nillious = catalogueBakugan("bb-337", "tactical-haos-nillious");
  const cubbo = catalogueBakugan("br-167", "tactical-aquos-cubbo");
  const nobilious = catalogueBakugan("br-227", "tactical-pyrus-nobilious");
  const titan = namedCard("Haos Titan Nillious", "tactical-titan-nillious");
  const ai = player("training-bot", [nillious, cubbo, nobilious], [titan]);
  const human = player("human", [bakugan("tactical-selection-human", "Aquos", 500, 5)]);
  const match = createMatch("AI-TACTICAL-SELECTION", "bo1", [ai, human]);
  match.turn = 1;
  match.phase = "selection";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.placements = [{
    playerId: ai.id,
    core: core("tactical-magic-shield", 0, 0, "Magic Shield"),
    cell: CENTER_CELL,
    order: 1,
  }];

  const serialized = JSON.parse(JSON.stringify(match)) as typeof match;
  const response = decideOpponentAiWorkerRequest({
    type: "decide",
    requestId: 824290,
    match: serialized,
    playerId: ai.id,
  });
  assert.equal(response.error, undefined);
  const command = response.command;
  assert.equal(command?.type, "SELECT_BAKUGAN");
  if (command?.type === "SELECT_BAKUGAN") {
    assert.notEqual(command.bakuganId, nillious.id);
  }
});
