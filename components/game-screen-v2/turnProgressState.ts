import type { MatchState, Phase } from "../../lib/game";

export type TurnPhaseKey = "start" | "roll" | "brawl" | "end";
export type TurnStepKey =
  | "draw"
  | "energize"
  | "selection"
  | "rolling"
  | "power"
  | "victor"
  | "damage"
  | "retracting"
  | "play"
  | "charge"
  | "reset";

export type TurnProgressItem<Key extends string> = {
  key: Key;
  label: string;
  phase: TurnPhaseKey;
  glyph: string;
};

export const TURN_PHASES: readonly TurnProgressItem<TurnPhaseKey>[] = [
  { key: "start", label: "Start", phase: "start", glyph: "✦" },
  { key: "roll", label: "Roll", phase: "roll", glyph: "⬡" },
  { key: "brawl", label: "Brawl", phase: "brawl", glyph: "✕" },
  { key: "end", label: "End", phase: "end", glyph: "◌" },
];

export const TURN_STEPS: readonly TurnProgressItem<TurnStepKey>[] = [
  { key: "draw", label: "Draw", phase: "start", glyph: "▤" },
  { key: "energize", label: "Energize", phase: "start", glyph: "ϟ" },
  { key: "selection", label: "Selection", phase: "roll", glyph: "◎" },
  { key: "rolling", label: "Rolling", phase: "roll", glyph: "↻" },
  { key: "power", label: "Power", phase: "brawl", glyph: "B" },
  { key: "victor", label: "Victor", phase: "brawl", glyph: "♛" },
  { key: "damage", label: "Damage", phase: "brawl", glyph: "✹" },
  { key: "retracting", label: "Retracting", phase: "brawl", glyph: "↙" },
  { key: "play", label: "Play", phase: "end", glyph: "▶" },
  { key: "charge", label: "Charge", phase: "end", glyph: "↯" },
  { key: "reset", label: "Reset", phase: "end", glyph: "⟳" },
];

export function turnStepsForPhase(
  phaseKey: TurnPhaseKey,
): readonly TurnProgressItem<TurnStepKey>[] {
  return TURN_STEPS.filter((step) => step.phase === phaseKey);
}

export type TurnProgressState = {
  phaseKey: TurnPhaseKey;
  stepKey: TurnStepKey;
  phaseIndex: number;
  stepIndex: number;
};

export type TurnProgressSnapshot = TurnProgressState & {
  round: number;
  signature: string;
  phaseLabel: string;
  phaseGlyph: string;
  stepLabel: string;
  stepGlyph: string;
};

export type TurnTransitionScope = "round" | "phase" | "step";

export type TurnTransition = TurnProgressSnapshot & {
  scope: TurnTransitionScope;
  announcement: string;
};

/**
 * The engine phase is the authoritative source for phase/step progress.
 * `stepLabel` is mutable status copy: card resolution, private targeting, and
 * waiting messages can contain words such as "selection" or "damage" without
 * changing the rules step. Inferring progress from that copy caused the Roll
 * Phase to bounce back to Selection while BakuCore targets were being chosen.
 */
const PROGRESS_BY_ENGINE_PHASE: Record<Phase, Pick<TurnProgressState, "phaseKey" | "stepKey">> = {
  lobby: { phaseKey: "start", stepKey: "draw" },
  startingPlayer: { phaseKey: "start", stepKey: "draw" },
  placement: { phaseKey: "start", stepKey: "draw" },
  draw: { phaseKey: "start", stepKey: "draw" },
  energize: { phaseKey: "start", stepKey: "energize" },
  selection: { phaseKey: "roll", stepKey: "selection" },
  // Selecting a Bakugan and the following card-play priority window are both
  // part of the Selection Step. Rolling begins only after that window closes.
  preRoll: { phaseKey: "roll", stepKey: "selection" },
  target: { phaseKey: "roll", stepKey: "rolling" },
  reroll: { phaseKey: "roll", stepKey: "rolling" },
  power: { phaseKey: "brawl", stepKey: "power" },
  victor: { phaseKey: "brawl", stepKey: "victor" },
  damage: { phaseKey: "brawl", stepKey: "damage" },
  postDamage: { phaseKey: "brawl", stepKey: "retracting" },
  retract: { phaseKey: "brawl", stepKey: "retracting" },
  endPlay: { phaseKey: "end", stepKey: "play" },
  handLimit: { phaseKey: "end", stepKey: "reset" },
  result: { phaseKey: "end", stepKey: "reset" },
};

export function remainingStepSeconds(deadline: number, now: number): number {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatStepCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function resolveTurnProgress(
  match: Pick<MatchState, "phase" | "stepLabel" | "turn"> | null | undefined,
): TurnProgressState | null {
  if (!match || match.turn <= 0 || match.phase === "lobby" || match.phase === "placement") return null;

  const progress = PROGRESS_BY_ENGINE_PHASE[match.phase];
  return {
    ...progress,
    phaseIndex: TURN_PHASES.findIndex((candidate) => candidate.key === progress.phaseKey),
    stepIndex: TURN_STEPS.findIndex((candidate) => candidate.key === progress.stepKey),
  };
}

function snapshotFor(
  round: number,
  phaseKey: TurnPhaseKey,
  stepKey: TurnStepKey,
): TurnProgressSnapshot {
  const phaseIndex = TURN_PHASES.findIndex((candidate) => candidate.key === phaseKey);
  const stepIndex = TURN_STEPS.findIndex((candidate) => candidate.key === stepKey);
  const phase = TURN_PHASES[phaseIndex];
  const step = TURN_STEPS[stepIndex];
  return {
    round,
    phaseKey,
    stepKey,
    phaseIndex,
    stepIndex,
    signature: `${round}:${phaseKey}:${stepKey}`,
    phaseLabel: phase.label,
    phaseGlyph: phase.glyph,
    stepLabel: step.label,
    stepGlyph: step.glyph,
  };
}

export function turnProgressSnapshot(
  match: Pick<MatchState, "phase" | "stepLabel" | "turn"> | null | undefined,
): TurnProgressSnapshot | null {
  const progress = resolveTurnProgress(match);
  if (!progress || !match) return null;
  return snapshotFor(match.turn, progress.phaseKey, progress.stepKey);
}

/**
 * The authoritative state enters Power as soon as rolls resolve, while the
 * client still has the roll trace, result, and Core transfer to present. Always
 * pin that pending presentation to Rolling; carrying an arbitrary previous Roll
 * snapshot could preserve Selection if the target update was batched or skipped.
 */
export function presentedTurnProgress(
  live: TurnProgressSnapshot | null,
  _previous: TurnProgressSnapshot | null,
  rollPresentationPending: boolean,
): TurnProgressSnapshot | null {
  if (!live) return null;
  if (!rollPresentationPending || live.phaseKey !== "brawl") return live;
  return snapshotFor(live.round, "roll", "rolling");
}

export function phaseTransitionIsBlocked(
  rollPresentationPending: boolean,
  brawlPreviewVisible: boolean,
) {
  return rollPresentationPending || brawlPreviewVisible;
}

export function describeTurnTransition(
  previous: TurnProgressSnapshot | null,
  current: TurnProgressSnapshot | null,
): TurnTransition | null {
  if (!current || previous?.signature === current.signature) return null;
  const scope: TurnTransitionScope = !previous || previous.round !== current.round
    ? "round"
    : previous.phaseKey !== current.phaseKey
      ? "phase"
      : "step";
  return {
    ...current,
    scope,
    announcement: `Round ${current.round}. ${current.phaseLabel} Phase, ${current.stepLabel} Step began.`,
  };
}
