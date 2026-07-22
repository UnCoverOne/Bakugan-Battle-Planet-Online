"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchState } from "../../lib/game";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import {
  describeTurnTransition,
  presentedTurnProgress,
  turnProgressSnapshot,
  type TurnProgressSnapshot,
  type TurnTransition,
} from "./turnProgressState";
import styles from "./PhaseTransitionLayer.module.css";

export const PHASE_TRANSITION_DURATION_MS = 2100;
const REDUCED_TRANSITION_DURATION_MS = 1250;

function reducedMotionRequested() {
  return document.documentElement.dataset.motion === "reduced"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function PhaseTransitionLayer({ match }: { match: MatchState | null }) {
  const { rollPresentationPending } = useBakuCorePresentation();
  const previousProgress = useRef<TurnProgressSnapshot | null>(null);
  const [transition, setTransition] = useState<TurnTransition | null>(null);
  const matchPhase = match?.phase;
  const matchStepLabel = match?.stepLabel;
  const matchTurn = match?.turn;
  const liveProgress = useMemo(
    () => turnProgressSnapshot(
      matchPhase && matchStepLabel && matchTurn != null
        ? { phase: matchPhase, stepLabel: matchStepLabel, turn: matchTurn }
        : null,
    ),
    [matchPhase, matchStepLabel, matchTurn],
  );
  const progress = useMemo(
    () => presentedTurnProgress(
      liveProgress,
      previousProgress.current,
      rollPresentationPending,
    ),
    [liveProgress, rollPresentationPending],
  );

  useEffect(() => {
    if (!progress) {
      previousProgress.current = null;
      setTransition(null);
      return;
    }

    const next = describeTurnTransition(previousProgress.current, progress);
    previousProgress.current = progress;
    if (!next) return;

    setTransition(next);
    const duration = reducedMotionRequested()
      ? REDUCED_TRANSITION_DURATION_MS
      : PHASE_TRANSITION_DURATION_MS;
    const timeout = window.setTimeout(() => {
      setTransition((current) => current?.signature === next.signature ? null : current);
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [progress]);

  useEffect(() => {
    if (!transition) return;
    const root = document.documentElement;
    root.dataset.turnTransition = transition.scope;
    root.dataset.turnTransitionPhase = transition.phaseKey;
    root.dataset.turnTransitionStep = transition.stepKey;
    return () => {
      delete root.dataset.turnTransition;
      delete root.dataset.turnTransitionPhase;
      delete root.dataset.turnTransitionStep;
    };
  }, [transition]);

  if (!transition) return null;

  return (
    <div
      className={styles.layer}
      data-phase-transition
      data-scope={transition.scope}
      data-phase={transition.phaseKey}
      data-step={transition.stepKey}
      key={transition.signature}
    >
      <div className={styles.playmatFrame} aria-hidden="true">
        <span className={styles.rim} />
        <span className={styles.scan} />
        <div className={styles.callout}>
          <span className={styles.glyph}>{transition.stepGlyph}</span>
          <span className={styles.copy}>
            <small>
              {transition.scope === "round" ? `Round ${transition.round} • ` : ""}
              {transition.phaseLabel} Phase
            </small>
            <strong>{transition.stepLabel} Step</strong>
          </span>
        </div>
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {transition.announcement}
      </p>
    </div>
  );
}
