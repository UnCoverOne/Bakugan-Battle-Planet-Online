"use client";

import { useEffect, useState } from "react";
import type { MatchState } from "../../lib/game";
import { drawStepTimerState } from "../../lib/turnStart";
import {
  TURN_PHASES,
  TURN_STEPS,
  formatStepCountdown,
  remainingStepSeconds,
  resolveTurnProgress,
  turnStepsForPhase,
  type TurnProgressItem,
} from "./turnProgressState";
import styles from "./TurnProgressTracker.module.css";
import tooltipStyles from "./TurnProgressTooltip.module.css";

function ProgressRow<Key extends string>({
  label,
  items,
  activeKey,
  activeIndex,
}: {
  label: string;
  items: readonly TurnProgressItem<Key>[];
  activeKey: Key;
  activeIndex: number;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowTitle}>{label}</span>
      <ol className={styles.track}>
        {items.map((item, index) => {
          const active = item.key === activeKey;
          const completed = index < activeIndex;
          return (
            <li
              className={`${styles.item} ${tooltipStyles.tooltipItem} ${active ? styles.active : ""} ${completed ? styles.completed : ""}`}
              data-active={active ? "true" : "false"}
              data-completed={completed ? "true" : "false"}
              data-tooltip={item.label}
              aria-current={active ? "step" : undefined}
              aria-label={`${item.label}${active ? ", active" : completed ? ", completed" : ""}`}
              tabIndex={0}
              key={item.key}
            >
              <span className={styles.glyph} aria-hidden="true">{item.glyph}</span>
              <span className={styles.itemLabel}>{item.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepCountdown({ match }: { match: MatchState }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [match.deadline, match.phase, match.stepLabel]);

  const drawTimer = now == null ? null : drawStepTimerState(match, now);
  const seconds = now == null
    ? null
    : drawTimer?.seconds ?? remainingStepSeconds(match.deadline, now);
  const display = seconds == null ? "--:--" : formatStepCountdown(seconds);
  const expiring = seconds != null && seconds <= 10;
  const timerLabel = drawTimer?.label ?? "Step Timer";

  return (
    <time
      className={styles.timer}
      data-expiring={expiring ? "true" : "false"}
      dateTime={seconds == null ? undefined : `PT${seconds}S`}
      aria-label={seconds == null ? "Step timer loading" : `${seconds} seconds remaining for ${timerLabel}`}
    >
      <span>{timerLabel}</span>
      <strong>{display}</strong>
    </time>
  );
}

export function TurnProgressTracker({ match }: { match: MatchState | null }) {
  const progress = resolveTurnProgress(match);
  if (!progress || !match) return null;

  const activePhase = TURN_PHASES[progress.phaseIndex];
  const activeStep = TURN_STEPS[progress.stepIndex];
  const visibleSteps = turnStepsForPhase(progress.phaseKey);
  const visibleStepIndex = visibleSteps.findIndex((step) => step.key === progress.stepKey);
  const round = match.turn ?? 0;

  return (
    <aside
      className={styles.tracker}
      data-turn-progress-tracker
      aria-label={`Round ${round}: ${activePhase.label}, ${activeStep.label}`}
    >
      <span className={styles.roundLabel} aria-label={`Current round ${round}`}>
        <span>Round Count</span>
        <strong>{round}</strong>
      </span>

      <div className={styles.progressHud} aria-label="Turn progress">
        <ProgressRow
          label="Phase"
          items={TURN_PHASES}
          activeKey={progress.phaseKey}
          activeIndex={progress.phaseIndex}
        />
        <ProgressRow
          label="Step"
          items={visibleSteps}
          activeKey={progress.stepKey}
          activeIndex={Math.max(0, visibleStepIndex)}
        />
      </div>

      <StepCountdown match={match} />
    </aside>
  );
}
