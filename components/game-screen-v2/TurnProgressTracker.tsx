import type { MatchState } from "../../lib/game";
import {
  TURN_PHASES,
  TURN_STEPS,
  resolveTurnProgress,
  turnStepsForPhase,
  type TurnProgressItem,
} from "./turnProgressState";
import styles from "./TurnProgressTracker.module.css";

function ProgressRow<Key extends string>({
  label,
  items,
  activeKey,
  activeIndex,
  kind,
}: {
  label: string;
  items: readonly TurnProgressItem<Key>[];
  activeKey: Key;
  activeIndex: number;
  kind: "phase" | "step";
}) {
  return (
    <div className={`${styles.row} ${kind === "phase" ? styles.phaseRow : styles.stepRow}`}>
      <span className={styles.rowTitle}>{label}</span>
      <ol className={styles.track}>
        {items.map((item, index) => {
          const active = item.key === activeKey;
          const completed = index < activeIndex;
          return (
            <li
              className={`${styles.item} ${active ? styles.active : ""} ${completed ? styles.completed : ""}`}
              data-active={active ? "true" : "false"}
              data-completed={completed ? "true" : "false"}
              aria-current={active ? "step" : undefined}
              aria-label={`${item.label}${active ? ", active" : completed ? ", completed" : ""}`}
              title={item.label}
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

export function TurnProgressTracker({ match }: { match: MatchState | null }) {
  const progress = resolveTurnProgress(match);
  if (!progress) return null;

  const activePhase = TURN_PHASES[progress.phaseIndex];
  const activeStep = TURN_STEPS[progress.stepIndex];
  const visibleSteps = turnStepsForPhase(progress.phaseKey);
  const visibleStepIndex = visibleSteps.findIndex((step) => step.key === progress.stepKey);

  return (
    <aside
      className={styles.tracker}
      data-turn-progress-tracker
      aria-label={`Turn ${match?.turn ?? 0}: ${activePhase.label}, ${activeStep.label}`}
    >
      <ProgressRow
        label="Phase"
        items={TURN_PHASES}
        activeKey={progress.phaseKey}
        activeIndex={progress.phaseIndex}
        kind="phase"
      />
      <ProgressRow
        label="Step"
        items={visibleSteps}
        activeKey={progress.stepKey}
        activeIndex={Math.max(0, visibleStepIndex)}
        kind="step"
      />
    </aside>
  );
}
