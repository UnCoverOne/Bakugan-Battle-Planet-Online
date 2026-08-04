import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CENTER_CELL,
  HEX_CELLS,
  createMatch,
  type Bakugan,
  type Core,
} from "../lib/game";
import { bestAiRollTarget, forecastAiRoll } from "../lib/aiRollForecast";
import { advanceOpponentAi } from "../lib/opponentAi";

function core(id: string, type: Core["type"], bonus: number): Core {
  return {
    id,
    catalogId: id,
    number: 900,
    name: id,
    type,
    bonus,
    damageBonus: 0,
    art: "",
  };
}

function cubboBakugan(): Bakugan {
  const character = CARDS.find((card) => card.catalogId === "br-167");
  assert.ok(character);
  return {
    id: "ai-aquos-cubbo",
    name: character.displayName || character.name,
    faction: "Aquos",
    bPower: character.bPower ?? 100,
    damage: character.damage ?? 1,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: character.art,
    character: { ...character, id: "ai-aquos-cubbo-character" },
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
}

function forecastMatch() {
  const ai = makePlayer("ai", "AI", STARTER_DECKS[0]);
  const human = makePlayer("human", "Human", STARTER_DECKS[1]);
  const cubbo = cubboBakugan();
  ai.bakugan[0] = cubbo;

  const match = createMatch("AICOREABILITY", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = "target";
  match.stepLabel = "Roll Phase • Rolling Step • Choose BakuCore targets";
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.priority = ai.id;
  match.selected[ai.id] = cubbo.id;
  match.selected[human.id] = human.bakugan[0].id;

  const farCell = HEX_CELLS.find((cell) => cell.q === 3 && cell.r === 0)?.id;
  assert.ok(farCell);
  const magicShield = core("ability-magic-shield", "Magic Shield", 0);
  const strongerPrintedCore = core("printed-fist", "Fist", 500);
  match.placements = [
    { playerId: ai.id, core: magicShield, cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: strongerPrintedCore, cell: farCell, order: 2 },
  ];

  return { match, ai, cubbo, magicShieldCell: CENTER_CELL, fistCell: farCell };
}

test("AI roll forecast includes Character abilities activated by the targeted BakuCore", () => {
  const { match, ai, cubbo, magicShieldCell, fistCell } = forecastMatch();
  const magicShieldPlacement = match.placements.find((placement) => placement.cell === magicShieldCell);
  const fistPlacement = match.placements.find((placement) => placement.cell === fistCell);
  assert.ok(magicShieldPlacement && fistPlacement);

  const magicShieldForecast = forecastAiRoll(match, ai.id, cubbo, magicShieldPlacement);
  const fistForecast = forecastAiRoll(match, ai.id, cubbo, fistPlacement);

  // Aquos Cubbo gets +600 B while holding a Magic Shield or Flaming Fist.
  // The Magic Shield itself has no printed bonus here, while the Fist has +500 B.
  assert.ok(magicShieldForecast.value > fistForecast.value);
  assert.equal(bestAiRollTarget(match, ai.id)?.cell, magicShieldCell);
});

test("AI target selection uses the ability-aware roll forecast", () => {
  const { match, ai, magicShieldCell } = forecastMatch();
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.targets[ai.id], magicShieldCell);
});
