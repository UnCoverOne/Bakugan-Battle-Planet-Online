import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../lib/data";
import {
  createMatch,
  type Bakugan,
  type Faction,
  type GameCard,
  type PlayerState,
} from "../lib/game";
import { advanceOpponentAi } from "../lib/opponentAi";

function printedCard(catalogId: string, id: string): GameCard {
  const source = CARDS.find((card) => card.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function bakugan(id: string, faction: Faction): Bakugan {
  const character = CARDS.find((card) => card.type === "Character" && card.faction === faction);
  assert.ok(character, `Missing ${faction} Character definition`);
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

test("AI holds Wave Slash until the roll provides Brawl information", () => {
  const waveSlash = printedCard("bb-27", "ai-wave-slash");
  assert.equal(waveSlash.displayName || waveSlash.name, "Wave Slash");

  const aiBakugan = bakugan("ai-bakugan", "Aquos");
  const humanBakugan = bakugan("human-bakugan", "Pyrus");
  const ai = player("ai", aiBakugan, [waveSlash]);
  const human = player("human", humanBakugan);
  ai.energyZone = Array.from(
    { length: 3 },
    (_, index) => printedCard("bb-10", `ai-energy-${index}`),
  );

  const match = createMatch("WAVESLASH", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = "preRoll";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.stepLabel = "Pre-roll priority";
  match.selected[ai.id] = aiBakugan.id;
  match.selected[human.id] = humanBakugan.id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(
    next.players.find((candidate) => candidate.id === ai.id)?.hand
      .some((card) => card.id === waveSlash.id),
  );
});
