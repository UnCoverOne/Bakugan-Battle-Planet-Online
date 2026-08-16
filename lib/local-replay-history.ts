import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
  replayStateHash,
} from "./engine/replay-codec";
import { buildBestEffortReplayTimeline } from "./engine/replay-best-effort";
import { buildFrozenReplayPlayback, buildReplayFrames } from "./engine/replay-playback";
import type { RecordedReplayStep } from "./engine/replay-reconstruction";
import type { ReplayArchive, ReplayFrame, ReplayJournalDraft } from "./engine/replay-types";
import {
  createReplayStatePatch,
  isReplayStatePatch,
  replayPresentationState,
} from "./engine/replay-transition";
import type { CommandEnvelope, GameEvent } from "./engine/types";
import { normalizeRuleObjects } from "./rules/state";
import { buildDisplayableReplayArchive } from "./replay-finalization";

export const LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 3 as const;
const LEGACY_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 2 as const;

export type LocalEngineHistoryTransition = {
  envelope: CommandEnvelope;
  resultVersion: number;
  events: GameEvent[];
  /** Hash of the normalized replay presentation immediately before this command. */
  beforeStateHash?: string;
  /** Hash of the normalized replay presentation immediately after this command. */
  resultStateHash?: string;
};

export type LocalEngineHistoryIntegrityFault = {
  commandId: string;
  expectedBeforeStateHash: string;
  recordedBeforeStateHash: string;
  detectedAt: number;
};

export type LocalEngineHistoryDraft = {
  schemaVersion: typeof LEGACY_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION | typeof LOCAL_ENGINE_HISTORY_SCHEMA_VERSION;
  replayId: string;
  ownerId: string;
  startedAt: number;
  updatedAt: number;
  genesis: MatchState;
  transitions: LocalEngineHistoryTransition[];
  /** Persisted chain head lets a restarted worker validate the next append without replaying history. */
  headStateHash?: string;
  integrityFault?: LocalEngineHistoryIntegrityFault;
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
  return (draft.schemaVersion === LEGACY_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION
      || draft.schemaVersion === LOCAL_ENGINE_HISTORY_SCHEMA_VERSION)
    && typeof draft.replayId === "string"
    && typeof draft.ownerId === "string"
    && Boolean(draft.genesis)
    && Array.isArray(draft.transitions);
}

/**
 * Mirror the reducer's pre-command rules normalization before any local replay
 * state is hashed or patched. This keeps genesis and every transition on the
 * same state shape even when the caller's live MatchState predates rules v3.
 */
export function normalizeLocalReplayState(state: MatchState): MatchState {
  const normalized = structuredClone(state);
  normalizeRuleObjects(normalized);
  return replayPresentationState(normalized);
}

export function localReplayStateHash(state: MatchState) {
  return replayStateHash(normalizeLocalReplayState(state));
}

export function createLocalEngineHistoryDraft(
  state: MatchState,
  ownerId: string,
  startedAt = state.log.find((entry) => Number.isFinite(entry.at))?.at ?? Date.now(),
): LocalEngineHistoryDraft {
  const genesis = normalizeLocalReplayState(state);
  return {
    schemaVersion: LOCAL_ENGINE_HISTORY_SCHEMA_VERSION,
    replayId: state.id,
    ownerId,
    startedAt,
    updatedAt: Date.now(),
    genesis,
    transitions: [],
    headStateHash: replayStateHash(genesis),
  };
}

/**
 * Capture one accepted local transition from the same normalized presentation
 * states used by the persisted genesis. The reducer event is rewritten with
 * this patch so local replay history never mixes raw and normalized state shapes.
 */
export function createLocalEngineHistoryTransition(
  before: MatchState,
  after: MatchState,
  envelope: CommandEnvelope,
  events: readonly GameEvent[],
): LocalEngineHistoryTransition {
  const normalizedBefore = normalizeLocalReplayState(before);
  const normalizedAfter = normalizeLocalReplayState(after);
  const replayStatePatch = createReplayStatePatch(normalizedBefore, normalizedAfter);
  return {
    envelope,
    resultVersion: after.version,
    beforeStateHash: replayStateHash(normalizedBefore),
    resultStateHash: replayStateHash(normalizedAfter),
    events: events.map((event) => event.type === "COMMAND_ACCEPTED"
      ? { ...event, payload: { ...event.payload, replayStatePatch } }
      : event),
  };
}

function expectedDraftHeadHash(draft: LocalEngineHistoryDraft) {
  if (draft.headStateHash) return draft.headStateHash;
  const previousResultHash = draft.transitions.at(-1)?.resultStateHash;
  if (previousResultHash) return previousResultHash;
  if (!draft.transitions.length) return replayStateHash(normalizeLocalReplayState(draft.genesis));
  // Schema-v2 drafts may contain transitions written before chain hashes were
  // introduced. Keep those histories readable rather than inventing a hash.
  return undefined;
}

/**
 * Append one transition while the game is still running. A mismatch means the
 * recorder is about to chain a patch onto a different state shape, so reject it
 * immediately and persist diagnostic details instead of discovering it later in
 * Replay Theatre.
 */
export function appendLocalEngineHistoryTransition(
  draft: LocalEngineHistoryDraft,
  transition: LocalEngineHistoryTransition,
  detectedAt = Date.now(),
) {
  const expectedBeforeStateHash = expectedDraftHeadHash(draft);
  if (
    expectedBeforeStateHash
    && transition.beforeStateHash
    && transition.beforeStateHash !== expectedBeforeStateHash
  ) {
    draft.integrityFault = {
      commandId: transition.envelope.commandId,
      expectedBeforeStateHash,
      recordedBeforeStateHash: transition.beforeStateHash,
      detectedAt,
    };
    draft.updatedAt = detectedAt;
    throw new Error(
      `Local replay history integrity mismatch before ${transition.envelope.commandId}: `
      + `expected ${expectedBeforeStateHash}, received ${transition.beforeStateHash}.`,
    );
  }

  draft.transitions.push(transition);
  draft.headStateHash = transition.resultStateHash ?? draft.headStateHash;
  draft.updatedAt = detectedAt;
  delete draft.integrityFault;
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

function recoverableRecordedSteps(transitions: readonly LocalEngineHistoryTransition[]) {
  const steps: RecordedReplayStep[] = [];
  for (const transition of transitions) {
    try {
      steps.push(recordedStep(transition));
    } catch {
      break;
    }
  }
  return steps;
}

function appendRecoveredFinalFrame(
  timeline: ReturnType<typeof buildBestEffortReplayTimeline>,
  finalState: MatchState,
  completedAt: number,
) {
  const lastFrame = timeline.frames.at(-1);
  const finalPresentation = replayPresentationState(finalState);
  const finalHash = replayStateHash(finalPresentation);
  const needsRecovery = !lastFrame
    || lastFrame.state.version !== finalPresentation.version
    || replayStateHash(lastFrame.state) !== finalHash;
  if (!needsRecovery) return;

  const label = "Replay gap — recovered final battlefield";
  const frame: ReplayFrame = {
    index: timeline.frames.length,
    at: completedAt,
    commandType: "NEXT_TURN",
    label,
    state: finalPresentation,
  };
  timeline.frames.push(frame);
  timeline.markers.push({
    index: frame.index,
    at: frame.at,
    type: finalPresentation.phase === "result" ? "result" : "command",
    label,
  });
}

/**
 * Compile a frozen replay only when the player asks to watch it. New local
 * histories use the exact state patches already carried by COMMAND_ACCEPTED
 * engine events; legacy command journals remain readable as a compatibility
 * path for matches that were already in progress during the migration.
 *
 * Local histories deliberately use best-effort reconstruction. A damaged or
 * inapplicable transition must never make every earlier valid frame disappear:
 * playback stops at the first untrustworthy transition and appends the sealed
 * authoritative final battlefield instead.
 */
export function compileLocalReplayHistory(draft: StoredLocalReplayJournal): ReplayArchive {
  if (!draft.finalState || !draft.completedAt) {
    throw new Error("Local engine history is not complete yet.");
  }

  if (!isLocalEngineHistoryDraft(draft)) {
    return buildDisplayableReplayArchive(draft.recording, draft.finalState, draft.completedAt);
  }

  const steps = recoverableRecordedSteps(draft.transitions);
  const timeline = buildBestEffortReplayTimeline(draft.genesis, steps, draft.startedAt);
  appendRecoveredFinalFrame(timeline, draft.finalState, draft.completedAt);

  const recording = createReplayRecording(draft.genesis);
  recording.commands = timeline.appliedSteps.map((step) => compactReplayCommand(step.envelope));
  const archive = archiveReplayRecording(recording, draft.finalState, draft.completedAt);
  archive.startedAt = draft.startedAt;
  archive.playback = buildFrozenReplayPlayback(timeline.frames, timeline.markers);
  buildReplayFrames(archive);
  return archive;
}
