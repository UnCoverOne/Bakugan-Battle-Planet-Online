import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
  replayStateHash,
} from "./engine/replay-codec";
import { normalizeEngineState } from "./engine/events";
import { buildFrozenReplayPlayback, buildReplayFrames } from "./engine/replay-playback";
import {
  buildSegmentedReplayTimeline,
  type ReplayRecoveryCheckpoint,
  type SegmentedReplayStep,
} from "./engine/replay-segmented";
import type { ReplayArchive, ReplayJournalDraft } from "./engine/replay-types";
import {
  createReplayStatePatch,
  isReplayStatePatch,
  replayPresentationState,
} from "./engine/replay-transition";
import type { CommandEnvelope, GameEvent } from "./engine/types";
import { normalizeRuleObjects } from "./rules/state";
import { buildDisplayableReplayArchive } from "./replay-finalization";

export const LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 4 as const;
const LEGACY_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 2 as const;
const HASHED_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION = 3 as const;

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

export type LocalEngineHistoryCheckpoint = {
  version: number;
  at: number;
  state: MatchState;
  stateHash: string;
  reason: "periodic" | "integrity-resync";
};

export type LocalEngineHistoryDraft = {
  schemaVersion:
    | typeof LEGACY_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION
    | typeof HASHED_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION
    | typeof LOCAL_ENGINE_HISTORY_SCHEMA_VERSION;
  replayId: string;
  ownerId: string;
  startedAt: number;
  updatedAt: number;
  genesis: MatchState;
  transitions: LocalEngineHistoryTransition[];
  /** Persisted chain head lets a restarted worker validate the next append without replaying history. */
  headStateHash?: string;
  /** Latest fault retained for existing diagnostics. */
  integrityFault?: LocalEngineHistoryIntegrityFault;
  /** Bounded fault history keeps multiple replay gaps diagnosable. */
  integrityFaults?: LocalEngineHistoryIntegrityFault[];
  /** Authoritative engine checkpoints used only to re-anchor after a damaged range. */
  checkpoints?: LocalEngineHistoryCheckpoint[];
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
      || draft.schemaVersion === HASHED_LOCAL_ENGINE_HISTORY_SCHEMA_VERSION
      || draft.schemaVersion === LOCAL_ENGINE_HISTORY_SCHEMA_VERSION)
    && typeof draft.replayId === "string"
    && typeof draft.ownerId === "string"
    && Boolean(draft.genesis)
    && Array.isArray(draft.transitions);
}

/**
 * Mirror reduceMatch's pre-command normalization before any local replay state
 * is hashed or patched. Engine metadata is normalized first, rules objects are
 * normalized second, and replayPresentationState then removes non-playback data.
 */
export function normalizeLocalReplayState(state: MatchState): MatchState {
  const normalized = normalizeEngineState(state);
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
    checkpoints: [],
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

function rememberCheckpoint(
  draft: LocalEngineHistoryDraft,
  state: MatchState,
  at: number,
  reason: LocalEngineHistoryCheckpoint["reason"],
) {
  const normalized = normalizeLocalReplayState(state);
  const stateHash = replayStateHash(normalized);
  const checkpoints = draft.checkpoints ?? (draft.checkpoints = []);
  const existing = checkpoints.find((checkpoint) => (
    checkpoint.version === normalized.version && checkpoint.stateHash === stateHash
  ));
  if (existing) {
    if (reason === "integrity-resync") existing.reason = reason;
    existing.at = Math.min(existing.at, at);
    return;
  }
  checkpoints.push({
    version: normalized.version,
    at,
    state: normalized,
    stateHash,
    reason,
  });
  checkpoints.sort((left, right) => left.version - right.version || left.at - right.at);
}

function rememberIntegrityFault(
  draft: LocalEngineHistoryDraft,
  fault: LocalEngineHistoryIntegrityFault,
) {
  draft.integrityFault = fault;
  const faults = draft.integrityFaults ?? (draft.integrityFaults = []);
  if (!faults.some((candidate) => (
    candidate.commandId === fault.commandId
    && candidate.expectedBeforeStateHash === fault.expectedBeforeStateHash
    && candidate.recordedBeforeStateHash === fault.recordedBeforeStateHash
  ))) {
    faults.push(fault);
    if (faults.length > 20) faults.splice(0, faults.length - 20);
  }
}

/**
 * Append one authoritative engine transition. A chain mismatch is a replay
 * segment boundary, not a reason to poison every later command. When the worker
 * supplies the exact pre-command engine state, persist it as a resynchronization
 * checkpoint, advance the durable chain head to this transition's result, and
 * continue recording subsequent history normally.
 *
 * The third argument remains number-compatible with schema-v3 unit callers.
 */
export function appendLocalEngineHistoryTransition(
  draft: LocalEngineHistoryDraft,
  transition: LocalEngineHistoryTransition,
  beforeStateOrDetectedAt?: MatchState | number,
  detectedAt = Date.now(),
) {
  const beforeState = typeof beforeStateOrDetectedAt === "number" ? undefined : beforeStateOrDetectedAt;
  const timestamp = typeof beforeStateOrDetectedAt === "number" ? beforeStateOrDetectedAt : detectedAt;
  draft.schemaVersion = LOCAL_ENGINE_HISTORY_SCHEMA_VERSION;
  draft.checkpoints ??= [];

  const expectedBeforeStateHash = expectedDraftHeadHash(draft);
  const recordedBeforeStateHash = transition.beforeStateHash;
  const checkpointHash = beforeState ? localReplayStateHash(beforeState) : undefined;
  const checkpointMatchesTransition = Boolean(
    beforeState
    && (!recordedBeforeStateHash || checkpointHash === recordedBeforeStateHash),
  );

  const chainMismatch = Boolean(
    expectedBeforeStateHash
    && recordedBeforeStateHash
    && recordedBeforeStateHash !== expectedBeforeStateHash,
  );

  if (chainMismatch) {
    rememberIntegrityFault(draft, {
      commandId: transition.envelope.commandId,
      expectedBeforeStateHash: expectedBeforeStateHash!,
      recordedBeforeStateHash: recordedBeforeStateHash!,
      detectedAt: timestamp,
    });
    if (beforeState && checkpointMatchesTransition) {
      rememberCheckpoint(draft, beforeState, transition.envelope.issuedAt, "integrity-resync");
    }
  } else if (
    beforeState
    && checkpointMatchesTransition
    && (
      beforeState.version % 5 === 0
      || transition.events.some((event) => event.type === "PHASE_CHANGED" || event.type === "GAME_ENDED")
    )
  ) {
    // Match the online event store's coarse checkpoint cadence so storage
    // corruption discovered later can skip to a nearby genuine engine state.
    rememberCheckpoint(draft, beforeState, transition.envelope.issuedAt, "periodic");
  }

  draft.transitions.push(transition);
  draft.headStateHash = transition.resultStateHash ?? draft.headStateHash;
  draft.updatedAt = timestamp;
}

function replayStep(transition: LocalEngineHistoryTransition): SegmentedReplayStep {
  const accepted = transition.events.find((event) => (
    event.type === "COMMAND_ACCEPTED" && event.commandId === transition.envelope.commandId
  ));
  const patch = accepted?.payload?.replayStatePatch;
  return {
    envelope: transition.envelope,
    resultVersion: transition.resultVersion,
    beforeStateHash: transition.beforeStateHash,
    resultStateHash: transition.resultStateHash,
    ...(isReplayStatePatch(patch) ? { statePatch: patch } : {}),
  };
}

function recoveryCheckpoints(draft: LocalEngineHistoryDraft): ReplayRecoveryCheckpoint[] {
  const checkpoints = (draft.checkpoints ?? []).map((checkpoint) => ({
    state: checkpoint.state,
    at: checkpoint.at,
    label: checkpoint.reason === "integrity-resync"
      ? `Replay gap — resumed from engine checkpoint v${checkpoint.version}`
      : undefined,
  }));
  if (draft.finalState && draft.completedAt) {
    checkpoints.push({
      state: normalizeLocalReplayState(draft.finalState),
      at: draft.completedAt,
      label: "Replay gap — recovered final battlefield",
    });
  }
  return checkpoints;
}

/**
 * Compile a frozen replay only when the player asks to watch it. Replay remains
 * a projection of engine history: exact transition patches are preferred, while
 * authoritative engine checkpoints are only used to bridge damaged or missing
 * ranges. A gap therefore lowers fidelity locally instead of discarding every
 * trustworthy frame that follows it.
 */
export function compileLocalReplayHistory(draft: StoredLocalReplayJournal): ReplayArchive {
  if (!draft.finalState || !draft.completedAt) {
    throw new Error("Local engine history is not complete yet.");
  }

  if (!isLocalEngineHistoryDraft(draft)) {
    return buildDisplayableReplayArchive(draft.recording, draft.finalState, draft.completedAt);
  }

  const steps = draft.transitions.map(replayStep);
  const timeline = buildSegmentedReplayTimeline(
    draft.genesis,
    steps,
    draft.startedAt,
    recoveryCheckpoints(draft),
  );

  const recording = createReplayRecording(draft.genesis);
  recording.commands = timeline.appliedSteps.map((step) => compactReplayCommand(step.envelope));
  const archive = archiveReplayRecording(recording, draft.finalState, draft.completedAt);
  archive.startedAt = draft.startedAt;
  archive.playback = buildFrozenReplayPlayback(timeline.frames, timeline.markers);
  buildReplayFrames(archive);
  return archive;
}
