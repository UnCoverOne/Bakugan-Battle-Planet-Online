import type { MatchState } from "../game";
import { reduceMatch } from "./reducer";
import {
  ReplayReconstructionError,
  type AuthoritativeReplayStep,
} from "./replay-reconstruction";
import type { ReplayFrame, ReplayMarker } from "./replay-types";
import {
  applyReplayStatePatch,
  replayPresentationState,
  type ReplayStatePatchOperation,
} from "./replay-transition";
import type { EngineBackedMatchState, GameCommand } from "./types";

export type BestEffortReplayStep = AuthoritativeReplayStep & {
  statePatch?: readonly ReplayStatePatchOperation[];
};

export type BestEffortReplayTimeline = {
  frames: ReplayFrame[];
  markers: ReplayMarker[];
  appliedSteps: BestEffortReplayStep[];
  failure?: ReplayReconstructionError;
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

function failureForStep(
  message: string,
  state: MatchState,
  commandIndex: number,
  step: BestEffortReplayStep,
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

/**
 * Reconstruct as much of a replay journal as is trustworthy without allowing a
 * single damaged command to discard earlier valid frames. The caller can append
 * an authoritative checkpoint or final state after the returned prefix.
 */
export function buildBestEffortReplayTimeline(
  genesis: MatchState,
  steps: readonly BestEffortReplayStep[],
  startedAt: number,
): BestEffortReplayTimeline {
  const useRecordedState = steps.every((step) => Array.isArray(step.statePatch));
  let state = useRecordedState
    ? replayPresentationState(genesis)
    : structuredClone(genesis) as EngineBackedMatchState;
  const { frames, markers } = initialTimeline(state, startedAt);
  const appliedSteps: BestEffortReplayStep[] = [];

  for (const [commandIndex, step] of steps.entries()) {
    if (step.envelope.expectedVersion !== state.version) {
      return {
        frames,
        markers,
        appliedSteps,
        failure: failureForStep(
          `Replay command journal has a version gap before ${step.envelope.commandId}.`,
          state,
          commandIndex,
          step,
        ),
      };
    }

    const before = state;
    try {
      if (useRecordedState) {
        state = applyReplayStatePatch(state, step.statePatch!);
      } else {
        const result = reduceMatch(state as EngineBackedMatchState, step.envelope);
        state = result.state;
        if (!result.changed) {
          return {
            frames,
            markers,
            appliedSteps,
            failure: failureForStep(
              `Persisted replay command ${step.envelope.commandId} did not advance the reconstructed match.`,
              state,
              commandIndex,
              step,
            ),
          };
        }
      }
    } catch (cause) {
      return {
        frames,
        markers,
        appliedSteps,
        failure: failureForStep(
          `Replay command ${step.envelope.commandId} (${step.envelope.command.type}) could not be reconstructed.`,
          before,
          commandIndex,
          step,
          cause,
        ),
      };
    }

    if (state.version !== step.resultVersion) {
      return {
        frames,
        markers,
        appliedSteps,
        failure: failureForStep(
          `Replay command ${step.envelope.commandId} produced version ${state.version}; the journal records ${step.resultVersion}.`,
          state,
          commandIndex,
          step,
        ),
      };
    }

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
    appliedSteps.push(step);
  }

  return { frames, markers, appliedSteps };
}
