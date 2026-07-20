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

const DEFAULT_PROGRESS_BY_ENGINE_PHASE: Record<Phase, Pick<TurnProgressState, "phaseKey" | "stepKey">> = {
  lobby: { phaseKey: "start", stepKey: "draw" },
  startingPlayer: { phaseKey: "start", stepKey: "draw" },
  placement: { phaseKey: "start", stepKey: "draw" },
  draw: { phaseKey: "start", stepKey: "draw" },
  energize: { phaseKey: "start", stepKey: "energize" },
  selection: { phaseKey: "roll", stepKey: "selection" },
  preRoll: { phaseKey: "roll", stepKey: "selection" },
  target: { phaseKey: "roll", stepKey: "rolling" },
  power: { phaseKey: "brawl", stepKey: "power" },
  victor: { phaseKey: "brawl", stepKey: "victor" },
  damage: { phaseKey: "brawl", stepKey: "damage" },
  postDamage: { phaseKey: "brawl", stepKey: "retracting" },
  retract: { phaseKey: "brawl", stepKey: "retracting" },
  endPlay: { phaseKey: "end", stepKey: "play" },
  handLimit: { phaseKey: "end", stepKey: "reset" },
  result: { phaseKey: "end", stepKey: "reset" },
};

function stepFromLabel(label: string): TurnStepKey | null {
  const normalized = label.toLowerCase();
  if (/draw step/.test(normalized)) return "draw";
  if (/energize/.test(normalized)) return "energize";
  if (/selection/.test(normalized) && !/target/.test(normalized)) return "selection";
  if (/rolling|secret target|roll step/.test(normalized)) return "rolling";
  if (/power step/.test(normalized)) return "power";
  if (/victor step/.test(normalized)) return "victor";
  if (/damage/.test(normalized) && !/post-damage/.test(normalized)) return "damage";
  if (/retract|post-damage/.test(normalized)) return "retracting";
  if (/play step/.test(normalized)) return "play";
  if (/charge step/.test(normalized)) return "charge";
  if (/reset|discard to seven/.test(normalized)) return "reset";
  return null;
}

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

  const fallback = DEFAULT_PROGRESS_BY_ENGINE_PHASE[match.phase];
  const stepKey = stepFromLabel(match.stepLabel) ?? fallback.stepKey;
  const step = TURN_STEPS.find((candidate) => candidate.key === stepKey);
  const phaseKey = step?.phase ?? fallback.phaseKey;

  return {
    phaseKey,
    stepKey,
    phaseIndex: TURN_PHASES.findIndex((candidate) => candidate.key === phaseKey),
    stepIndex: TURN_STEPS.findIndex((candidate) => candidate.key === stepKey),
  };
}
