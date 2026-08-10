import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, CORES } from "../lib/data";
import {
  createMatch,
  type Bakugan,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
} from "../lib/game";
import {
  advanceOpponentAi,
  estimateFutureRerollValue,
  planOpponentEnergize,
} from "../lib/opponentAiBase";

let serial = 0;

function printedCard(number: number, id?: string): GameCard {
  const source = CARDS.find((card) => card.number === number);
  assert.ok(source, `Missing printed card ${number}`);
  serial += 1;
  return { ...source, id: id ?? `ai-plan-${number}-${serial}` };
}

function catalogCard(catalogId: string, id?: string): GameCard {
  const source = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  serial += 1;
  return { ...source, id: id ?? `ai-plan-${catalogId}-${serial}` };
}

function bakugan(id: string, faction: Faction): Bakugan {
  const character = CARDS.find((card) => (
    card.type === "Character" && card.faction === faction
  ));
  assert.ok(character);
  return {
    id,
    name: id,
    faction,
    bPower: character.bPower ?? 500,
    damage: character.damage ?? 5,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character: { ...character, id: `${id}-character` },
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
}

function player(
  id: string,
  hand: GameCard[],
  deckCards: GameCard[] = [],
): PlayerState {
  return {
    id,
    name: id,
    bakugan: [bakugan(`${id}-bakugan`, id === "ai" ? "Aquos" : "Pyrus")],
    cores: [],
    deck: deckCards.length,
    deckCards,
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
  owner.energyZone = Array.from({ length: amount }, (_, index) => (
    printedCard(10, `${owner.id}-energy-${index}`)
  ));
  owner.maxEnergy = amount;
}

function energizeMatch(ai: PlayerState, human = player("human", [])) {
  const match = createMatch("AIENERGIZE", "bo1", [ai, human]);
  match.turn = 3;
  match.phase = "energize";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.stepLabel = "Energize Step";
  return match;
}

test("a stranded Flip has zero hand value but does not force Energize", () => {
  const flip = printedCard(144, "dead-flip");
  const early = printedCard(17, "early-action");
  const ai = player("ai", [flip, early]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, false);
  assert.equal(plan.reason, "no-energy-goal");
});

test("a Flip is naturally the least costly card when a reachable hand goal exists", () => {
  const flip = printedCard(144, "goal-flip");
  const early = printedCard(17, "goal-early");
  const goal = printedCard(35, "four-cost-goal");
  const ai = player("ai", [flip, early, goal]);
  addEnergy(ai, 2);
  const match = energizeMatch(ai);
  const plan = planOpponentEnergize(match, ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, flip.id);
  assert.equal(plan.goalSource, "hand-card");

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const nextAi = next.players.find((candidate) => candidate.id === ai.id)!;
  assert.ok(nextAi.energyZone.some((card) => card.id === flip.id));
  assert.equal(nextAi.hand.some((card) => card.id === flip.id), false);
});

test("the AI protects its sole affordable card and skips without expendable fodder", () => {
  const early = printedCard(17, "sole-playable");
  const goal = printedCard(35, "sole-goal");
  const ai = player("ai", [early, goal]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, false);
  assert.equal(plan.reason, "no-expendable-card");
  assert.equal(plan.goalSource, "hand-card");
});

test("the AI recognizes a reachable two-card sequence as Energy demand", () => {
  const first = printedCard(2, "combo-first");
  const second = printedCard(22, "combo-second");
  const flip = printedCard(144, "combo-flip");
  const ai = player("ai", [first, second, flip]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, flip.id);
  assert.equal(plan.goalSource, "hand-combo");
  assert.deepEqual(new Set(plan.goalCardIds), new Set([first.id, second.id]));
});

test("replaceable late-game cards are energized before early playable cards", () => {
  const earlyA = printedCard(17, "early-a");
  const earlyB = printedCard(26, "early-b");
  const late = printedCard(97, "late-fodder");
  const goal = printedCard(35, "late-goal");
  const deckCopies = [
    printedCard(97, "late-copy-1"),
    printedCard(97, "late-copy-2"),
  ];
  const ai = player("ai", [earlyA, earlyB, late, goal], deckCopies);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, late.id);
  assert.equal(plan.goalSource, "hand-card");
});

test("remaining deck composition creates lower-weight probabilistic Energy demand", () => {
  const flip = printedCard(144, "deck-flip");
  const early = printedCard(17, "deck-early");
  const filler = Array.from({ length: 7 }, (_, index) => (
    printedCard(26, `deck-filler-${index}`)
  ));
  const futureCopies = [
    printedCard(35, "deck-goal-1"),
    printedCard(35, "deck-goal-2"),
    printedCard(35, "deck-goal-3"),
  ];
  const ai = player("ai", [flip, early], [...filler, ...futureCopies]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, flip.id);
  assert.equal(plan.goalSource, "deck");
  assert.equal(plan.reason, "probable-deck-card");
});

test("a remote low-probability deck card is not enough to justify Energize", () => {
  const flip = printedCard(144, "remote-flip");
  const early = printedCard(17, "remote-early");
  const remote = printedCard(131, "remote-goal");
  const filler = Array.from({ length: 29 }, (_, index) => (
    printedCard(26, `remote-filler-${index}`)
  ));
  const ai = player("ai", [flip, early], [remote, ...filler]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, false);
  assert.equal(plan.reason, "no-energy-goal");
});

test("hand-limit discard treats a drawn Flip as zero retention value", () => {
  const flip = printedCard(144, "discard-flip");
  const playable = Array.from({ length: 7 }, (_, index) => (
    printedCard(17, `discard-playable-${index}`)
  ));
  const ai = player("ai", [flip, ...playable]);
  const match = energizeMatch(ai);
  match.phase = "handLimit";
  match.priority = ai.id;
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const nextAi = next.players.find((candidate) => candidate.id === ai.id)!;
  assert.ok(nextAi.discard.some((card) => card.id === flip.id));
  assert.equal(nextAi.hand.some((card) => card.id === flip.id), false);
});


test("zero-likelihood Flips are energized before Shun Kazami at zero Energy", () => {
  const rockRiser = catalogCard("br-74", "zero-energy-rock-riser");
  const confuse = catalogCard("br-67", "zero-energy-confuse");
  const shun = catalogCard("br-77", "zero-energy-shun");
  const goal = catalogCard("bb-17", "zero-energy-goal");
  const ai = player("ai", [rockRiser, confuse, shun, goal]);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.ok([rockRiser.id, confuse.id].includes(plan.cardId ?? ""));
  assert.notEqual(plan.cardId, shun.id);
});

test("future Reroll value is bounded and increases with repeatable on-open Heroes", () => {
  const darkWaters = catalogCard("br-5", "reroll-dark-waters");
  const ai = player("ai", [darkWaters]);
  const match = energizeMatch(ai);
  match.placements = [
    { playerId: ai.id, core: { ...CORES[22], id: "reroll-core-1" }, cell: "h3-3", order: 1 },
    { playerId: ai.id, core: { ...CORES[37], id: "reroll-core-2" }, cell: "h4-3", order: 2 },
    { playerId: "human", core: { ...CORES[26], id: "reroll-core-3" }, cell: "h2-3", order: 3 },
    { playerId: "human", core: { ...CORES[42], id: "reroll-core-4" }, cell: "h3-4", order: 4 },
  ];
  const base = estimateFutureRerollValue(match, ai.id, darkWaters);
  assert.ok(base > 0, `Expected positive future Reroll value, got ${base}`);
  assert.ok(base <= 6, `Expected bounded future Reroll value, got ${base}`);

  match.players.find((candidate) => candidate.id === ai.id)!.heroes = [
    catalogCard("br-77", "reroll-shun"),
  ];
  const withShun = estimateFutureRerollValue(match, ai.id, darkWaters);
  assert.ok(withShun > base, `Expected Shun to increase ${base}, got ${withShun}`);
  assert.ok(withShun <= 6, `Expected bounded Shun Reroll value, got ${withShun}`);
});


test("Energize protects a nested Flow combat response when expendable fodder exists", () => {
  const tides = catalogCard("bb-24", "energize-protected-tides");
  const flip = printedCard(144, "energize-tides-fodder");
  const goal = printedCard(35, "energize-tides-goal");
  const ai = player("ai", [tides, flip, goal]);
  addEnergy(ai, 2);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);
  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, flip.id);
  assert.notEqual(plan.cardId, tides.id);
});

test("Fierce Charge is energized before the reactive Action Blinding Ink", () => {
  const fierceCharge = catalogCard("aa-54", "stranded-fierce-charge");
  const blindingInk = catalogCard("br-3", "retained-blinding-ink");
  assert.equal(fierceCharge.displayName || fierceCharge.name, "Fierce Charge");
  assert.equal(blindingInk.displayName || blindingInk.name, "Blinding Ink");
  const ai = player("ai", [blindingInk, fierceCharge]);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);

  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.cardId, fierceCharge.id);
  const flipDiagnostic = plan.candidates?.find((candidate) => (
    candidate.cardId === fierceCharge.id
  ));
  const negateDiagnostic = plan.candidates?.find((candidate) => (
    candidate.cardId === blindingInk.id
  ));
  assert.equal(flipDiagnostic?.tier, 0);
  assert.equal(negateDiagnostic?.tier, 3);
  assert.ok(
    (negateDiagnostic?.opportunityCost ?? 0) > (flipDiagnostic?.opportunityCost ?? 0),
  );
});

test("zero-Energy first-round planning develops toward multiple low-cost Actions", () => {
  const blindingInk = catalogCard("br-3", "development-blinding-ink");
  const lowCostOne = catalogCard("bb-17", "development-action-one");
  const lowCostTwo = catalogCard("bb-26", "development-action-two");
  const ai = player("ai", [blindingInk, lowCostOne, lowCostTwo]);
  const plan = planOpponentEnergize(energizeMatch(ai), ai.id);

  assert.equal(plan.shouldEnergize, true);
  assert.equal(plan.goalSource, "development");
  assert.equal(plan.reason, "early-energy-development");
  assert.ok(plan.cardId);
  assert.ok(ai.hand.some((card) => card.id === plan.cardId));
  assert.ok((plan.goalScore ?? 0) > 0);
  assert.ok((plan.protectedCardIds?.length ?? 0) > 0);
});
