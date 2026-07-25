import type { MatchState } from "../game";
import type { EngineBackedMatchState, EngineFault } from "./types";

export const MAX_TRIGGER_CHAIN_DEPTH = 100;
export const MAX_EFFECT_STEPS_PER_COMMAND = 1_000;
export const MAX_REPLACEMENT_ITERATIONS = 50;
export const MAX_PENDING_CHOICES = 20;
export const MAX_PHYSICAL_ROLL_ATTEMPTS = 64;

export type RuntimeBudgetMetric = "triggerChainDepth" | "effectSteps" | "replacementIterations" | "pendingChoices" | "physicalRollAttempts";
export type RuntimeBudget = Record<RuntimeBudgetMetric, number>;

let activeBudget: RuntimeBudget | undefined;

export class EngineRuntimeLimitError extends Error {
  readonly code = "ENGINE_RUNTIME_LIMIT";
  constructor(
    public readonly metric: RuntimeBudgetMetric,
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(`Engine runtime limit exceeded: ${metric} ${actual}/${limit}.`);
    this.name = "EngineRuntimeLimitError";
  }
}

const limits: Record<RuntimeBudgetMetric, number> = {
  triggerChainDepth: MAX_TRIGGER_CHAIN_DEPTH,
  effectSteps: MAX_EFFECT_STEPS_PER_COMMAND,
  replacementIterations: MAX_REPLACEMENT_ITERATIONS,
  pendingChoices: MAX_PENDING_CHOICES,
  physicalRollAttempts: MAX_PHYSICAL_ROLL_ATTEMPTS,
};

function consume(metric: RuntimeBudgetMetric, amount = 1) {
  if (!activeBudget) return;
  activeBudget[metric] += amount;
  if (activeBudget[metric] > limits[metric]) throw new EngineRuntimeLimitError(metric, limits[metric], activeBudget[metric]);
}

export const consumeEffectStep = (amount = 1) => consume("effectSteps", amount);
export const consumeTriggerCreation = (amount = 1) => consume("triggerChainDepth", amount);
export const consumeReplacementIteration = (amount = 1) => consume("replacementIterations", amount);
export const consumePendingChoice = (amount = 1) => consume("pendingChoices", amount);
export const consumePhysicalRollAttempt = (amount = 1) => consume("physicalRollAttempts", amount);

export function withEngineRuntimeBudget<T>(run: () => T): { value: T; budget: RuntimeBudget } {
  const previous = activeBudget;
  const budget: RuntimeBudget = { triggerChainDepth: 0, effectSteps: 0, replacementIterations: 0, pendingChoices: 0, physicalRollAttempts: 0 };
  activeBudget = budget;
  try {
    return { value: run(), budget };
  } finally {
    activeBudget = previous;
  }
}

export function assertStateWithinRuntimeLimits(state: MatchState) {
  const triggerDepth = state.batch.filter((object) => object.kind === "trigger").length;
  if (triggerDepth > MAX_TRIGGER_CHAIN_DEPTH) throw new EngineRuntimeLimitError("triggerChainDepth", MAX_TRIGGER_CHAIN_DEPTH, triggerDepth);
  const pendingChoices = Number(Boolean(state.pendingChoice)) + state.triggerOrders.filter((request) => !request.orderedIds).length;
  if (pendingChoices > MAX_PENDING_CHOICES) throw new EngineRuntimeLimitError("pendingChoices", MAX_PENDING_CHOICES, pendingChoices);
}

export function engineFaultFromLimit(error: EngineRuntimeLimitError, state: EngineBackedMatchState, commandId: string, createdAt: number): EngineFault {
  return {
    code: error.code,
    message: error.message,
    metric: error.metric,
    limit: error.limit,
    actual: error.actual,
    commandId,
    phase: state.phase,
    createdAt,
    suspended: true,
  };
}
