import type { MatchState } from "./game";
import { archiveReplayRecording, createReplayRecording, replayStateHash } from "./engine/replay-codec";
import { buildFrozenReplayPlayback, buildReplayFrames } from "./engine/replay-playback";
import type { ReplayArchive, ReplayFrame, ReplayMarker } from "./engine/replay-types";
import type { EngineBackedMatchState } from "./engine/types";

export type ReplaySnapshotRecoveryRow = {
  version: number;
  state_json: string;
  created_at: number;
};

function snapshotLabel(state: MatchState, index: number) {
  if (index === 0) return "Gameplay begins";
  if (state.phase === "result") return "Match result";
  return state.stepLabel?.trim() || `Recovered checkpoint v${state.version}`;
}

function snapshotMarkerType(before: MatchState, after: MatchState): ReplayMarker["type"] {
  if (after.phase === "result") return "result";
  if (after.gameNumber !== before.gameNumber) return "game";
  if (after.phase !== before.phase) return "phase";
  return "command";
}

function parseSnapshotRows(
  rows: readonly ReplaySnapshotRecoveryRow[],
  finalState: EngineBackedMatchState,
) {
  const parsed: Array<{ state: MatchState; at: number }> = [];
  const versions = new Set<number>();
  for (const row of [...rows].sort((left, right) => left.version - right.version || left.created_at - right.created_at)) {
    if (versions.has(row.version)) continue;
    try {
      const state = JSON.parse(row.state_json) as MatchState;
      if (state.id !== finalState.id || state.code !== finalState.code || state.phase === "lobby") continue;
      if (state.version !== row.version) continue;
      versions.add(row.version);
      parsed.push({ state, at: row.created_at });
    } catch {
      // A damaged checkpoint should not prevent later checkpoints from recovering
      // the rest of the retained battlefield history.
    }
  }
  return parsed;
}

/**
 * Recover a coarse but genuine historical replay from the periodic full match
 * snapshots kept by the online event store. This is intentionally a fallback:
 * command/transition journals remain the preferred source because they provide
 * every accepted action, while snapshots preserve useful history when legacy or
 * damaged journals can no longer be deterministically reconstructed.
 */
export function buildReplayArchiveFromSnapshotRows(
  rows: readonly ReplaySnapshotRecoveryRow[],
  finalState: EngineBackedMatchState,
  completedAt = Date.now(),
): ReplayArchive | null {
  const snapshots = parseSnapshotRows(rows, finalState);
  if (!snapshots.length) return null;

  const finalHash = replayStateHash(finalState);
  const latest = snapshots.at(-1)!;
  if (latest.state.version !== finalState.version || replayStateHash(latest.state) !== finalHash) {
    snapshots.push({ state: structuredClone(finalState), at: completedAt });
  }
  if (snapshots.length < 2) return null;

  const frames: ReplayFrame[] = snapshots.map(({ state, at }, index) => ({
    index,
    at,
    commandType: index === 0 ? "CREATE_MATCH" : "NEXT_TURN",
    label: snapshotLabel(state, index),
    state,
  }));
  const markers: ReplayMarker[] = [{
    index: 0,
    at: frames[0].at,
    type: "start",
    label: frames[0].label,
  }];
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    markers.push({
      index,
      at: frame.at,
      type: snapshotMarkerType(frames[index - 1].state, frame.state),
      label: frame.label,
    });
  }

  const recording = createReplayRecording(frames[0].state);
  const archive = archiveReplayRecording(recording, finalState, completedAt);
  archive.startedAt = frames[0].at;
  archive.playback = buildFrozenReplayPlayback(frames, markers);
  // Validate the exact frozen-delta path used by Replay Theatre before storing it.
  buildReplayFrames(archive);
  return archive;
}

export async function buildReplayArchiveFromSnapshotHistory(
  database: D1Database,
  finalState: EngineBackedMatchState,
  completedAt = Date.now(),
) {
  const response = await database.prepare(`SELECT version, state_json, created_at
    FROM match_snapshots
    WHERE code = ? AND json_extract(state_json, '$.phase') <> 'lobby'
    ORDER BY version ASC, created_at ASC`)
    .bind(finalState.code)
    .all<ReplaySnapshotRecoveryRow>();
  return buildReplayArchiveFromSnapshotRows(response.results ?? [], finalState, completedAt);
}
