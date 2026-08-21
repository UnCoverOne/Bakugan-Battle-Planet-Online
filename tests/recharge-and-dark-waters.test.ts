import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  CENTER_CELL,
  createMatch,
  emitGameEvent,
  passPriority,
  submitCardChoice,
  type Bakugan,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
  type RollOutcome,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { activeTappedEnergyIds, rechargeEnergyCards } from "../lib/rules/costs";
import { ruleDefinitionForCard } from "../lib/rules";

let serial = 0;

function card(catalogId: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing ${catalogId}`);
  serial += 1;
  return { ...source, id: `${catalogId}-test-${serial}` };
}

function bakugan(id: string, faction: Faction, bPower: number, evo?: GameCard): Bakugan {
  const printedCharacter = CARDS.find(
    (candidate) => candidate.type === "Character" && candidate.faction === faction,
  );
  assert.ok(printedCharacter, `Missing ${faction} Character definition`);
  return {
    id,
    name: id,
    faction,
    bPower,
    damage: 5,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character: { ...printedCharacter, id: `${id}-character`, bPower, damage: 5 },
    open: true,
    heldCoreCells: [],
    evoStack: evo ? [evo] : [],
  };
}

function player(id: string, active: Bakugan, hand: GameCard[] = []): PlayerState {
  return {
    id,
    name: id,
    bakugan: [active],
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

function openRoll(playerId: string, bakuganId: string): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: CENTER_CELL,
    resolvedTarget: CENTER_CELL,
    result: "open-no-core",
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

function brawl(ai: PlayerState, human: PlayerState): MatchState {
  const match = createMatch("RECHARGE-AI", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = "power";
  match.stepLabel = "Power Step";
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.priority = ai.id;
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;
  match.rolls[ai.id] = openRoll(ai.id, ai.bakugan[0].id);
  match.rolls[human.id] = openRoll(human.id, human.bakugan[0].id);
  ai.bakugan[0].open = true;
  human.bakugan[0].open = true;
  return match;
}

function setEnergy(owner: PlayerState, amount: number, tapped: number, turn: number) {
  owner.energyZone = Array.from({ length: amount }, (_, index) => ({
    ...card("br-53"),
    id: `${owner.id}-energy-${index}`,
  }));
  Object.assign(owner, {
    energyTapTurn: turn,
    tappedEnergyIds: owner.energyZone.slice(0, tapped).map((energy) => energy.id),
  });
}

test("Recharge text compiles for Serpenteze and generic Recharge cards", () => {
  for (const [catalogId, expected] of [
    ["br-163", "all"],
    ["br-156", 2],
    ["br-52", "all"],
    ["br-75", "all"],
  ] as const) {
    const definition = ruleDefinitionForCard(card(catalogId));
    const actions = definition.abilities.flatMap((ability) =>
      ability.instructions.flatMap((instruction) => instruction.actions),
    );
    const recharge = actions.find((action) => action.kind === "recharge-energy");
    assert.ok(recharge, `${catalogId} should have a Recharge action`);
    assert.equal(recharge.amount, expected);
  }
  const titan = ruleDefinitionForCard(card("br-163"));
  assert.ok(titan.abilities.some((ability) => ability.trigger?.event === "BAKUGAN_OPENED"));
});

test("up-to Recharge choices expose only the controller's uncharged Energy", () => {
  const hyper = card("br-156");
  const ai = player("ai", bakugan("serpenteze", "Ventus", 700, hyper));
  const human = player("human", bakugan("human", "Pyrus", 500));
  const match = brawl(ai, human);
  setEnergy(match.players[0], 4, 3, match.turn);
  const definition = ruleDefinitionForCard(hyper);
  const instruction = definition.abilities
    .flatMap((ability) => ability.instructions)
    .find((candidate) => candidate.sourceText.includes("recharge up to two"));
  assert.ok(instruction);
  const schema = buildChoiceSchemaFromSpecs(
    match,
    ai.id,
    hyper,
    instruction.choices,
    "resolve",
    { sourceBakuganId: ai.bakugan[0].id },
  );
  const field = schema.fields.find((candidate) => candidate.id === "targetEnergyIds");
  assert.ok(field);
  assert.equal(field.minimum, 0);
  assert.equal(field.maximum, 2);
  assert.deepEqual(
    field.options.map((option) => option.id),
    match.players[0].energyZone.slice(0, 3).map((energy) => energy.id),
  );
});

test("Recharge charges Energy without creating spendable Energy pool", () => {
  const ai = player("ai", bakugan("serpenteze", "Ventus", 700));
  const human = player("human", bakugan("human", "Pyrus", 500));
  const match = brawl(ai, human);
  setEnergy(match.players[0], 4, 3, match.turn);
  const ids = activeTappedEnergyIds(match.players[0], match.turn);
  assert.equal(rechargeEnergyCards(match, ai.id, [ids[1]]), 1);
  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), [ids[0], ids[2]]);
  assert.equal(match.players[0].energy, 0);
  assert.equal(rechargeEnergyCards(match, ai.id), 2);
  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), []);
  assert.equal(match.players[0].energy, 0);
});

test("Titan Serpenteze Ultra open trigger resolves Recharge all through the engine", () => {
  const titan = card("br-163");
  const ai = player("ai", bakugan("titan-serpenteze", "Ventus", 1000, titan));
  const human = player("human", bakugan("human", "Pyrus", 500));
  let match = brawl(ai, human);
  setEnergy(match.players[0], 5, 4, match.turn);
  emitGameEvent(match, {
    id: "titan-open",
    type: "open",
    playerId: ai.id,
    targetBakuganId: ai.bakugan[0].id,
  });
  assert.ok(match.batch.some((effect) => effect.card.catalogId === "br-163"));
  match = passPriority(match, ai.id);
  match = passPriority(match, human.id);
  assert.ok(match.pendingChoice, "optional Recharge should ask on resolution");
  assert.equal(match.pendingChoice?.controllerId, ai.id);
  match = submitCardChoice(match, ai.id, { confirmed: true });
  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), []);
});

test("AI keeps Dark Waters when +200 B is redundant", () => {
  const darkWaters = card("br-5");
  const ai = player("ai", bakugan("ai-b", "Aquos", 900), [darkWaters]);
  const human = player("human", bakugan("human-b", "Pyrus", 700));
  const match = brawl(ai, human);
  setEnergy(match.players[0], 1, 0, match.turn);
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === darkWaters.id));
});

test("AI still uses Dark Waters when +200 B changes the Brawl result", () => {
  const darkWaters = card("br-5");
  const ai = player("ai", bakugan("ai-b", "Aquos", 600), [darkWaters]);
  const human = player("human", bakugan("human-b", "Pyrus", 700));
  const match = brawl(ai, human);
  setEnergy(match.players[0], 1, 0, match.turn);
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.players[0].hand.some((candidate) => candidate.id === darkWaters.id), false);
  assert.ok(next.batch.some((effect) => effect.card.id === darkWaters.id));
});
