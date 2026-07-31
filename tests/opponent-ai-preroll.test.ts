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

let serial = 0;

function namedCard(displayName: string, instanceId?: string): GameCard {
  const source = CARDS.find((candidate) => candidate.displayName === displayName);
  assert.ok(source, `Missing catalogue card ${displayName}`);
  serial += 1;
  return { ...source, id: instanceId ?? `printed-card-${source.catalogId}-${serial}` };
}

function bakugan(id: string, faction: Faction, bPower: number, damage: number): Bakugan {
  const printedCharacter = CARDS.find(
    (candidate) => candidate.type === "Character" && candidate.faction === faction,
  );
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
  };
}

function player(id: string, team: Bakugan[], hand: GameCard[] = []): PlayerState {
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
  const source = CARDS.find((candidate) => candidate.type !== "Character");
  assert.ok(source, "Missing non-Character card for energy-zone fixture");
  owner.energyZone = Array.from(
    { length: amount },
    (_, index) => ({ ...source, id: `${owner.id}-energy-${index}` }),
  );
  owner.maxEnergy = amount;
}

test("AI holds Wave Slash until it has Brawl information", () => {
  const waveSlash = namedCard("Wave Slash", "wave-slash");

  const ai = player(
    "ai",
    [bakugan("ai-bakugan", "Aquos", 500, 5)],
    [waveSlash],
  );
  const human = player(
    "human",
    [bakugan("human-bakugan", "Pyrus", 500, 5)],
  );
  addEnergy(ai, 3);

  const match = createMatch("AIPREROLL", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = "preRoll";
  match.stepLabel = "Pre-Roll Play Step";
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.equal(next.priority, human.id);
  assert.ok(next.players[0].hand.some((card) => card.id === waveSlash.id));
  assert.equal(next.players[0].cardsPlayedThisTurn, 0);
});
