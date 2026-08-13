import type { ReplayFrame } from "./engine/replay-types";

/** Skip lobby-only setup when a viewer first opens a complete match replay. */
export function firstGameplayReplayFrameIndex(frames: readonly ReplayFrame[]) {
  const gameplay = frames.findIndex((candidate) => candidate.state.phase !== "lobby");
  return gameplay >= 0 ? gameplay : 0;
}
