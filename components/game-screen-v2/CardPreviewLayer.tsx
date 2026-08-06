"use client";

import { lazy, Suspense } from "react";
import type { MatchState } from "../../lib/game";

const DeferredCardPreviewLayer = lazy(() => (
  import("./CardPreviewLayerImpl").then(({ CardPreviewLayer }) => ({
    default: CardPreviewLayer,
  }))
));

/**
 * Card preview behavior is independent of the first interactive gameplay
 * frame. Keeping it behind a Suspense boundary preserves the same component
 * contract while allowing the browser to parse the core match UI first.
 */
export function CardPreviewLayer({ match }: { match?: MatchState | null }) {
  return (
    <Suspense fallback={null}>
      <DeferredCardPreviewLayer match={match} />
    </Suspense>
  );
}
