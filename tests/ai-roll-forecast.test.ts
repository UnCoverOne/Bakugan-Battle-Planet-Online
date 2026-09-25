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

function core(id: string, type: Core["type"], bonus: number, damageBonus = 0): Core {
  return {
    id,
    catalogId: id,
    number: 900,
    name: id,
    type,
    bonus,
    damageBonus,
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

test("Hydorous compares Helix and Magic Shield with the same forecast samples", () => {
  const ai = makePlayer("training-bot", "Training AI", STARTER_DECKS[0]);
  const human = makePlayer("mrkxih56-drmlacg4", "Human", STARTER_DECKS[1]);
  const character = CARDS.find((card) => card.catalogId === "av-167");
  assert.ok(character);
  const hydorous: Bakugan = {
    id: "av-167-training-bot",
    name: character.displayName || character.name,
    faction: "Aquos",
    bPower: character.bPower ?? 400,
    damage: character.damage ?? 4,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: character.art,
    character: { ...character, id: "hydorous-character" },
    open: false,
    heldCoreCells: [],
    evoStack: [],
  };
  ai.bakugan[0] = hydorous;

  const match = createMatch("AICORE-HYDOROUS", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = "target";
  match.stepLabel = "Roll Phase • Rolling Step • Choose BakuCore targets";
  match.startingPlayer = human.id;
  match.initialStartingPlayer = human.id;
  match.priority = ai.id;
  match.selected[ai.id] = hydorous.id;
  match.selected[human.id] = human.bakugan[0].id;

  const add = (
    cell: string,
    type: Core["type"],
    bonus: number,
    damageBonus: number,
    ownerId: string,
    order: number,
    attachedTo?: string,
  ) => ({
    playerId: ownerId,
    core: core(`hydorous-${cell}`, type, bonus, damageBonus),
    cell,
    order,
    ...(attachedTo ? { attachedTo } : {}),
  });

  match.placements = [
    add("h3-3", "Shield", 0, 0, ai.id, 1),
    add("h3-4", "Magic Shield", 650, 0, human.id, 2),
    add("h2-4", "Magic Shield", 650, 0, ai.id, 3),
    add("h3-5", "Magic Shield", 650, 0, human.id, 4),
    add("h2-5", "Magic Shield", 650, 0, ai.id, 5),
    add("h4-4", "Helix", 600, -3, human.id, 6),
    add("h4-5", "Helix", 600, -3, human.id, 7, "already-attached"),
    add("h2-3", "Helix", 600, -3, ai.id, 8),
    add("h2-2", "Shield", 0, 0, human.id, 9),
    add("h3-2", "Fist", 150, 2, ai.id, 10),
    add("h2-1", "Fist", 150, 2, human.id, 11),
    add("h1-1", "Helix", 600, -3, ai.id, 12),
  ];

  const magicShield = match.placements.find((placement) => placement.cell === "h2-4");
  const helix = match.placements.find((placement) => placement.cell === "h2-3");
  assert.ok(magicShield && helix);
  assert.ok(
    forecastAiRoll(match, ai.id, hydorous, helix).value
      > forecastAiRoll(match, ai.id, hydorous, magicShield).value,
  );

  const best = bestAiRollTarget(match, ai.id);
  assert.ok(best);
  assert.equal(best.core.type, "Helix");
  assert.notEqual(best.cell, "h2-4");
});

test("AI target selection uses the ability-aware roll forecast", () => {
  const { match, ai, magicShieldCell } = forecastMatch();
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.targets[ai.id], magicShieldCell);
});
