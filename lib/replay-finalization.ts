import { cloneMatch, type MatchState } from "./game";
import {
  archiveReplayRecording,
  createReplayRecording,
} from "./engine/replay-codec";
import {
  buildFrozenReplayPlayback,
  buildReplayFrames,
} from "./engine/replay-playback";
import type { ReplayArchive, ReplayFrame, ReplayMarker, ReplayRecording } from "./engine/replay-types";

/**
 * Produce an archive that is known to reconstruct before it is persisted.
 *
 * Deterministic command journals remain useful for compact authoring and
 * diagnostics, but they are not an archival format by themselves: re-running
 * them later depends on the exact reducer and catalogue that originally
 * produced the match. Successful reconstruction is therefore frozen into
 * self-contained board-state deltas while that runtime is still authoritative.
 *
 * If a command journal is absent or cannot reconstruct, the completed
 * authoritative state is frozen directly. That guarantees at least a final
 * battlefield view instead of degrading the record to an event log.
 */
export function buildDisplayableReplayArchive(
  recording: ReplayRecording | null | undefined,
  state: MatchState,
  completedAt = Date.now(),
): ReplayArchive {
  if (recording) {
    const candidate = archiveReplayRecording(recording, state, completedAt);
    try {
      const reconstructed = buildReplayFrames(candidate);
      candidate.playback = buildFrozenReplayPlayback(reconstructed.frames, reconstructed.markers);
      // Exercise the same frozen path that future viewers will use before the
      // archive is allowed to reach persistence.
      buildReplayFrames(candidate);
      return candidate;
    } catch {
      // Recover below from the authoritative completed state.
    }
  }

  const recovered = archiveReplayRecording(createReplayRecording(state), state, completedAt);
  const at = recovered.startedAt;
  const label = state.phase === "result" ? "Recovered final battlefield" : "Recovered match state";
  const frame: ReplayFrame = {
    index: 0,
    at,
    commandType: "CREATE_MATCH",
    label,
    state: cloneMatch(state),
  };
  const markers: ReplayMarker[] = [
    { index: 0, at, type: "start", label },
    ...(state.phase === "result"
      ? [{ index: 0, at, type: "result" as const, label }]
      : []),
  ];
  recovered.playback = buildFrozenReplayPlayback([frame], markers);
  buildReplayFrames(recovered);
  return recovered;
}
