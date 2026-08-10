import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  HEX_CELLS,
  createMatch,
  passPriority,
  prepareCardPlay,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";
import { recoverOpponentAiFailure } from "../lib/opponentAiCanAct";
import { ruleDefinitionForCard } from "../lib/rules";

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

test("a failed AI decision cannot strand pre-roll priority after the player passes", () => {
  const ai = player("training-bot", [bakugan("pre-roll-ai", "Aquos", 500, 5)]);
  const human = player("human", [bakugan("pre-roll-human", "Pyrus", 500, 5)]);
  let match = matchWith(ai, human, "preRoll");
  match.startingPlayer = human.id;
  match.priority = human.id;
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  match = passPriority(match, human.id);
  assert.equal(match.priority, ai.id);
  assert.deepEqual(match.passes, [human.id]);

  const recovered = recoverOpponentAiFailure(match, ai.id);
  assert.ok(recovered);
  assert.equal(recovered.phase, "target");
  assert.equal(recovered.priority, human.id);
  assert.deepEqual(recovered.passes, []);
});

test("a failed AI decision passes safely in every normal priority step", () => {
  for (const phase of ["preRoll", "power", "victor", "postDamage", "endPlay"] as const) {
    const ai = player(
      "training-bot",
      [bakugan(`priority-${phase}-ai`, "Aquos", 700, 5)],
    );
    const human = player(
      "human",
      [bakugan(`priority-${phase}-human`, "Pyrus", 500, 5)],
    );
    const match = matchWith(ai, human, phase);

    const recovered = recoverOpponentAiFailure(match, ai.id);
    assert.ok(recovered, `Expected recovery during ${phase}`);
    assert.equal(recovered.phase, phase);
    assert.equal(recovered.priority, human.id);
    assert.deepEqual(recovered.passes, [ai.id]);
  }
});

test("a failed AI decision advances Power after the player has already passed", () => {
  const ai = player("training-bot", [bakugan("power-ai", "Aquos", 700, 5)]);
  const human = player("human", [bakugan("power-human", "Pyrus", 500, 5)]);
  let match = matchWith(ai, human, "power");
  match.startingPlayer = human.id;
  match.priority = human.id;
  setBrawl(match, ai, human, true, true);

  match = passPriority(match, human.id);
  assert.equal(match.priority, ai.id);
  assert.deepEqual(match.passes, [human.id]);

  const recovered = recoverOpponentAiFailure(match, ai.id);
  assert.ok(recovered);
  assert.equal(recovered.phase, "victor");
  assert.equal(recovered.brawlWinner, ai.id);
  assert.deepEqual(recovered.passes, []);
});

test("failed AI decisions also recover mandatory energize and hand-limit windows", () => {
  const ai = player("training-bot", [bakugan("mandatory-ai", "Aquos", 500, 5)]);
  const human = player("human", [bakugan("mandatory-human", "Pyrus", 500, 5)]);
  const energize = matchWith(ai, human, "energize");

  const skipped = recoverOpponentAiFailure(energize, ai.id);
  assert.ok(skipped);
  assert.equal(skipped.players[0].energizedThisTurn, true);

  const overLimit = player(
    "training-bot",
    [bakugan("hand-limit-ai", "Aquos", 500, 5)],
    [],
    Array.from({ length: 9 }, (_, index) => printedCard(10, `hand-limit-${index}`)),
  );
  const handLimit = matchWith(overLimit, human, "handLimit");
  const discarded = recoverOpponentAiFailure(handLimit, overLimit.id);
  assert.ok(discarded);
  assert.equal(discarded.players[0].hand.length, 7);
  assert.equal(discarded.players[0].discard.length, 2);
});

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

test("AI keeps Tides when it already has the higher B-Power", () => {
  const tides = printedCard(24, "redundant-tides");
  assert.equal(tides.displayName || tides.name, "Tides");
  const ai = player("ai", [bakugan("ai-b", "Aquos", 900, 5)], [], [tides]);
  const human = player("human", [bakugan("human-b", "Pyrus", 700, 5)]);
  ai.cardsPlayedThisTurn = 1;
  addEnergy(ai, 1);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === tides.id));
});

test("AI plays Tides when its active Flow branch changes the projected Victor", () => {
  const tides = printedCard(24, "winning-tides");
  assert.equal(tides.displayName || tides.name, "Tides");
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [tides]);
  const human = player("human", [bakugan("human-b", "Pyrus", 800, 5)]);
  ai.cardsPlayedThisTurn = 1;
  addEnergy(ai, 1);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, tides.id);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === tides.id), false);
});

test("AI keeps Tides when its Flow bonus still cannot win the Brawl", () => {
  const tides = printedCard(24, "insufficient-tides");
  assert.equal(tides.displayName || tides.name, "Tides");
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [tides]);
  const human = player("human", [bakugan("human-b", "Pyrus", 1000, 5)]);
  ai.cardsPlayedThisTurn = 1;
  addEnergy(ai, 1);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === tides.id));
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

test("AI Evo with optional unimplemented reminder text resolves after both players pass", () => {
  const evoSource = CARDS.find((card) => card.catalogId === "br-158");
  assert.ok(evoSource);
  const definition = ruleDefinitionForCard(evoSource);
  const characterSource = CARDS.find((card) => (
    card.type === "Character" && definition.play.evolvesFrom.includes(card.catalogId as `bb-${number}`)
  ));
  assert.ok(characterSource);

  const evo = { ...evoSource, id: "ai-maximus-gorthion" };
  const target = bakugan("ai-gorthion", characterSource.faction, characterSource.bPower ?? 0, characterSource.damage ?? 0, {
    character: { ...characterSource, id: "ai-gorthion-character" },
    name: characterSource.displayName || characterSource.name,
  });
  const ai = player("ai", [target], [], [evo]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  addEnergy(ai, Number(evo.cost));
  ai.energy = Number(evo.cost);
  let state = prepareCardPlay(matchWith(ai, human), ai.id, evo.id);
  assert.equal(state.pendingChoice?.kind, "card-play");

  state = advanceOpponentAi(state, ai.id)!;
  assert.equal(state.batch.at(-1)?.card.id, evo.id);
  assert.equal(state.pendingChoice, undefined);

  state = advanceOpponentAi(state, ai.id)!;
  assert.equal(state.priority, human.id);
  state = passPriority(state, human.id);

  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.batch.length, 0);
  assert.equal(state.players[0].bakugan[0].evoStack.at(-1)?.id, evo.id);
});

function catalogueCard(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function preRollReservationMatch(input: {
  energy: number;
  buffInHand?: boolean;
  existingShuns?: number;
  deckCards?: GameCard[];
}) {
  const shun = catalogueCard("br-77", "reservation-shun");
  const smokeArmor = catalogueCard("bb-49", "reservation-smoke-armor");
  const ai = player(
    "ai",
    [bakugan("ai-reservation-b", "Aquos", 500, 5)],
    [],
    [shun, ...(input.buffInHand === false ? [] : [smokeArmor])],
  );
  const human = player(
    "human",
    [bakugan("human-reservation-b", "Pyrus", 900, 5)],
  );
  addEnergy(ai, input.energy);
  ai.heroes = Array.from({ length: input.existingShuns ?? 0 }, (_, index) => (
    catalogueCard("br-77", `existing-shun-${index}`)
  ));
  ai.deckCards = input.deckCards ?? [
    catalogueCard("bb-10", "reservation-deck-filler-1"),
    catalogueCard("bb-11", "reservation-deck-filler-2"),
    catalogueCard("bb-12", "reservation-deck-filler-3"),
  ];
  ai.deck = ai.deckCards.length;
  const match = matchWith(ai, human, "preRoll");
  const secondCell = cell(1, 0);
  match.placements = [
    { playerId: ai.id, core: core("reservation-core-a"), cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: core("reservation-core-b"), cell: secondCell, order: 2 },
  ];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;
  return { match, ai, shun, smokeArmor };
}


test("AI waits to play Tides before the Roll even when Flow is active", () => {
  const tides = catalogueCard("bb-24", "pre-roll-flow-tides");
  const ai = player(
    "ai",
    [bakugan("ai-pre-roll-flow", "Aquos", 500, 5)],
    [],
    [tides],
  );
  const human = player(
    "human",
    [bakugan("human-pre-roll-flow", "Pyrus", 800, 5)],
  );
  addEnergy(ai, 1);
  ai.cardsPlayedThisTurn = 1;
  const match = matchWith(ai, human, "preRoll");
  match.placements = [
    { playerId: ai.id, core: core("pre-roll-flow-core-a"), cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: core("pre-roll-flow-core-b"), cell: cell(1, 0), order: 2 },
  ];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((card) => card.id === tides.id));
  assert.equal(next.priority, human.id);
});

test("AI waits to play Tides before the Roll when its base branch could swing the Brawl", () => {
  const tides = catalogueCard("bb-24", "pre-roll-base-tides");
  const ai = player(
    "ai",
    [bakugan("ai-pre-roll-base", "Aquos", 500, 5)],
    [],
    [tides],
  );
  const human = player(
    "human",
    [bakugan("human-pre-roll-base", "Pyrus", 600, 5)],
  );
  addEnergy(ai, 1);
  const match = matchWith(ai, human, "preRoll");
  match.placements = [
    { playerId: ai.id, core: core("pre-roll-base-core-a"), cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: core("pre-roll-base-core-b"), cell: cell(1, 0), order: 2 },
  ];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((card) => card.id === tides.id));
});

test("AI may still play a hybrid pre-Roll card for independent draw value", () => {
  const shield = catalogueCard("bb-2", "pre-roll-aquos-shield");
  const ai = player(
    "ai",
    [bakugan("ai-pre-roll-hybrid", "Aquos", 500, 5)],
    [],
    [shield],
  );
  const human = player(
    "human",
    [bakugan("human-pre-roll-hybrid", "Pyrus", 1500, 5)],
  );
  addEnergy(ai, 2);
  ai.deckCards = [catalogueCard("bb-10", "pre-roll-hybrid-draw")];
  ai.deck = 1;
  const match = matchWith(ai, human, "preRoll");
  match.placements = [
    { playerId: ai.id, core: core("pre-roll-hybrid-core-a"), cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: core("pre-roll-hybrid-core-b"), cell: cell(1, 0), order: 2 },
  ];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shield.id);
});

test("AI reserves Energy for an in-hand B-Power response that can swing the forecasted Brawl", () => {
  const { match, ai, shun, smokeArmor } = preRollReservationMatch({ energy: 3 });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((card) => card.id === shun.id));
  assert.ok(next.players[0].hand.some((card) => card.id === smokeArmor.id));
  assert.equal(next.priority, "human");
});

test("AI plays the draw Hero when enough Energy remains for the same B-Power response", () => {
  const { match, ai, shun, smokeArmor } = preRollReservationMatch({ energy: 6 });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
  assert.ok(next.players[0].hand.some((card) => card.id === smokeArmor.id));
});

test("AI values a draw Hero when its deck can produce an affordable missing response", () => {
  const tides = [0, 1, 2].map((index) => catalogueCard("bb-24", `reservation-tides-${index}`));
  const { match, ai, shun } = preRollReservationMatch({
    energy: 4,
    buffInHand: false,
    deckCards: tides,
  });
  ai.cardsPlayedThisTurn = 1;
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
});

test("AI has no hard ban on a third draw Hero when tactical Energy remains available", () => {
  const { match, ai, shun } = preRollReservationMatch({
    energy: 6,
    existingShuns: 2,
  });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
});


test("AI plays a hand Reroll after opening without a Core when a Core pickup can win", () => {
  const source = CARDS.find((card) => (card.displayName || card.name) === "Superfuel");
  assert.ok(source);
  const rerollCard = { ...source, id: "winning-open-no-core-reroll" };
  const ai = player(
    "ai",
    [bakugan("ai-reroll-b", "Aquos", 500, 5)],
    [],
    [rerollCard],
  );
  const human = player(
    "human",
    [bakugan("human-reroll-b", "Pyrus", 900, 5)],
  );
  addEnergy(ai, source.cost === "X" ? 4 : Number(source.cost));
  const match = matchWith(ai, human);
  const winningCore = core("winning-reroll-core", 700);
  match.placements = [{
    playerId: human.id,
    core: winningCore,
    cell: CENTER_CELL,
    order: 1,
  }];
  setBrawl(match, ai, human, true, true);
  match.rolls[ai.id] = roll(ai.id, ai.bakugan[0].id, "open-no-core");
  match.rolls[ai.id].cores = [];
  match.rolls[human.id] = roll(human.id, human.bakugan[0].id, "open-no-core");
  match.rolls[human.id].cores = [];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.players[0].hand.some((card) => card.id === rerollCard.id), false);
});

test("AI starts a jointly winning temporary B-Power sequence when no single card is sufficient", () => {
  const first = printedCard(49, "combo-smoke-armor-one");
  const second = printedCard(49, "combo-smoke-armor-two");
  const ai = player(
    "ai",
    [bakugan("ai-combo-b", "Aquos", 500, 5)],
    [],
    [first, second],
  );
  const human = player(
    "human",
    [bakugan("human-combo-b", "Pyrus", 1300, 5)],
  );
  addEnergy(ai, 6);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.ok([first.id, second.id].includes(next.batch.at(-1)?.card.id ?? ""));
  assert.equal(
    next.players[0].hand.filter((card) => [first.id, second.id].includes(card.id)).length,
    1,
  );
});


test("AI chooses the minimum-resource sufficient B-Power card", () => {
  const efficient = catalogueCard("bb-43", "efficient-prismatic-shield"); // +200 B, 1 Energy.
  const overkill = catalogueCard("bb-49", "overkill-smoke-armor"); // +500 B, 3 Energy.
  const ai = player("efficient-ai", [bakugan("efficient-ai-b", "Aquos", 500, 5)], [], [efficient, overkill]);
  const human = player("efficient-human", [bakugan("efficient-human-b", "Pyrus", 650, 5)]);
  addEnergy(ai, 3);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, efficient.id);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === overkill.id), true);
});

test("AI does not spend a debuff whose B-Power reduction is blocked by ShadowStrike", () => {
  const debuff = catalogueCard("aa-45", "shadowstrike-wild-roar"); // -300 B.
  const ai = player("shadow-ai", [bakugan("shadow-ai-b", "Ventus", 500, 5)], [], [debuff]);
  const human = player("shadow-human", [bakugan("shadow-human-b", "Darkus", 700, 5)]);
  addEnergy(ai, 1);
  const match = matchWith(ai, human);
  setBrawl(match, ai, human, true, true);
  match.shadowStrike[human.bakugan[0].id] = true;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === debuff.id), true);
});

test("AI preserves Quickfire until its optional Reroll can be used", () => {
  const quickfire = catalogueCard("br-44", "pre-roll-quickfire");
  assert.equal(quickfire.displayName || quickfire.name, "Quickfire");
  const ai = player(
    "ai",
    [bakugan("quickfire-ai", "Pyrus", 500, 5)],
    [],
    [quickfire],
  );
  const human = player(
    "human",
    [bakugan("quickfire-human", "Aquos", 500, 5)],
  );
  const match = matchWith(ai, human, "preRoll");
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((card) => card.id === quickfire.id));
  assert.equal(next.priority, human.id);
});
