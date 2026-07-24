"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MatchState } from "../../lib/game";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { useMatchSelector } from "./matchStore";
import {
  describeTurnTransition,
  presentedTurnProgress,
  turnProgressSnapshot,
  type TurnProgressSnapshot,
  type TurnStepKey,
  type TurnTransition,
} from "./turnProgressState";
import styles from "./PhaseTransitionLayer.module.css";
import cueStyles from "./PhaseTransitionCues.module.css";

export const PHASE_TRANSITION_DURATION_MS = 4200;
const REDUCED_TRANSITION_DURATION_MS = 2600;

type TargetBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type TargetState = {
  primary: TargetBox | null;
  secondary: TargetBox | null;
};

type TransitionPlan = {
  hint: string;
  primarySelector: string;
  secondarySelector?: string;
};

const EMPTY_TARGETS: TargetState = { primary: null, secondary: null };

function reducedMotionRequested() {
  return document.documentElement.dataset.motion === "reduced"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function ownerForPlayer(
  match: MatchState | null,
  localPlayerId: string | undefined,
  playerId: string,
) {
  const resolvedLocalId = localPlayerId ?? match?.players[0]?.id;
  return playerId && playerId === resolvedLocalId ? "player" : "opponent";
}

function transitionPlan(
  step: TurnStepKey,
  match: MatchState | null,
  localPlayerId: string | undefined,
): TransitionPlan {
  switch (step) {
    case "draw":
      return {
        hint: "Draw the top card from your deck.",
        primarySelector: '[data-zone-kind="deck"][data-zone-owner="player"]',
        secondarySelector: '[data-zone-kind="hand"][data-zone-owner="player"]',
      };
    case "energize":
      return {
        hint: "Choose a card from your hand to Energize, or decline.",
        primarySelector: '[data-zone-kind="hand"][data-zone-owner="player"]',
        secondarySelector: '[data-zone-kind="energy"][data-zone-owner="player"]',
      };
    case "selection":
      return {
        hint: "Choose one closed Bakugan for this turn's roll.",
        primarySelector: '[data-zone-group="character-cards"][data-zone-owner="player"]',
      };
    case "rolling":
      return {
        hint: "Choose a BakuCore target, then confirm your roll.",
        primarySelector: '[aria-label="BakuCores in the Hide Matrix"]',
        secondarySelector: '[aria-label="Available player actions"]',
      };
    case "power":
      return {
        hint: "Compare B-Power, play cards, and pass priority when ready.",
        primarySelector: '[aria-label^="Active Brawl statistics"]',
        secondarySelector: '[aria-label="Available player actions"]',
      };
    case "victor": {
      const winnerOwner = ownerForPlayer(match, localPlayerId, match?.brawlWinner ?? "");
      return {
        hint: "Resolve Victor abilities before the Damage step begins.",
        primarySelector: `[aria-label^="Active Brawl statistics"] [data-owner="${winnerOwner}"]`,
        secondarySelector: '[data-zone-kind="batch"]',
      };
    }
    case "damage": {
      const loserOwner = ownerForPlayer(match, localPlayerId, match?.pendingLoser ?? "");
      return {
        hint: "Flip cards from the damaged player's deck one at a time.",
        primarySelector: `[data-zone-kind="deck"][data-zone-owner="${loserOwner}"]`,
        secondarySelector: `[data-zone-kind="discard-pile"][data-zone-owner="${loserOwner}"]`,
      };
    }
    case "retracting":
      return {
        hint: "Return the losing Bakugan and its BakuCores to their zones.",
        primarySelector: '[data-zone-group="character-cards"][data-zone-owner="player"]',
        secondarySelector: '[data-zone-group="character-cards"][data-zone-owner="opponent"]',
      };
    case "play":
      return {
        hint: "Use the final card-play window of the turn, or pass.",
        primarySelector: '[data-zone-kind="hand"][data-zone-owner="player"]',
        secondarySelector: '[aria-label="Available player actions"]',
      };
    case "charge":
      return {
        hint: "Spent Energy recharges for the next turn.",
        primarySelector: '[data-zone-kind="energy"][data-zone-owner="player"]',
        secondarySelector: '[data-zone-kind="energy"][data-zone-owner="opponent"]',
      };
    case "reset":
      return {
        hint: "Turn modifiers clear before the next Start Phase.",
        primarySelector: '[data-gameplay-surface="true"]',
      };
  }
  return {
    hint: "Continue to the next game action.",
    primarySelector: '[data-gameplay-surface="true"]',
  };
}

function targetBox(element: Element | null): TargetBox | null {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
  };
}

function boxesMatch(left: TargetBox | null, right: TargetBox | null) {
  if (!left || !right) return left === right;
  return Math.abs(left.left - right.left) < 0.5
    && Math.abs(left.top - right.top) < 0.5
    && Math.abs(left.width - right.width) < 0.5
    && Math.abs(left.height - right.height) < 0.5;
}

function targetStatesMatch(left: TargetState, right: TargetState) {
  return boxesMatch(left.primary, right.primary) && boxesMatch(left.secondary, right.secondary);
}

function beaconStyle(box: TargetBox) {
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  } as CSSProperties;
}

function connectorStyle(box: TargetBox) {
  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  const deltaX = box.centerX - viewportCenterX;
  const deltaY = box.centerY - viewportCenterY;
  return {
    left: "50%",
    top: "50%",
    width: Math.hypot(deltaX, deltaY),
    transform: `rotate(${Math.atan2(deltaY, deltaX)}rad)`,
  } as CSSProperties;
}

export function PhaseTransitionLayer({ match }: { match: MatchState | null }) {
  const { rollPresentationPending } = useBakuCorePresentation();
  const localPlayerId = useMatchSelector((state) => state.playerId);
  const previousProgress = useRef<TurnProgressSnapshot | null>(null);
  const [transition, setTransition] = useState<TurnTransition | null>(null);
  const [targets, setTargets] = useState<TargetState>(EMPTY_TARGETS);
  const focusedElements = useRef<{ primary: Element | null; secondary: Element | null }>({
    primary: null,
    secondary: null,
  });
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
  const plan = useMemo(
    () => transition ? transitionPlan(transition.stepKey, match, localPlayerId) : null,
    [transition, match, localPlayerId],
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

  useLayoutEffect(() => {
    if (!transition || !plan) {
      setTargets(EMPTY_TARGETS);
      return;
    }

    let frame = 0;
    const clearFocus = (kind: "primary" | "secondary") => {
      const element = focusedElements.current[kind];
      if (element?.getAttribute("data-transition-focus") === kind) {
        element.removeAttribute("data-transition-focus");
      }
      focusedElements.current[kind] = null;
    };
    const assignFocus = (kind: "primary" | "secondary", element: Element | null) => {
      if (focusedElements.current[kind] === element) return;
      clearFocus(kind);
      focusedElements.current[kind] = element;
      element?.setAttribute("data-transition-focus", kind);
    };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const primary = document.querySelector(plan.primarySelector);
        const secondary = plan.secondarySelector
          ? document.querySelector(plan.secondarySelector)
          : null;
        assignFocus("primary", primary);
        assignFocus("secondary", secondary);
        const next = {
          primary: targetBox(primary),
          secondary: targetBox(secondary),
        };
        setTargets((previous) => targetStatesMatch(previous, next) ? previous : next);
      });
    };

    measure();
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      clearFocus("primary");
      clearFocus("secondary");
    };
  }, [transition, plan]);

  if (!transition || !plan) return null;

  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const cueStyle = {
    "--cue-target-x": `${targets.primary?.centerX ?? viewportWidth / 2}px`,
    "--cue-target-y": `${targets.primary?.centerY ?? viewportHeight / 2}px`,
    "--cue-target-width": `${targets.primary?.width ?? 0}px`,
    "--cue-target-height": `${targets.primary?.height ?? 0}px`,
    "--cue-secondary-x": `${targets.secondary?.centerX ?? targets.primary?.centerX ?? viewportWidth / 2}px`,
    "--cue-secondary-y": `${targets.secondary?.centerY ?? targets.primary?.centerY ?? viewportHeight / 2}px`,
  } as CSSProperties;

  return (
    <div
      className={`${styles.layer} ${cueStyles.cueLayer}`}
      data-phase-transition
      data-scope={transition.scope}
      data-phase={transition.phaseKey}
      data-step={transition.stepKey}
      data-has-secondary={targets.secondary ? "true" : "false"}
      style={cueStyle}
      key={transition.signature}
    >
      {targets.primary ? (
        <>
          <span className={`${cueStyles.targetBeacon} ${cueStyles.primaryBeacon}`} style={beaconStyle(targets.primary)} aria-hidden="true" />
          <span className={`${cueStyles.connector} ${cueStyles.primaryConnector}`} style={connectorStyle(targets.primary)} aria-hidden="true" />
        </>
      ) : null}
      {targets.secondary ? (
        <>
          <span className={`${cueStyles.targetBeacon} ${cueStyles.secondaryBeacon}`} style={beaconStyle(targets.secondary)} aria-hidden="true" />
          <span className={`${cueStyles.connector} ${cueStyles.secondaryConnector}`} style={connectorStyle(targets.secondary)} aria-hidden="true" />
        </>
      ) : null}
      <div className={cueStyles.stepCue} aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            className={cueStyles.cuePiece}
            style={{ "--cue-piece": index } as CSSProperties}
            key={index}
          >
            <i>{transition.stepGlyph}</i>
          </span>
        ))}
      </div>
      <div className={styles.playmatFrame} aria-hidden="true">
        <span className={styles.rim} />
        <span className={styles.scan} />
        <div className={`${styles.callout} ${cueStyles.callout}`}>
          <span className={styles.glyph}>{transition.stepGlyph}</span>
          <span className={styles.copy}>
            <small>
              {transition.scope === "round" ? `Round ${transition.round} • ` : ""}
              {transition.phaseLabel} Phase
            </small>
            <strong>{transition.stepLabel} Step</strong>
            <em className={cueStyles.hint}>{plan.hint}</em>
          </span>
        </div>
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {transition.announcement} {plan.hint}
      </p>
    </div>
  );
}
