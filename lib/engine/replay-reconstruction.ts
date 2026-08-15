import type { MatchState } from "../game";
import { reduceMatch } from "./reducer";
import { replayStateHash } from "./replay-codec";
import type { ReplayFrame, ReplayMarker } from "./replay-types";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "./types";

export type AuthoritativeReplayStep = {
  envelope: CommandEnvelope;
  resultVersion: number;
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

/**
 * Rebuild a completed timeline from the exact authoritative gameplay snapshot
 * and the persisted command journal. Unlike the compact archive codec, this
 * path never expands the genesis through the currently loaded catalogue.
 */
export function buildAuthoritativeReplayTimeline(
  genesis: MatchState,
  steps: readonly AuthoritativeReplayStep[],
  finalState: MatchState,
  startedAt: number,
): { frames: ReplayFrame[]; markers: ReplayMarker[] } {
  let state = structuredClone(genesis) as EngineBackedMatchState;
  const initialLabel = state.phase === "lobby" ? "Match created" : "Gameplay begins";
  const frames: ReplayFrame[] = [{
    index: 0,
    at: startedAt,
    commandType: "CREATE_MATCH",
    label: initialLabel,
    state,
  }];
  const markers: ReplayMarker[] = [{ index: 0, at: startedAt, type: "start", label: initialLabel }];

  for (const [commandIndex, step] of steps.entries()) {
    const { envelope, resultVersion } = step;
    const context: ReplayReconstructionContext = {
      commandIndex,
      commandId: envelope.commandId,
      commandType: envelope.command.type,
      expectedVersion: envelope.expectedVersion,
      actualVersion: state.version,
      resultVersion,
    };
    if (envelope.expectedVersion !== state.version) {
      throw new ReplayReconstructionError(
        `Replay command journal has a version gap before ${envelope.commandId}.`,
        context,
      );
    }

    const before = state;
    let result: ReturnType<typeof reduceMatch>;
    try {
      result = reduceMatch(state, envelope);
    } catch (cause) {
      throw new ReplayReconstructionError(
        `Replay command ${envelope.commandId} (${envelope.command.type}) could not be reduced.`,
        context,
        cause,
      );
    }
    state = result.state;
    if (!result.changed) {
      throw new ReplayReconstructionError(
        `Persisted replay command ${envelope.commandId} did not advance the reconstructed match.`,
        { ...context, actualVersion: state.version },
      );
    }
    if (state.version !== resultVersion) {
      throw new ReplayReconstructionError(
        `Replay command ${envelope.commandId} produced version ${state.version}; the journal records ${resultVersion}.`,
        { ...context, actualVersion: state.version },
      );
    }

    const frame = {
      index: frames.length,
      at: envelope.issuedAt,
      commandType: envelope.command.type,
      label: commandLabel(envelope.command, state),
      state,
    } satisfies ReplayFrame;
    frames.push(frame);
    const type = markerType(envelope.command, before, state);
    if (type !== "command") markers.push({ index: frame.index, at: frame.at, type, label: frame.label });
  }

  const reconstructedHash = replayStateHash(state);
  const authoritativeHash = replayStateHash(finalState);
  if (state.version !== finalState.version || reconstructedHash !== authoritativeHash) {
    throw new ReplayReconstructionError(
      `Replay final-state integrity check failed (expected v${finalState.version}/${authoritativeHash}, received v${state.version}/${reconstructedHash}).`,
      { actualVersion: state.version, resultVersion: finalState.version },
    );
  }
  return { frames, markers };
}
