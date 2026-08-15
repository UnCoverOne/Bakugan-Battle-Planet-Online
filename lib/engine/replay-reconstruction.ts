import type { MatchState } from "../game";
import { reduceMatch } from "./reducer";
import { replayStateHash } from "./replay-codec";
import type { ReplayFrame, ReplayMarker } from "./replay-types";
import {
  applyReplayStatePatch,
  replayPresentationState,
  type ReplayStatePatchOperation,
} from "./replay-transition";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "./types";

export type AuthoritativeReplayStep = {
  envelope: CommandEnvelope;
  resultVersion: number;
};

export type RecordedReplayStep = AuthoritativeReplayStep & {
  statePatch: readonly ReplayStatePatchOperation[];
};

export type ReplayReconstructionContext = {
  commandIndex?: number;
  commandId?: string;
  commandType?: string;
  expectedVersion?: number;
  actualVersion?: number;
  resultVersion?: number;
};

export class ReplayReconstructionError extends Error {
  readonly context: ReplayReconstructionContext;

  constructor(message: string, context: ReplayReconstructionContext = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReplayReconstructionError";
    this.context = context;
  }
}

function commandLabel(command: GameCommand, state: MatchState) {
  const actor = state.players.find((player) => player.id === state.priority)?.name;
  switch (command.type) {
    case "PLAY_CARD": return `Played ${state.players.flatMap((player) => [...player.heroes, ...player.discard]).find((card) => card.id === command.cardId)?.displayName ?? "a card"}`;
    case "ENERGIZE": return "Energized a card";
    case "CONFIRM_ROLL": return "Resolved Bakugan rolls";
    case "REVEAL_DAMAGE_FLIP": return "Revealed damage";
    case "PASS_PRIORITY": return `${actor ?? "Player"} passed priority`;
    case "RESOLVE_DEADLINE": return "Resolved timer deadline";
    case "CONCEDE": return "Conceded the match";
    case "START_NEXT_SERIES_GAME": return "Started the next game";
    default: return command.type.toLowerCase().replaceAll("_", " ");
  }
}

function markerType(command: GameCommand, before: MatchState, after: MatchState): ReplayMarker["type"] {
  if (after.phase === "result") return "result";
  if (after.gameNumber !== before.gameNumber) return "game";
  if (after.phase !== before.phase) return "phase";
  if (["PLAY_CARD", "PLAY_DAMAGE_FLIP"].includes(command.type)) return "card";
  if (["CONFIRM_ROLL", "ACTIVATE_REROLL"].includes(command.type)) return "roll";
  if (["REVEAL_DAMAGE_FLIP", "PLAY_DAMAGE_FLIP"].includes(command.type)) return "damage";
  return "command";
}

function initialTimeline(state: MatchState, startedAt: number) {
  const initialLabel = state.phase === "lobby" ? "Match created" : "Gameplay begins";
  return {
    frames: [{
      index: 0,
      at: startedAt,
      commandType: "CREATE_MATCH",
      label: initialLabel,
      state,
    } satisfies ReplayFrame],
    markers: [{ index: 0, at: startedAt, type: "start", label: initialLabel } satisfies ReplayMarker],
  };
}

function stepContext(
  state: MatchState,
  commandIndex: number,
  step: AuthoritativeReplayStep,
): ReplayReconstructionContext {
  return {
    commandIndex,
    commandId: step.envelope.commandId,
    commandType: step.envelope.command.type,
    expectedVersion: step.envelope.expectedVersion,
    actualVersion: state.version,
    resultVersion: step.resultVersion,
  };
}

function assertStepVersion(
  state: MatchState,
  commandIndex: number,
  step: AuthoritativeReplayStep,
) {
  const context = stepContext(state, commandIndex, step);
  if (step.envelope.expectedVersion !== state.version) {
    throw new ReplayReconstructionError(
      `Replay command journal has a version gap before ${step.envelope.commandId}.`,
      context,
    );
  }
  return context;
}

function appendFrame(
  frames: ReplayFrame[],
  markers: ReplayMarker[],
  before: MatchState,
  state: MatchState,
  step: AuthoritativeReplayStep,
) {
  const frame = {
    index: frames.length,
    at: step.envelope.issuedAt,
    commandType: step.envelope.command.type,
    label: commandLabel(step.envelope.command, state),
    state,
  } satisfies ReplayFrame;
  frames.push(frame);
  const type = markerType(step.envelope.command, before, state);
  if (type !== "command") markers.push({ index: frame.index, at: frame.at, type, label: frame.label });
}

function assertFinalState(state: MatchState, finalState: MatchState) {
  const reconstructedHash = replayStateHash(state);
  const authoritativeHash = replayStateHash(finalState);
  if (state.version !== finalState.version || reconstructedHash !== authoritativeHash) {
    throw new ReplayReconstructionError(
      `Replay final-state integrity check failed (expected v${finalState.version}/${authoritativeHash}, received v${state.version}/${reconstructedHash}).`,
      { actualVersion: state.version, resultVersion: finalState.version },
    );
  }
}

/**
 * Rebuild a completed timeline from the exact authoritative gameplay snapshot
 * and the persisted command journal. This is retained as a compatibility path
 * for command journals created before authoritative transition patches existed.
 */
export function buildAuthoritativeReplayTimeline(
  genesis: MatchState,
  steps: readonly AuthoritativeReplayStep[],
  finalState: MatchState,
  startedAt: number,
): { frames: ReplayFrame[]; markers: ReplayMarker[] } {
  let state = structuredClone(genesis) as EngineBackedMatchState;
  const { frames, markers } = initialTimeline(state, startedAt);

  for (const [commandIndex, step] of steps.entries()) {
    const context = assertStepVersion(state, commandIndex, step);
    const before = state;
    let result: ReturnType<typeof reduceMatch>;
    try {
      result = reduceMatch(state, step.envelope);
    } catch (cause) {
      throw new ReplayReconstructionError(
        `Replay command ${step.envelope.commandId} (${step.envelope.command.type}) could not be reduced.`,
        context,
        cause,
      );
    }
    state = result.state;
    if (!result.changed) {
      throw new ReplayReconstructionError(
        `Persisted replay command ${step.envelope.commandId} did not advance the reconstructed match.`,
        { ...context, actualVersion: state.version },
      );
    }
    if (state.version !== step.resultVersion) {
      throw new ReplayReconstructionError(
        `Replay command ${step.envelope.commandId} produced version ${state.version}; the journal records ${step.resultVersion}.`,
        { ...context, actualVersion: state.version },
      );
    }
    appendFrame(frames, markers, before, state, step);
  }

  assertFinalState(state, finalState);
  return { frames, markers };
}

/**
 * Rebuild a completed timeline from transition patches captured by the live
 * authoritative reducer. No game rule, catalogue lookup, RNG call, or deadline
 * logic is executed here; replay archival visualizes the history that actually
 * happened instead of attempting to simulate it again.
 */
export function buildRecordedReplayTimeline(
  genesis: MatchState,
  steps: readonly RecordedReplayStep[],
  finalState: MatchState,
  startedAt: number,
): { frames: ReplayFrame[]; markers: ReplayMarker[] } {
  let state = replayPresentationState(genesis);
  const { frames, markers } = initialTimeline(state, startedAt);

  for (const [commandIndex, step] of steps.entries()) {
    const context = assertStepVersion(state, commandIndex, step);
    const before = state;
    try {
      state = applyReplayStatePatch(state, step.statePatch);
    } catch (cause) {
      throw new ReplayReconstructionError(
        `Recorded state transition for ${step.envelope.commandId} (${step.envelope.command.type}) could not be applied.`,
        context,
        cause,
      );
    }
    if (state.version !== step.resultVersion) {
      throw new ReplayReconstructionError(
        `Recorded state transition ${step.envelope.commandId} produced version ${state.version}; the journal records ${step.resultVersion}.`,
        { ...context, actualVersion: state.version },
      );
    }
    appendFrame(frames, markers, before, state, step);
  }

  assertFinalState(state, finalState);
  return { frames, markers };
}
