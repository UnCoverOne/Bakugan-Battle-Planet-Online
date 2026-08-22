import type { MatchState } from "../../lib/game";

/** Only adjacent live snapshots may create transient animation or sound. */
export function isLiveMatchTransition(
  previous: MatchState | null | undefined,
  current: MatchState | null | undefined,
  visibilityState: DocumentVisibilityState = "visible",
) {
  return Boolean(
    previous
    && current
    && previous.id === current.id
    && current.version === previous.version + 1
    && visibilityState === "visible",
  );
}
