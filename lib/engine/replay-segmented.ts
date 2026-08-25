import type { MatchState } from "../game";
import { reduceMatch } from "./reducer";
import { replayStateHash } from "./replay-codec";
import { ReplayReconstructionError } from "./replay-reconstruction";
import type { ReplayFrame, ReplayMarker } from "./replay-types";
import {
  applyReplayStatePatch,
  replayPresentationState,
  type ReplayStatePatchOperation,
} from "./replay-transition";
import type { CommandEnvelope, GameCommand } from "./types";

export type SegmentedReplayStep = {
  envelope: CommandEnvelope;
  resultVersion: number;
  statePatch?: readonly ReplayStatePatchOperation[];
  beforeStateHash?: string;
  resultStateHash?: string;
};

export type ReplayRecoveryCheckpoint = {
  state: MatchState;
  at: number;
  label?: string;
};

export type SegmentedReplayTimeline = {
  frames: ReplayFrame[];
  markers: ReplayMarker[];
  appliedSteps: SegmentedReplayStep[];
  failures: ReplayReconstructionError[];
};

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

function checkpointMarkerType(before: MatchState, after: MatchState): ReplayMarker["type"] {
  if (after.phase === "result") return "result";
  if (after.gameNumber !== before.gameNumber) return "game";
  if (after.phase !== before.phase) return "phase";
  return "command";
}

function failureForStep(
  message: string,
  state: MatchState,
  commandIndex: number,
  step: SegmentedReplayStep,
  cause?: unknown,
) {
  return new ReplayReconstructionError(message, {
    commandIndex,
    commandId: step.envelope.commandId,
    commandType: step.envelope.command.type,
    expectedVersion: step.envelope.expectedVersion,
    actualVersion: state.version,
    resultVersion: step.resultVersion,
  }, cause);
}

function normalizeCheckpoint(checkpoint: ReplayRecoveryCheckpoint) {
  return {
    ...checkpoint,
    state: replayPresentationState(checkpoint.state),
  };
}

function checkpointIdentity(checkpoint: ReplayRecoveryCheckpoint) {
  return `${checkpoint.state.version}:${replayStateHash(checkpoint.state)}:${checkpoint.at}`;
}

function appendCheckpointFrame(
  frames: ReplayFrame[],
  markers: ReplayMarker[],
  before: MatchState,
  checkpoint: ReplayRecoveryCheckpoint,
) {
  const state = checkpoint.state;
  const label = checkpoint.label ?? `Replay gap — resumed from checkpoint v${state.version}`;
  const frame: ReplayFrame = {
    index: frames.length,
    at: checkpoint.at,
    commandType: "NEXT_TURN",
    label,
    state,
  };
  frames.push(frame);
  markers.push({
    index: frame.index,
    at: frame.at,
    type: checkpointMarkerType(before, state),
    label,
  });
}

function appendCommandFrame(
  frames: ReplayFrame[],
  markers: ReplayMarker[],
  before: MatchState,
  state: MatchState,
  step: SegmentedReplayStep,
) {
  const frame: ReplayFrame = {
    index: frames.length,
    at: step.envelope.issuedAt,
    commandType: step.envelope.command.type,
    label: commandLabel(step.envelope.command, state),
    state,
  };
  frames.push(frame);
  const type = markerType(step.envelope.command, before, state);
  if (type !== "command") markers.push({ index: frame.index, at: frame.at, type, label: frame.label });
}

function applyStep(state: MatchState, step: SegmentedReplayStep, commandIndex: number) {
  if (step.envelope.expectedVersion !== state.version) {
    throw failureForStep(
      `Replay command journal has a version gap before ${step.envelope.commandId}.`,
      state,
      commandIndex,
      step,
    );
  }

  const beforeHash = replayStateHash(state);
  if (step.beforeStateHash && step.beforeStateHash !== beforeHash) {
    throw failureForStep(
      `Replay command journal has a state-hash gap before ${step.envelope.commandId}.`,
      state,
      commandIndex,
      step,
    );
  }

  let next: MatchState;
  try {
    if (step.statePatch) {
      next = applyReplayStatePatch(state, step.statePatch);
    } else {
      const result = reduceMatch(state, step.envelope);
      if (!result.changed) {
        throw failureForStep(
          `Persisted replay command ${step.envelope.commandId} did not advance the reconstructed match.`,
          state,
          commandIndex,
          step,
        );
      }
      next = replayPresentationState(result.state);
    }
  } catch (cause) {
    if (cause instanceof ReplayReconstructionError) throw cause;
    throw failureForStep(
      `Replay command ${step.envelope.commandId} (${step.envelope.command.type}) could not be reconstructed.`,
      state,
      commandIndex,
      step,
      cause,
    );
  }

  if (next.version !== step.resultVersion) {
    throw failureForStep(
      `Replay command ${step.envelope.commandId} produced version ${next.version}; the journal records ${step.resultVersion}.`,
      next,
      commandIndex,
      step,
    );
  }

  const resultHash = replayStateHash(next);
  if (step.resultStateHash && step.resultStateHash !== resultHash) {
    throw failureForStep(
      `Replay command ${step.envelope.commandId} produced state hash ${resultHash}; the journal records ${step.resultStateHash}.`,
      next,
      commandIndex,
      step,
    );
  }
  return next;
}

function exactCheckpointForStep(
  checkpoints: readonly ReplayRecoveryCheckpoint[],
  state: MatchState,
  step: SegmentedReplayStep,
  used: ReadonlySet<string>,
) {
  return checkpoints.find((checkpoint) => {
    if (used.has(checkpointIdentity(checkpoint))) return false;
    if (checkpoint.state.version !== step.envelope.expectedVersion) return false;
    if (replayStateHash(checkpoint.state) === replayStateHash(state)) return false;
    return !step.beforeStateHash || replayStateHash(checkpoint.state) === step.beforeStateHash;
  });
}

function futureCheckpointForStep(
  checkpoints: readonly ReplayRecoveryCheckpoint[],
  state: MatchState,
  step: SegmentedReplayStep,
  used: ReadonlySet<string>,
) {
  return checkpoints.find((checkpoint) => (
    !used.has(checkpointIdentity(checkpoint))
    && checkpoint.state.version > state.version
    && checkpoint.state.version >= step.resultVersion
  ));
}

/**
 * Reconstructs every trustworthy replay segment it can prove. A damaged or
 * missing transition closes only the current segment: the compiler advances to
 * the earliest authoritative checkpoint that can re-establish state, then keeps
 * consuming later engine transitions. Hash validation stays strict inside each
 * segment, so recovery never treats an unknown predecessor as trustworthy.
 */
export function buildSegmentedReplayTimeline(
  genesis: MatchState,
  steps: readonly SegmentedReplayStep[],
  startedAt: number,
  recoveryCheckpoints: readonly ReplayRecoveryCheckpoint[] = [],
): SegmentedReplayTimeline {
  let state = replayPresentationState(genesis);
  const initialLabel = state.phase === "lobby" ? "Match created" : "Gameplay begins";
  const frames: ReplayFrame[] = [{
    index: 0,
    at: startedAt,
    commandType: "CREATE_MATCH",
    label: initialLabel,
    state,
  }];
  const markers: ReplayMarker[] = [{ index: 0, at: startedAt, type: "start", label: initialLabel }];
  const appliedSteps: SegmentedReplayStep[] = [];
  const failures: ReplayReconstructionError[] = [];
  const usedCheckpoints = new Set<string>();
  const checkpoints = recoveryCheckpoints
    .map(normalizeCheckpoint)
    .filter((checkpoint) => checkpoint.state.id === state.id)
    .sort((left, right) => left.state.version - right.state.version || left.at - right.at);

  for (const [commandIndex, step] of steps.entries()) {
    if (step.resultVersion <= state.version) continue;

    let retriedFromCheckpoint = false;
    while (true) {
      try {
        const before = state;
        state = applyStep(state, step, commandIndex);
        appendCommandFrame(frames, markers, before, state, step);
        appliedSteps.push(step);
        break;
      } catch (error) {
        const failure = error instanceof ReplayReconstructionError
          ? error
          : failureForStep("Replay reconstruction failed.", state, commandIndex, step, error);
        failures.push(failure);

        if (!retriedFromCheckpoint) {
          const exact = exactCheckpointForStep(checkpoints, state, step, usedCheckpoints);
          if (exact) {
            const before = state;
            appendCheckpointFrame(frames, markers, before, exact);
            state = exact.state;
            usedCheckpoints.add(checkpointIdentity(exact));
            retriedFromCheckpoint = true;
            continue;
          }
        }

        const future = futureCheckpointForStep(checkpoints, state, step, usedCheckpoints);
        if (future) {
          const before = state;
          appendCheckpointFrame(frames, markers, before, future);
          state = future.state;
          usedCheckpoints.add(checkpointIdentity(future));
        }
        break;
      }
    }
  }

  // If the journal ends while authoritative checkpoints continue, preserve the
  // remaining genuine battlefield history instead of jumping straight to the
  // final state. This also recovers a damaged final command whose row could not
  // be parsed into a replay step at all.
  for (const checkpoint of checkpoints) {
    const key = checkpointIdentity(checkpoint);
    if (usedCheckpoints.has(key)) continue;
    const checkpointHash = replayStateHash(checkpoint.state);
    const stateHash = replayStateHash(state);
    if (checkpoint.state.version < state.version) continue;
    if (checkpoint.state.version === state.version && checkpointHash === stateHash) continue;
    const before = state;
    appendCheckpointFrame(frames, markers, before, checkpoint);
    state = checkpoint.state;
    usedCheckpoints.add(key);
  }

  return { frames, markers, appliedSteps, failures };
}
