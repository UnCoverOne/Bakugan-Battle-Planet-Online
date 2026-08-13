import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  createReplayRecording,
} from "./engine/replay-codec";
import { buildReplayFrames } from "./engine/replay-playback";
import type { ReplayArchive, ReplayRecording } from "./engine/replay-types";

/**
 * Produce an archive that is known to reconstruct before it is persisted.
 *
 * A command journal can be absent after a Worker/storage interruption or can
 * be incomplete after a page lifecycle transition. In that case the completed
 * state is still a valid deterministic genesis and provides a displayable
 * final-board replay instead of degrading the record to an event log.
 */
export function buildDisplayableReplayArchive(
  recording: ReplayRecording | null | undefined,
  state: MatchState,
  completedAt = Date.now(),
): ReplayArchive {
  if (recording) {
    const candidate = archiveReplayRecording(recording, state, completedAt);
    try {
      buildReplayFrames(candidate);
      return candidate;
    } catch {
      // Recover below from the authoritative completed state.
    }
  }

  const recovered = archiveReplayRecording(createReplayRecording(state), state, completedAt);
  // Keep this assertion beside persistence so an archive is never marked
  // playable unless the same reconstruction path used by the theatre accepts it.
  buildReplayFrames(recovered);
  return recovered;
}
