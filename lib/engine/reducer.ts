import {
  activateIntrinsicReroll,
  beginCorePlacement,
  cloneMatch,
  concedeMatch,
  createMatch,
  discardToHandLimit,
  energizeCard,
  nextTurn,
  selectBakugan,
  startNextSeriesGame,
  type MatchState,
  type PlayerState,
} from "../game";
import { captureCoreReturns, placeCoreOrReturnCore } from "../coreReturns";
import { addChatMessage } from "../chat";
import { setLobbyReadyOrStart } from "../lobby";
import { confirmRoll, selectRollTarget } from "../rolling";
import { drawTurnCard } from "../turnStart";
import { undoLatestAction } from "../undo";
import { resolveExpiredDeadline } from "../deadlines";
import { dispatchRulesCommand, isRulesCommand } from "../rules/runtime";
import { ensureRulesState, normalizeRuleObjects } from "../rules/state";
import {
  captureOriginalDeckManifest,
  ensureOriginalDeckManifests,
  restoreOriginalDecksForNextGame,
} from "./deck-manifest";
import {
  appendCommandReceipt,
  deriveTransitionEvents,
  ensureEngineMetadata,
  findCommandReceipt,
  normalizeEngineState,
  sequenceEvents,
} from "./events";
import { assertCommandAllowedInPhase, assertValidPhaseTransition, structuredPhaseFor } from "./phase-machine";
import { withDeterministicRuntime } from "./runtime";
import { assertStateWithinRuntimeLimits, consumePendingChoice, engineFaultFromLimit, EngineRuntimeLimitError, withEngineRuntimeBudget } from "./limits";
import { clearDecisionTimeouts } from "./timeout-policy";
import {
  ENGINE_VERSION,
  RULES_VERSION,
  type CommandEnvelope,
  type CommandReceipt,
  type EngineBackedMatchState,
  EngineCommandError,
  EngineInvariantError,
  type GameCommand,
  type InitializeMatchOptions,
  type ReduceResult,
  type UnsequencedGameEvent,
} from "./types";

function assertEnvelope(state: MatchState, envelope: CommandEnvelope) {
  if (!envelope.commandId || envelope.commandId.length > 160) throw new EngineCommandError("INVALID_COMMAND_ID", "A stable command ID is required.");
  if (envelope.gameId !== state.id) throw new EngineCommandError("WRONG_GAME", "The command was created for a different match.");
  if (envelope.expectedVersion !== state.version) throw new EngineCommandError("VERSION_CONFLICT", `Expected match version ${envelope.expectedVersion}, but the authoritative version is ${state.version}.`);
  if (envelope.actorId !== "system" && envelope.command.type !== "JOIN_PLAYER"
    && !state.players.some((player) => player.id === envelope.actorId)) {
    throw new EngineCommandError("UNKNOWN_ACTOR", "The command actor does not occupy a match seat.");
  }
}

function joinPlayer(input: MatchState, player: PlayerState, issuedAt: number) {
  const state = cloneMatch(input) as EngineBackedMatchState;
  if (state.phase !== "lobby") throw new EngineCommandError("JOIN_CLOSED", "Players can only join during the lobby.");
  if (state.players.some((candidate) => candidate.id === player.id)) return state;
  if (state.players.length >= 2) throw new EngineCommandError("ROOM_FULL", "The room is full.");
  state.players.push(player);
  state.series[player.id] = 0;
  captureOriginalDeckManifest(state, player);
  state.version += 1;
  state.log.push({ id: `${issuedAt}-join-${state.version}`, at: issuedAt, kind: "connection", message: `${player.name} joined the room.` });
  return state;
}

function dispatchCommand(input: MatchState, actorId: string, command: GameCommand, issuedAt: number): MatchState {
  if (isRulesCommand(command)) return dispatchRulesCommand(input, actorId, command);
  switch (command.type) {
    case "SET_READY": return setLobbyReadyOrStart(input, actorId);
    case "BEGIN_CORE_PLACEMENT": return beginCorePlacement(input, issuedAt);
    case "PLACE_CORE": return placeCoreOrReturnCore(input, actorId, command.coreId, command.cell);
    case "DRAW_TURN_CARD": return drawTurnCard(input, actorId);
    case "ENERGIZE": return energizeCard(input, actorId, command.cardId);
    case "SELECT_BAKUGAN": return selectBakugan(input, actorId, command.bakuganId);
    case "SELECT_ROLL_TARGET": return selectRollTarget(input, actorId, command.cell);
    case "CONFIRM_ROLL": return confirmRoll(input, actorId);
    case "ACTIVATE_REROLL": return activateIntrinsicReroll(input, actorId);
    case "DISCARD_TO_HAND_LIMIT": return discardToHandLimit(input, actorId, command.cardIds);
    case "CHAT": return addChatMessage(input, actorId, command.message);
    case "CONCEDE": return concedeMatch(input, actorId);
    case "NEXT_TURN": return nextTurn(input);
    case "START_NEXT_SERIES_GAME": return startNextSeriesGame(restoreOriginalDecksForNextGame(input));
    case "UNDO": return undoLatestAction(input, actorId);
    case "JOIN_PLAYER": return joinPlayer(input, command.player, issuedAt);
    case "RESOLVE_DEADLINE": return resolveExpiredDeadline(input, issuedAt);
  }
}

function buildReceipt(envelope: CommandEnvelope, resultVersion: number, events: readonly { sequence: number }[]): CommandReceipt {
  return {
    commandId: envelope.commandId,
    actorId: envelope.actorId,
    expectedVersion: envelope.expectedVersion,
    resultVersion,
    requestHash: envelope.requestHash,
    issuedAt: envelope.issuedAt,
    eventSequenceStart: events[0]?.sequence ?? 0,
    eventSequenceEnd: events.at(-1)?.sequence ?? 0,
  };
}

export function reduceMatch(input: MatchState, envelope: CommandEnvelope): ReduceResult {
  const before = normalizeEngineState(input);
  normalizeRuleObjects(before);
  ensureRulesState(before);
  const existing = findCommandReceipt(before, envelope.commandId);
  if (existing) {
    if (existing.requestHash !== envelope.requestHash) throw new EngineCommandError("COMMAND_ID_REUSED", "This command ID was already used for a different request.");
    return { state: before, events: [], receipt: existing, duplicate: true, changed: false };
  }
  assertEnvelope(before, envelope);
  const currentMetadata = ensureEngineMetadata(before);
  if (currentMetadata.fault?.suspended && !["CHAT", "CONCEDE"].includes(envelope.command.type)) throw new EngineCommandError("MATCH_SUSPENDED", `Match suspended for engine investigation: ${currentMetadata.fault.code}.`);
  assertCommandAllowedInPhase(before, envelope.command);
  let next: EngineBackedMatchState;
  let runtimeBudget: NonNullable<ReturnType<typeof ensureEngineMetadata>["runtimeBudget"]>;
  try {
    const budgeted = withEngineRuntimeBudget(() => withDeterministicRuntime({ now: envelope.issuedAt, randomSeed: envelope.randomSeed }, () => {
      const dispatched = dispatchCommand(before, String(envelope.actorId), envelope.command, envelope.issuedAt);
      const candidate = captureCoreReturns(before, dispatched) as EngineBackedMatchState;
      consumePendingChoice(Number(Boolean(candidate.pendingChoice)) + candidate.triggerOrders.filter((request) => !request.orderedIds).length);
      assertStateWithinRuntimeLimits(candidate);
      return candidate;
    }));
    next = budgeted.value;
    runtimeBudget = budgeted.budget;
  } catch (error) {
    if (!(error instanceof EngineRuntimeLimitError)) throw error;
    const faulted = normalizeEngineState(before);
    faulted.version = before.version + 1;
    const metadata = ensureEngineMetadata(faulted);
    metadata.fault = engineFaultFromLimit(error, faulted, envelope.commandId, envelope.issuedAt);
    const faultEvents: UnsequencedGameEvent[] = [
      { type: "COMMAND_ACCEPTED", actorId: envelope.actorId, visibility: "server", payload: { commandType: envelope.command.type, expectedVersion: envelope.expectedVersion } },
      { type: "ENGINE_FAULT", actorId: "system", visibility: "public", payload: { code: metadata.fault.code, metric: metadata.fault.metric, limit: metadata.fault.limit, actual: metadata.fault.actual, suspended: true } },
      { type: "COMMAND_COMPLETED", actorId: envelope.actorId, visibility: "public", payload: { commandType: envelope.command.type, previousVersion: before.version, newVersion: faulted.version, faulted: true } },
    ];
    const events = sequenceEvents(faulted, envelope, faultEvents);
    const receipt = buildReceipt(envelope, faulted.version, events);
    appendCommandReceipt(faulted, receipt);
    return { state: faulted, events, receipt, duplicate: false, changed: true, faulted: true };
  }
  normalizeRuleObjects(next);
  ensureRulesState(next);
  const nextMetadata = ensureEngineMetadata(next);
  nextMetadata.runtimeBudget = runtimeBudget;
  if (envelope.actorId !== "system" && envelope.command.type !== "RESOLVE_DEADLINE") clearDecisionTimeouts(next, String(envelope.actorId));
  const changed = next.version !== before.version || JSON.stringify(next) !== JSON.stringify(before);
  if (!changed) {
    if (envelope.command.type === "RESOLVE_DEADLINE") return { state: before, events: [], duplicate: false, changed: false };
    if (envelope.command.type === "JOIN_PLAYER" && before.players.some((player) => player.id === envelope.command.player.id)) {
      return { state: before, events: [], duplicate: false, changed: false };
    }
    throw new EngineInvariantError("COMMAND_DID_NOT_ADVANCE_STATE", `${envelope.command.type} completed without changing the match.`);
  }
  if (next.version <= before.version) next.version = before.version + 1;
  assertValidPhaseTransition(before, next, envelope.command);
  const events = sequenceEvents(next, envelope, deriveTransitionEvents(before, next, envelope));
  const receipt = buildReceipt(envelope, next.version, events);
  appendCommandReceipt(next, receipt);
  ensureEngineMetadata(next).phase = structuredPhaseFor(next.phase);
  return { state: next, events, receipt, duplicate: false, changed: true };
}

export function initializeMatch(
  code: string,
  format: "bo1" | "bo3",
  players: PlayerState[],
  options: InitializeMatchOptions,
): ReduceResult {
  const state = withDeterministicRuntime({ now: options.issuedAt, randomSeed: options.randomSeed }, () => createMatch(code, format, players)) as EngineBackedMatchState;
  ensureRulesState(state);
  normalizeRuleObjects(state);
  ensureEngineMetadata(state);
  ensureOriginalDeckManifests(state);
  const envelope: CommandEnvelope = {
    commandId: options.commandId,
    gameId: state.id,
    actorId: options.actorId,
    expectedVersion: 0,
    issuedAt: options.issuedAt,
    randomSeed: options.randomSeed,
    requestHash: options.requestHash,
    command: { type: "CHAT", message: "" },
  };
  const events = sequenceEvents(state, envelope, [
    { type: "COMMAND_ACCEPTED", actorId: options.actorId, visibility: "server", payload: { command: { type: "CREATE_MATCH", code, format, players }, randomSeed: options.randomSeed, requestHash: options.requestHash } },
    { type: "MATCH_CREATED", actorId: options.actorId, visibility: "public", payload: { code, format, playerIds: players.map((player) => player.id) } },
    { type: "COMMAND_COMPLETED", actorId: options.actorId, visibility: "public", payload: { commandType: "CREATE_MATCH", previousVersion: 0, newVersion: state.version } },
  ]);
  const receipt = buildReceipt(envelope, state.version, events);
  appendCommandReceipt(state, receipt);
  const metadata = ensureEngineMetadata(state);
  metadata.engineVersion = ENGINE_VERSION;
  metadata.rulesVersion = RULES_VERSION;
  return { state, events, receipt, duplicate: false, changed: true };
}
