import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
} from "./engine/replay-codec";
import { buildFrozenReplayPlayback, buildReplayFrames } from "./engine/replay-playback";
import { buildRecordedReplayTimeline, type RecordedReplayStep } from "./engine/replay-reconstruction";
import type { ReplayArchive, ReplayJournalDraft } from "./engine/replay-types";
import { isReplayStatePatch } from "./engine/replay-transition";
import type { CommandEnvelope, GameEvent } from "./engine/types";
import { buildDisplayableReplayArchive } from "./replay-finalization";

export const LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 2 as const;

export type LocalEngineHistoryTransition = {
  envelope: CommandEnvelope;
  resultVersion: number;
  events: GameEvent[];
};

export type LocalEngineHistoryDraft = {
  schemaVersion: typeof LOCAL_ENGINE_HISTORY_SCHEMA_VERSION;
  replayId: string;
  ownerId: string;
  startedAt: number;
  updatedAt: number;
  genesis: MatchState;
  transitions: LocalEngineHistoryTransition[];
  finalState?: MatchState;
  completedAt?: number;
};

export type LegacyLocalReplayJournal = ReplayJournalDraft & {
  schemaVersion?: 1;
  finalState?: MatchState;
  completedAt?: number;
};

export type StoredLocalReplayJournal = LocalEngineHistoryDraft | LegacyLocalReplayJournal;

export function isLocalEngineHistoryDraft(value: unknown): value is LocalEngineHistoryDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<LocalEngineHistoryDraft>;
  return draft.schemaVersion === LOCAL_ENGINE_HISTORY_SCHEMA_VERSION
    && typeof draft.replayId === "string"
    && typeof draft.ownerId === "string"
    && Boolean(draft.genesis)
    && Array.isArray(draft.transitions);
}

export function createLocalEngineHistoryDraft(
  state: MatchState,
  ownerId: string,
  startedAt = state.log.find((entry) => Number.isFinite(entry.at))?.at ?? Date.now(),
): LocalEngineHistoryDraft {
  return {
    schemaVersion: LOCAL_ENGINE_HISTORY_SCHEMA_VERSION,
    replayId: state.id,
    ownerId,
    startedAt,
    updatedAt: Date.now(),
    genesis: structuredClone(state),
    transitions: [],
  };
}

function recordedStep(transition: LocalEngineHistoryTransition): RecordedReplayStep {
  const accepted = transition.events.find((event) => (
    event.type === "COMMAND_ACCEPTED" && event.commandId === transition.envelope.commandId
  ));
  const patch = accepted?.payload?.replayStatePatch;
  if (!isReplayStatePatch(patch)) {
    throw new Error(`Local engine history is missing the replay state patch for ${transition.envelope.commandId}.`);
  }
  return {
    envelope: transition.envelope,
    resultVersion: transition.resultVersion,
    statePatch: patch,
  };
}

/**
 * Compile a frozen replay only when the player asks to watch it. New local
 * histories use the exact state patches already carried by COMMAND_ACCEPTED
 * engine events; legacy command journals remain readable as a compatibility
 * path for matches that were already in progress during the migration.
 */
export function compileLocalReplayHistory(draft: StoredLocalReplayJournal): ReplayArchive {
  if (!draft.finalState || !draft.completedAt) {
    throw new Error("Local engine history is not complete yet.");
  }

  if (!isLocalEngineHistoryDraft(draft)) {
    return buildDisplayableReplayArchive(draft.recording, draft.finalState, draft.completedAt);
  }

  const steps = draft.transitions.map(recordedStep);
  const recording = createReplayRecording(draft.genesis);
  recording.commands = draft.transitions.map((transition) => compactReplayCommand(transition.envelope));
  const archive = archiveReplayRecording(recording, draft.finalState, draft.completedAt);
  archive.startedAt = draft.startedAt;
  const timeline = buildRecordedReplayTimeline(draft.genesis, steps, draft.finalState, draft.startedAt);
  archive.playback = buildFrozenReplayPlayback(timeline.frames, timeline.markers);
  buildReplayFrames(archive);
  return archive;
}
