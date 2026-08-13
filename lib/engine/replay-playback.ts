import type { MatchState } from "../game";
import { projectMatchForPlayer } from "./projection";
import { applyStatePatch, createStatePatch } from "./state-patch";
import { reduceMatch } from "./reducer";
import { expandReplayCommand, expandReplayGenesis, legacyReplayStateHash, replayStateHash } from "./replay-codec";
import type { ReplayArchive, ReplayBundle, ReplayFrame, ReplayMarker, ReplayTransportBundle } from "./replay-types";
import type { EngineBackedMatchState, GameCommand } from "./types";

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

export function buildReplayFrames(archive: ReplayArchive): { frames: ReplayFrame[]; markers: ReplayMarker[] } {
  let state = expandReplayGenesis(archive.recording.genesis) as EngineBackedMatchState;
  const initialAt = archive.startedAt;
  const initialLabel = state.phase === "lobby" ? "Match created" : "Gameplay begins";
  const frames: ReplayFrame[] = [{ index: 0, at: initialAt, commandType: "CREATE_MATCH", label: initialLabel, state }];
  const markers: ReplayMarker[] = [{ index: 0, at: initialAt, type: "start", label: initialLabel }];
  const localTransitions = archive.recording.localTransitions ?? [];
  const applyLocalTransitions = (commandCount: number) => {
    for (const transition of localTransitions.filter((candidate) => (candidate.q ?? archive.recording.commands.length) === commandCount)) {
      const previousPhase = state.phase;
      state = applyStatePatch(state as MatchState & Record<string, unknown>, transition.p) as EngineBackedMatchState;
      const frame = {
        index: frames.length,
        at: transition.t,
        commandType: "NEXT_TURN" as const,
        label: transition.l,
        state,
      } satisfies ReplayFrame;
      frames.push(frame);
      if (state.phase === "result") markers.push({ index: frame.index, at: frame.at, type: "result", label: frame.label });
      else if (previousPhase !== state.phase) markers.push({ index: frame.index, at: frame.at, type: "phase", label: frame.label });
    }
  };
  applyLocalTransitions(0);
  for (const [commandIndex, compact] of archive.recording.commands.entries()) {
    const before = state;
    const command = expandReplayCommand(state.id, compact, commandIndex, state.version);
    const result = reduceMatch(state, command);
    state = result.state;
    if (!result.changed) continue;
    const frame = {
      index: frames.length,
      at: command.issuedAt,
      commandType: command.command.type,
      label: commandLabel(command.command, state),
      state,
    } satisfies ReplayFrame;
    frames.push(frame);
    const type = markerType(command.command, before, state);
    if (type !== "command") markers.push({ index: frame.index, at: frame.at, type, label: frame.label });
    applyLocalTransitions(commandIndex + 1);
  }
  const hash = replayStateHash(state);
  const legacyHash = legacyReplayStateHash(state);
  if ((hash !== archive.finalStateHash && legacyHash !== archive.finalStateHash) || state.version !== archive.finalVersion) {
    throw new Error(`Replay integrity check failed (expected v${archive.finalVersion}/${archive.finalStateHash}, received v${state.version}/${hash}).`);
  }
  return { frames, markers };
}

export function buildProjectedReplayBundle(archive: ReplayArchive, playerId: string): ReplayBundle {
  const playback = buildReplayFrames(archive);
  const archiveSummary = structuredClone(archive) as Partial<ReplayArchive>;
  delete archiveSummary.recording;
  return {
    archive: archiveSummary as Omit<ReplayArchive, "recording">,
    perspectivePlayerId: playerId,
    frames: playback.frames.map((frame) => ({ ...frame, state: projectMatchForPlayer(frame.state, playerId) })),
    markers: playback.markers,
  };
}

export function encodeReplayTransport(bundle: ReplayBundle): ReplayTransportBundle {
  const initialState = bundle.frames[0]?.state;
  if (!initialState) throw new Error("Replay contains no initial frame.");
  return {
    archive: bundle.archive,
    perspectivePlayerId: bundle.perspectivePlayerId,
    initialState,
    steps: bundle.frames.slice(1).map((frame, offset) => ({
      index: frame.index,
      at: frame.at,
      commandType: frame.commandType,
      label: frame.label,
      patch: createStatePatch(bundle.frames[offset].state, frame.state),
    })),
    markers: bundle.markers,
  };
}

export function decodeReplayTransport(bundle: ReplayTransportBundle): ReplayBundle {
  const initialLabel = bundle.initialState.phase === "lobby" ? "Match created" : "Gameplay begins";
  const frames: ReplayFrame[] = [{
    index: 0,
    at: bundle.archive.startedAt,
    commandType: "CREATE_MATCH",
    label: initialLabel,
    state: structuredClone(bundle.initialState),
  }];
  for (const step of bundle.steps) {
    const previous = frames.at(-1)!.state;
    frames.push({
      index: step.index,
      at: step.at,
      commandType: step.commandType,
      label: step.label,
      state: applyStatePatch(previous as MatchState & Record<string, unknown>, step.patch),
    });
  }
  return { archive: bundle.archive, perspectivePlayerId: bundle.perspectivePlayerId, frames, markers: bundle.markers };
}
