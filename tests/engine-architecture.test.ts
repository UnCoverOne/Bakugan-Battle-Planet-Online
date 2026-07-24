import assert from "node:assert/strict";
import test from "node:test";
import type { Bakugan, Core, GameCard, PlayerState } from "../lib/game";
import {
  ENGINE_METADATA_KEY,
  EngineCommandError,
  canonicalJson,
  findCommandReceipt,
  initializeMatch,
  projectEventsForPlayer,
  projectMatchForPlayer,
  reduceMatch,
  structuredPhaseFor,
  type CommandEnvelope,
  type EngineBackedMatchState,
} from "../lib/engine";

function card(id: string, type: GameCard["type"] = "Action"): GameCard {
  return {
    id,
    catalogId: `catalog-${id}`,
    number: 1,
    name: id,
    displayName: id,
    faction: "Aquos",
    factions: ["Aquos"],
    type,
    cost: 0,
    rarity: "Common",
    effect: "",
    mechanics: [],
    bPower: type === "Character" ? 500 : null,
    damage: type === "Character" ? 5 : null,
    coreTypes: [],
    evolvesFrom: null,
    art: "",
  };
}

function player(id: string): PlayerState {
  const bakugan: Bakugan[] = Array.from({ length: 3 }, (_, index) => ({
    id: `${id}-bakugan-${index}`,
    name: `Bakugan ${index}`,
    faction: "Aquos",
    bPower: 500,
    damage: 5,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character: card(`${id}-character-${index}`, "Character"),
    open: false,
    heldCoreCells: [],
    evoStack: [],
  }));
  const cores: Core[] = Array.from({ length: 6 }, (_, index) => ({
    id: `${id}-core-${index}`,
    catalogId: `core-${index}`,
    number: index,
    name: `Core ${index}`,
    type: "Fist",
    bonus: 100,
    damageBonus: 0,
    art: "",
  }));
  return {
    id,
    name: id.toUpperCase(),
    bakugan,
    cores,
    deck: 35,
    deckCards: Array.from({ length: 35 }, (_, index) => card(`${id}-deck-${index}`)),
    hand: Array.from({ length: 5 }, (_, index) => card(`${id}-hand-${index}`)),
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    maxEnergy: 0,
    ready: false,
    connected: true,
    lastSeen: 0,
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
  };
}

function envelope(
  state: EngineBackedMatchState,
  values: Partial<CommandEnvelope> & Pick<CommandEnvelope, "commandId" | "actorId" | "command">,
): CommandEnvelope {
  return {
    commandId: values.commandId,
    gameId: values.gameId ?? state.id,
    actorId: values.actorId,
    expectedVersion: values.expectedVersion ?? state.version,
    issuedAt: values.issuedAt ?? 1_800_000_000_000,
    randomSeed: values.randomSeed ?? "test-seed",
    requestHash: values.requestHash ?? canonicalJson(values.command),
    command: values.command,
  };
}

function initialState() {
  const result = initializeMatch("ABCDEF", "bo1", [player("p1"), player("p2")], {
    commandId: "create-test-match",
    actorId: "p1",
    issuedAt: 1_800_000_000_000,
    randomSeed: "create-seed",
    requestHash: "create-request",
  });
  return result.state;
}

test("canonicalJson is stable across object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("the deterministic reducer produces identical state and events", () => {
  const firstInitial = initialState();
  const secondInitial = initialState();

  const readyOne = envelope(firstInitial, {
    commandId: "ready-player-one",
    actorId: "p1",
    command: { type: "SET_READY" },
    randomSeed: "ready-one",
  });
  const firstAfterOne = reduceMatch(firstInitial, readyOne).state;
  const secondAfterOne = reduceMatch(secondInitial, readyOne).state;

  const readyTwo = envelope(firstAfterOne, {
    commandId: "ready-player-two",
    actorId: "p2",
    command: { type: "SET_READY" },
    randomSeed: "starting-player-seed",
    issuedAt: 1_800_000_001_000,
  });
  const first = reduceMatch(firstAfterOne, readyTwo);
  const second = reduceMatch(secondAfterOne, readyTwo);

  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  assert.equal(first.state.phase, "startingPlayer");
  assert.equal(first.state[ENGINE_METADATA_KEY]?.phase.area, "setup");
});

test("replaying the same command ID is idempotent", () => {
  const state = initialState();
  const command = envelope(state, {
    commandId: "chat-idempotency-test",
    actorId: "p1",
    command: { type: "CHAT", message: "Hello brawlers" },
  });
  const first = reduceMatch(state, command);
  const second = reduceMatch(first.state, command);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.changed, false);
  assert.equal(second.state.version, first.state.version);
  assert.equal(findCommandReceipt(second.state, command.commandId)?.resultVersion, first.state.version);
});

test("a command ID cannot be reused for a different request", () => {
  const state = initialState();
  const first = reduceMatch(state, envelope(state, {
    commandId: "shared-command-id",
    actorId: "p1",
    command: { type: "CHAT", message: "First" },
    requestHash: "first-hash",
  }));
  assert.throws(() => reduceMatch(first.state, envelope(first.state, {
    commandId: "shared-command-id",
    actorId: "p1",
    command: { type: "CHAT", message: "Second" },
    requestHash: "second-hash",
  })), (error: unknown) => error instanceof EngineCommandError && error.code === "COMMAND_ID_REUSED");
});

test("phase-specific commands are rejected by the state machine", () => {
  const state = initialState();
  assert.throws(() => reduceMatch(state, envelope(state, {
    commandId: "invalid-placement",
    actorId: "p1",
    command: { type: "PLACE_CORE", coreId: "p1-core-0", cell: "h3-3" },
  })), (error: unknown) => error instanceof EngineCommandError && error.code === "COMMAND_NOT_ALLOWED_IN_PHASE");
});

test("private engine metadata and server events are not projected to clients", () => {
  const created = initializeMatch("ABCDEF", "bo1", [player("p1")], {
    commandId: "projection-create",
    actorId: "p1",
    issuedAt: 1_800_000_000_000,
    randomSeed: "projection-seed",
    requestHash: "projection-request",
  });
  const projected = projectMatchForPlayer(created.state, "p1") as EngineBackedMatchState;
  assert.equal(projected[ENGINE_METADATA_KEY], undefined);
  assert.equal(projectEventsForPlayer(created.events, "p1").some((event) => event.type === "COMMAND_ACCEPTED"), false);
  assert.equal(projectEventsForPlayer(created.events, "p1").some((event) => event.type === "MATCH_CREATED"), true);
});

test("legacy phases have a structured modern projection", () => {
  assert.deepEqual(structuredPhaseFor("target"), {
    area: "roll",
    step: "targeting-and-rolling",
    legacy: "target",
  });
  assert.deepEqual(structuredPhaseFor("handLimit"), {
    area: "brawl",
    step: "hand-limit",
    legacy: "handLimit",
  });
});
