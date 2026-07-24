import assert from "node:assert/strict";
import test from "node:test";
import conformanceJson from "../content/conformance-matrix.json";
import type { Bakugan, Core, GameCard, MatchState, PlayerState } from "../lib/game";
import {
  ENGINE_METADATA_KEY,
  applyStatePatch,
  canonicalJson,
  createSeatStatePatch,
  initializeMatch,
  projectEventStreamsForPlayer,
  projectMatchForPlayer,
  replayCommands,
  reduceMatch,
  structuredPhaseFor,
  type CommandEnvelope,
  type EngineBackedMatchState,
} from "../lib/engine";
import {
  EngineRuntimeLimitError,
  MAX_EFFECT_STEPS_PER_COMMAND,
  consumeEffectStep,
  withEngineRuntimeBudget,
} from "../lib/engine/limits";
import { GOLDEN_MATCH_PHASES } from "./fixtures/golden-match-phases";

function card(id: string, type: GameCard["type"] = "Action"): GameCard {
  return { id, catalogId: `fixture-${id}`, number: 1, name: id, displayName: id, faction: "Aquos", factions: ["Aquos"], type, cost: 0, rarity: "Common", effect: "", mechanics: [], bPower: type === "Character" ? 500 : null, damage: type === "Character" ? 5 : null, coreTypes: [], evolvesFrom: null, art: "/assets/cards/card-missing.svg" };
}
function player(id: string): PlayerState {
  const bakugan: Bakugan[] = Array.from({ length: 3 }, (_, index) => ({ id: `${id}-b-${index}`, name: `${id} Bakugan ${index}`, faction: "Aquos", bPower: 500, damage: 5, rollAccuracy: 90, doubleCoreChance: 5, art: "", character: card(`${id}-character-${index}`, "Character"), open: false, heldCoreCells: [], evoStack: [] }));
  const cores: Core[] = Array.from({ length: 6 }, (_, index) => ({ id: `${id}-core-${index}`, catalogId: `core-${index}`, number: index, name: `Core ${index}`, type: "Fist", bonus: 100, damageBonus: 0, art: "" }));
  return { id, name: id.toUpperCase(), bakugan, cores, deck: 35, deckCards: Array.from({ length: 35 }, (_, index) => card(`${id}-deck-${index}`)), hand: Array.from({ length: 5 }, (_, index) => card(`${id}-hand-${index}`)), discard: [], energyZone: [], heroes: [], energy: 0, maxEnergy: 0, ready: false, connected: true, lastSeen: 0, energizedThisTurn: false, cardsPlayedThisTurn: 0 };
}
function initial() {
  return initializeMatch("GOLDEN", "bo1", [player("p1"), player("p2")], { commandId: "golden-create", actorId: "p1", issuedAt: 1_800_000_000_000, randomSeed: "golden-seed", requestHash: "golden-request" }).state;
}
function envelope(state: EngineBackedMatchState, commandId: string, actorId: string, command: CommandEnvelope["command"]): CommandEnvelope {
  return { commandId, gameId: state.id, actorId, expectedVersion: state.version, issuedAt: 1_800_000_000_000 + state.version, randomSeed: `seed-${commandId}`, requestHash: canonicalJson(command), command };
}

test("golden canonical match snapshots cover every public phase and key UI contract", () => {
  const base = initial();
  const snapshots = GOLDEN_MATCH_PHASES.map((golden) => {
    const state = structuredClone(base) as MatchState;
    state.phase = golden.phase;
    state.stepLabel = golden.label;
    const structured = structuredPhaseFor(state.phase);
    return { phase: state.phase, area: structured.area, step: structured.step, ui: `${state.stepLabel}|priority:${state.priority}|batch:${state.batch.length}|damage:${state.pendingDamage}` };
  });
  assert.deepEqual(snapshots, GOLDEN_MATCH_PHASES.map((golden) => ({ phase: golden.phase, area: golden.area, step: golden.step, ui: `${golden.label}|priority:${base.priority}|batch:0|damage:0` })));
});

test("seeded replay is deterministic and event redaction is seat-specific", () => {
  const start = initial();
  const commands = [
    envelope(start, "ready-p1", "p1", { type: "SET_READY" }),
  ];
  const afterOne = reduceMatch(start, commands[0]).state;
  commands.push(envelope(afterOne, "ready-p2", "p2", { type: "SET_READY" }));
  const first = replayCommands(start, commands);
  const second = replayCommands(start, commands);
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  const streams = projectEventStreamsForPlayer(first.events, "p1");
  assert.ok(streams.publicEvents.every((event) => event.type !== "COMMAND_ACCEPTED"));
  assert.ok(streams.privateEvents.every((event) => event.type !== "COMMAND_ACCEPTED"));
});

test("seat-safe state patches reconstruct the projected state without hidden leaks", () => {
  const before = initial();
  const after = structuredClone(before);
  after.players[1].hand[0] = { ...after.players[1].hand[0], name: "SECRET SENTINEL", displayName: "SECRET SENTINEL", effect: "SECRET EFFECT" };
  after.log.push({ id: "public-log", at: 1, kind: "game", message: "Public update" });
  const patch = createSeatStatePatch(before, after, "p1");
  const projectedBefore = projectMatchForPlayer(before, "p1") as unknown as Record<string, unknown>;
  const reconstructed = applyStatePatch(projectedBefore, patch);
  assert.deepEqual(reconstructed, projectMatchForPlayer(after, "p1"));
  assert.equal(JSON.stringify(reconstructed).includes("SECRET SENTINEL"), false);
  assert.equal(JSON.stringify(reconstructed).includes("SECRET EFFECT"), false);
});

test("property fuzzing rejects invalid commands without mutating the input", () => {
  let seed = 0x9e3779b9;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const state = initial();
    const before = structuredClone(state);
    const invalid = [
      { type: "PLACE_CORE", coreId: `missing-${random()}`, cell: "not-a-cell" },
      { type: "PLAY_CARD", cardId: `missing-${random()}`, choices: {} },
      { type: "SELECT_BAKUGAN", bakuganId: `missing-${random()}` },
      { type: "PASS_PRIORITY" },
    ] as const;
    const command = invalid[random() % invalid.length];
    assert.throws(() => reduceMatch(state, envelope(state, `fuzz-${iteration}`, iteration % 2 ? "p1" : "p2", command)), (error: unknown) => error instanceof Error);
    assert.deepEqual(state, before);
  }
});

test("property fuzzing accepts seeded legal command sequences deterministically", () => {
  let state = initial();
  const start = structuredClone(state);
  const commands: CommandEnvelope[] = [];
  let seed = 0x85ebca6b;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const actorId = random() % 2 === 0 ? "p1" : "p2";
    const command = { type: "CHAT", message: `legal-fuzz-${iteration}-${random()}` } as const;
    const input = structuredClone(state);
    const issued = envelope(state, `legal-fuzz-${iteration}`, actorId, command);
    const result = reduceMatch(state, issued);
    assert.equal(result.state.version, input.version + 1);
    assert.deepEqual(state, input, "A legal reducer transition must not mutate its input snapshot.");
    commands.push(issued);
    state = result.state;
  }
  const replay = replayCommands(start, commands);
  assert.deepEqual(replay.state, state);
  for (const playerId of ["p1", "p2"]) {
    const projection = projectMatchForPlayer(state, playerId);
    assert.equal(JSON.stringify(projection).includes("fixture-p1-hand-0") && playerId === "p2", false);
    assert.equal(JSON.stringify(projection).includes("fixture-p2-hand-0") && playerId === "p1", false);
  }
});

test("runtime budgets fail closed at the declared effect-step limit", () => {
  assert.throws(() => withEngineRuntimeBudget(() => {
    for (let index = 0; index <= MAX_EFFECT_STEPS_PER_COMMAND; index += 1) consumeEffectStep();
  }), (error: unknown) => error instanceof EngineRuntimeLimitError && error.metric === "effectSteps");
});

test("the checked conformance matrix is complete and CI-addressable", () => {
  const matrix = conformanceJson as Array<{ id: string; test: string; status: string }>;
  assert.equal(matrix.length, 18);
  assert.equal(new Set(matrix.map((entry) => entry.id)).size, matrix.length);
  assert.ok(matrix.every((entry) => entry.status === "covered" && (entry.test.startsWith("tests/") || entry.test.startsWith(".github/"))));
});

test("version profile is retained in authoritative match metadata", () => {
  const state = initial();
  assert.ok(state[ENGINE_METADATA_KEY]?.rulesVersion);
  assert.ok(state[ENGINE_METADATA_KEY]?.cardCatalogueVersion);
  assert.ok(state[ENGINE_METADATA_KEY]?.digitalAdaptationVersion);
  assert.ok(state[ENGINE_METADATA_KEY]?.contentSchemaVersion);
});
