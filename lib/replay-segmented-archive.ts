import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
} from "./engine/replay-codec";
import { buildFrozenReplayPlayback, buildReplayFrames } from "./engine/replay-playback";
import {
  buildSegmentedReplayTimeline,
  type ReplayRecoveryCheckpoint,
  type SegmentedReplayStep,
} from "./engine/replay-segmented";
import type { ReplayArchive } from "./engine/replay-types";
import { isReplayStatePatch } from "./engine/replay-transition";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "./engine/types";

export type SegmentedReplayCommandRow = {
  command_id: string;
  actor_id: string;
  expected_version: number;
  result_version: number;
  payload_json: string;
  created_at: number;
};

export type SegmentedReplaySnapshotRow = {
  version: number;
  state_json: string;
  created_at: number;
};

function parseAcceptedCommand(row: SegmentedReplayCommandRow, gameId: string): SegmentedReplayStep | null {
  try {
    const payload = JSON.parse(row.payload_json) as {
      command?: GameCommand;
      randomSeed?: string;
      requestHash?: string;
      replayStatePatch?: unknown;
    };
    if (!payload.command || typeof payload.command.type !== "string" || !payload.randomSeed) return null;
    const envelope: CommandEnvelope = {
      commandId: row.command_id,
      gameId,
      actorId: row.actor_id,
      expectedVersion: row.expected_version,
      issuedAt: row.created_at,
      randomSeed: payload.randomSeed,
      requestHash: payload.requestHash ?? `archive:${row.command_id}`,
      command: payload.command,
    };
    return {
      envelope,
      resultVersion: row.result_version,
      ...(isReplayStatePatch(payload.replayStatePatch) ? { statePatch: payload.replayStatePatch } : {}),
    };
  } catch {
    return null;
  }
}

function recoveryCheckpoints(
  rows: readonly SegmentedReplaySnapshotRow[],
  finalState: EngineBackedMatchState,
  completedAt: number,
): ReplayRecoveryCheckpoint[] {
  const checkpoints: ReplayRecoveryCheckpoint[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((left, right) => left.version - right.version || left.created_at - right.created_at)) {
    if (seen.has(row.version)) continue;
    try {
      const state = JSON.parse(row.state_json) as MatchState;
      if (state.id !== finalState.id || state.code !== finalState.code || state.phase === "lobby") continue;
      if (state.version !== row.version) continue;
      seen.add(row.version);
      checkpoints.push({ state, at: row.created_at });
    } catch {
      // A damaged checkpoint is itself a gap. Later full snapshots can still
      // establish a new trustworthy segment.
    }
  }
  checkpoints.push({
    state: finalState,
    at: completedAt,
    label: "Replay gap — recovered final battlefield",
  });
  return checkpoints;
}

/**
 * Build a replay directly from canonical server engine history. Unparseable,
 * missing, or non-applicable command rows are skipped only until a later full
 * engine snapshot re-establishes state; subsequent exact command transitions
 * are then included normally.
 */
export function buildSegmentedReplayArchiveFromRows(
  genesis: MatchState,
  rows: readonly SegmentedReplayCommandRow[],
  snapshotRows: readonly SegmentedReplaySnapshotRow[],
  finalState: EngineBackedMatchState,
  completedAt: number,
  startedAt: number,
): ReplayArchive {
  const steps = rows.flatMap((row) => {
    const parsed = parseAcceptedCommand(row, finalState.id);
    return parsed ? [parsed] : [];
  });
  const timeline = buildSegmentedReplayTimeline(
    genesis,
    steps,
    startedAt,
    recoveryCheckpoints(snapshotRows, finalState, completedAt),
  );
  const recording = createReplayRecording(genesis);
  recording.commands = timeline.appliedSteps.map((step) => compactReplayCommand(step.envelope));
  const archive = archiveReplayRecording(recording, finalState, completedAt);
  archive.startedAt = startedAt;
  archive.playback = buildFrozenReplayPlayback(timeline.frames, timeline.markers);
  buildReplayFrames(archive);
  return archive;
}
