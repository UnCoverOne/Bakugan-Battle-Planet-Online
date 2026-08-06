"use client";

import { lazy, Suspense } from "react";
import type { MatchState } from "../../lib/game";

type TieBreakAction = () => void | Promise<void>;
type TieBreakLayerProps = {
  match: MatchState | null;
  playerId?: string;
  onFlipTieBreakCard: TieBreakAction;
  onFinishTieBreak?: TieBreakAction;
};

const DeferredTieBreakLayer = lazy(() => (
  import("./TieBreakLayerImpl").then(({ TieBreakLayer }) => ({
    default: TieBreakLayer,
  }))
));

const PRELOAD_PHASES = new Set<MatchState["phase"]>([
  "preRoll",
  "target",
  "reroll",
  "power",
]);

/**
 * The tie-break UI is not needed during match startup. Begin loading it during
 * the rolling sequence so it is normally ready before a Power Step can tie.
 */
export function TieBreakLayer(props: TieBreakLayerProps) {
  if (!props.match || !PRELOAD_PHASES.has(props.match.phase)) return null;
  return (
    <Suspense fallback={null}>
      <DeferredTieBreakLayer {...props} />
    </Suspense>
  );
}
