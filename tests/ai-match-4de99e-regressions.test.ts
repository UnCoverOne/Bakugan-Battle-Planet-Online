import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { bestAiRollTarget, forecastAiRoll } from "../lib/aiRollForecast";
import { planOpponentEnergize } from "../lib/opponentAiBase";
import { decideOpponentAiWorkerRequest } from "../lib/opponentAiWorkerProtocol";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";

// Compact, non-identifying reconstructions of match 4DE99E (game 2).
// No player's exported deck, account identifiers, or complete match history is stored.
function card(catalogId: string, id: string): GameCard {
  const original = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(original, `Missing card ${catalogId}`);
  return { ...original, id };
}

function bakugan(catalogId: string, id: string): Bakugan {
  const character = card(catalogId, `${id}-character`);
  return {
    id,
    name: character.displayName || character.name,
    faction: character.faction,
    bPower: character.bPower ?? 0,
    damage: character.damage ?? 0,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: character.art,
    character,
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
}

function core(
  cell: string,
  type: Core["type"],
  bonus: number,
  damageBonus: number,
  conditionalFactions: Faction[] = [],
  conditionalBonus = 0,
): Core {
  return {
    id: `4de99e-${cell}`,
    catalogId: `4de99e-${cell}`,
    number: 900,
    name: `4de99e-${cell}`,
    type,
    bonus,
    damageBonus,
    conditionalFactions,
    conditionalBonus,
    art: "",
  };
}

const board = [
  ["h3-3", "Fist", 150, 2],
  ["h3-2", "Shield", 0, 0, ["Aquos", "Ventus"], 400],
  ["h3-4", "Magic Shield", 650, 0],
  ["h2-3", "Magic Shield", 650, 0],
  ["h3-5", "Magic Shield", 650, 0],
  ["h2-4", "Magic Shield", 650, 0],
  ["h3-1", "Shield", 0, 0, ["Haos", "Ventus"], 400],
  ["h2-2", "Magic Shield", 650, 0],
  ["h2-1", "Shield", 0, 0, ["Haos", "Ventus"], 400],
  ["h1-2", "Flaming Fist", 0, 6],
  ["h2-0", "Shield", 0, 0, ["Haos", "Pyrus"], 400],
  ["h1-1", "Flaming Fist", 250, 3],
] as const;

function rollCase(turn: 1 | 2) {
  const human = makePlayer("human", "Human", STARTER_DECKS[0]);
  const ai = makePlayer("training-bot", "Training AI", STARTER_DECKS[1]);
  const cubbo = bakugan("br-167", "br-167-training-bot");
  const opponent = turn === 1
    ? bakugan("ex-1", "4de99e-titan-dragonoid")
    : bakugan("bb-330", "4de99e-gorthion-ultra");
  ai.bakugan[0] = cubbo;
  human.bakugan[0] = opponent;
  const match = createMatch("AI-4DE99E", "bo3", [human, ai]);
  match.gameNumber = 2;
  match.turn = turn;
  match.phase = "target";
  match.stepLabel = "Roll Phase • Rolling Step • Choose BakuCore targets";
  match.priority = ai.id;
  match.startingPlayer = turn === 1 ? ai.id : human.id;
  match.selected[ai.id] = cubbo.id;
  match.selected[human.id] = opponent.id;
  match.targets[human.id] = turn === 1 ? "h3-5" : "h2-4";
  match.placements = board
    .filter(([cell]) => turn === 1 || cell !== "h3-3")
    .map(([cell, type, bonus, damage, factions, conditional], index) => ({
      playerId: index % 2 ? ai.id : human.id,
      core: core(cell, type, bonus, damage, factions ? [...factions] : [], conditional ?? 0),
      cell,
      order: index + 1,
      ...(turn === 2 && cell === "h3-5" ? { attachedTo: opponent.id } : {}),
    }));
  if (turn === 2) {
    match.placements.push({
      playerId: human.id,
      core: core("h0-2", "Fist", 150, 2),
      cell: "h0-2",
      order: 13,
    });
  }
  return { match, ai, cubbo };
}

function diagnostic(match: MatchState, playerId: string, bakugan: Bakugan): string {
  return match.placements
    .filter((placement) => !placement.attachedTo)
    .map((placement) => {
      const forecast = forecastAiRoll(match, playerId, bakugan, placement);
      return `${placement.cell} ${placement.core.type} value=${forecast.value.toFixed(3)} `
        + `open=${forecast.openProbability.toFixed(2)} core=${forecast.coreProbability.toFixed(2)}`;
    })
    .join("; ");
}

for (const turn of [1, 2] as const) {
  test(`4DE99E game 2 turn ${turn}: Aquos Cubbo ranks a +650 Magic Shield over the observed inferior target`, () => {
    const { match, ai, cubbo } = rollCase(turn);
    const observed = turn === 1 ? "h3-3" : "h3-2";
    const alternative = match.placements.find((placement) => placement.cell === "h3-4");
    const inferior = match.placements.find((placement) => placement.cell === observed);
    assert.ok(alternative && inferior);
    const better = forecastAiRoll(match, ai.id, cubbo, alternative);
    const worse = forecastAiRoll(match, ai.id, cubbo, inferior);
    assert.ok(
      better.value > worse.value,
      `Expected the Magic Shield to outrank ${observed}. ${diagnostic(match, ai.id, cubbo)}`,
    );
    const chosen = bestAiRollTarget(match, ai.id);
    assert.equal(
      chosen?.core.type,
      "Magic Shield",
      `Target ${chosen?.cell} was selected; ${diagnostic(match, ai.id, cubbo)}`,
    );

    // The browser worker must use the same choice as the direct planner.
    const response = decideOpponentAiWorkerRequest({
      type: "decide",
      requestId: turn,
      match: JSON.parse(JSON.stringify(match)) as MatchState,
      playerId: ai.id,
    });
    assert.equal(response.error, undefined);
    assert.equal(response.command?.type, "SELECT_ROLL_TARGET");
    if (response.command?.type === "SELECT_ROLL_TARGET") {
      assert.equal(response.command.cell, chosen?.cell);
    }
  });
}

test("4DE99E: core and Aquos Cubbo's printed bonus are both evaluated", () => {
  const { match, ai, cubbo } = rollCase(1);
  const stats = (cell: string) => {
    const projected = structuredClone(match);
    const owner = projected.players.find((player) => player.id === ai.id)!;
    const selected = owner.bakugan.find((candidate) => candidate.id === cubbo.id)!;
    selected.open = true;
    selected.heldCoreCells = [cell];
    return evaluateBakuganCharacteristics(projected, selected, owner).power;
  };
  assert.equal(stats("h3-3"), 250);
  assert.equal(stats("h3-2"), 500);
  assert.equal(stats("h3-4"), 1350);
});

test("4DE99E: zero-play-likelihood Wane must not outrank stranded Flips for Energize", () => {
  const ai = makePlayer("training-bot", "Training AI", STARTER_DECKS[0]);
  const human = makePlayer("human", "Human", STARTER_DECKS[1]);
  ai.bakugan[0] = bakugan("br-167", "br-167-training-bot");
  const wane = card("bb-80", "4de99e-wane");
  const rockOne = card("br-74", "4de99e-rock-riser-one");
  const confuse = card("br-67", "4de99e-confuse");
  const rockTwo = card("br-74", "4de99e-rock-riser-two");
  const targetGoal = card("bb-35", "4de99e-reachable-goal");
  ai.hand = [wane, rockOne, confuse, rockTwo, targetGoal];
  // An affordable Energy goal makes this a sacrifice-priority test, not a
  // test of whether the AI is required to Energize every turn.
  ai.energyZone = [
    card("bb-165", "4de99e-energy-one"),
    card("bb-165", "4de99e-energy-two"),
  ];
  ai.deckCards = [];
  ai.deck = 0;
  const match = createMatch("AI-4DE99E-ENERGIZE", "bo3", [human, ai]);
  match.gameNumber = 2;
  match.turn = 3;
  match.phase = "energize";
  match.priority = ai.id;
  match.startingPlayer = ai.id;

  const plan = planOpponentEnergize(match, ai.id);
  assert.equal(plan.shouldEnergize, true, JSON.stringify(plan));
  assert.ok(
    [rockOne.id, confuse.id, rockTwo.id].includes(plan.cardId ?? ""),
    `Energized ${plan.cardId} instead of a stranded Flip: ${JSON.stringify(plan)}`,
  );
  const waneInfo = plan.candidates?.find((candidate) => candidate.cardId === wane.id);
  const rockInfo = plan.candidates?.find((candidate) => candidate.cardId === rockOne.id);
  assert.ok(waneInfo && rockInfo);
  // Card category must precede numerical opportunity cost or identical tiers.
  assert.ok(rockInfo.tier <= waneInfo.tier);
});
