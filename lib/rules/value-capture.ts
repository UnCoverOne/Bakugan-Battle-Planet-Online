import type { MatchState } from "../game";
import type {
  CardPlayDefinition,
  ChoiceSpec,
  ContinuousModifier,
  CostEffect,
  RuleAction,
  RuleCondition,
  RuleInstruction,
  TriggerDefinition,
} from "./model";
import {
  captureNumberValue,
  type BooleanValue,
  type EvaluationMoment,
  type NumberValue,
  type ValueEvaluationContext,
} from "./values";

export type ValueSnapshotContext = Omit<ValueEvaluationContext, "moment" | "capturedValues">;

function captureNumber(
  state: MatchState,
  value: NumberValue | undefined,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  if (value == null) return;
  captureNumberValue(state, value, { ...context, moment, capturedValues: snapshots }, snapshots);
}

function captureBoolean(
  state: MatchState,
  value: BooleanValue | undefined,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
): void {
  if (value == null || typeof value === "boolean") return;
  switch (value.kind) {
    case "compare-number":
      captureNumber(state, value.left, moment, context, snapshots);
      captureNumber(state, value.right, moment, context, snapshots);
      return;
    case "and":
    case "or":
      value.conditions.forEach((condition) => captureBoolean(state, condition, moment, context, snapshots));
      return;
    case "not":
      captureBoolean(state, value.condition, moment, context, snapshots);
      return;
    default:
      return;
  }
}

export function captureRuleConditionValues(
  state: MatchState,
  condition: RuleCondition | undefined,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  if (!condition) return snapshots;
  switch (condition.kind) {
    case "cards-played":
    case "factions-played":
    case "hero-count":
    case "energy-count":
    case "discard-count":
    case "played-card-cost":
    case "card-count":
    case "open-bakugan-count":
      captureNumber(state, condition.amount, moment, context, snapshots);
      break;
    case "core-count":
      captureNumber(state, condition.amount, moment, context, snapshots);
      break;
    case "expression":
      captureBoolean(state, condition.expression, moment, context, snapshots);
      break;
    default:
      break;
  }
  return snapshots;
}

function captureChoiceSpecValues(
  state: MatchState,
  choice: ChoiceSpec,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  captureNumber(state, choice.minimum, moment, context, snapshots);
  captureNumber(state, choice.maximum, moment, context, snapshots);
  captureNumber(state, choice.minimumCost, moment, context, snapshots);
  captureNumber(state, choice.maximumCost, moment, context, snapshots);
}

function captureTriggerValues(
  state: MatchState,
  trigger: TriggerDefinition | undefined,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  if (!trigger) return;
  captureNumber(state, trigger.minimumEventAmount, moment, context, snapshots);
  captureRuleConditionValues(state, trigger.interveningCondition, moment, context, snapshots);
}

function captureCostEffectValues(
  state: MatchState,
  effect: CostEffect,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  if (effect.kind === "cost-reduce" || effect.kind === "cost-increase" || effect.kind === "cost-discard") {
    captureNumber(state, effect.amount, moment, context, snapshots);
  }
  if ("condition" in effect) captureRuleConditionValues(state, effect.condition, moment, context, snapshots);
  if (effect.kind === "cost-alternative") {
    effect.components.forEach((component) => captureCostEffectValues(state, component, moment, context, snapshots));
  }
}

function captureModifierValues(
  state: MatchState,
  modifier: ContinuousModifier,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
) {
  captureNumber(state, modifier.amount, moment, context, snapshots);
  captureRuleConditionValues(state, modifier.condition, moment, context, snapshots);
}

export function captureRuleActionValues(
  state: MatchState,
  action: RuleAction,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number>,
): Record<string, number> {
  switch (action.kind) {
    case "modify-stat":
    case "draw":
    case "energize":
    case "generate-energy":
    case "move":
    case "reveal":
    case "reorder-deck":
    case "attack":
    case "search":
    case "cost":
      captureNumber(state, action.amount, moment, context, snapshots);
      break;
    case "grant-keyword":
      captureNumber(state, action.value, moment, context, snapshots);
      break;
    case "discard":
      captureNumber(state, action.amount, moment, context, snapshots);
      captureNumber(state, action.minimum, moment, context, snapshots);
      captureNumber(state, action.maximum, moment, context, snapshots);
      break;
    case "recharge-energy":
      if (action.amount !== "all") captureNumber(state, action.amount, moment, context, snapshots);
      break;
    case "set-stat":
      captureNumber(state, action.value, moment, context, snapshots);
      break;
    case "play":
    case "negate":
      captureNumber(state, action.maximumCost, moment, context, snapshots);
      break;
    case "copy":
      captureNumber(state, action.count, moment, context, snapshots);
      break;
    case "prevention":
      captureNumber(state, action.amount, moment, context, snapshots);
      captureRuleConditionValues(state, action.condition, moment, context, snapshots);
      break;
    case "continuous":
      captureModifierValues(state, action.modifier, moment, context, snapshots);
      break;
    case "trigger":
      captureTriggerValues(state, action.definition, moment, context, snapshots);
      break;
    case "conditional":
      captureRuleConditionValues(state, action.condition, moment, context, snapshots);
      action.whenTrue.forEach((nested) => captureRuleActionValues(state, nested, moment, context, snapshots));
      action.whenFalse?.forEach((nested) => captureRuleActionValues(state, nested, moment, context, snapshots));
      break;
    case "replacement":
      captureRuleConditionValues(state, action.condition, moment, context, snapshots);
      action.replaceWith.forEach((nested) => captureRuleActionValues(state, nested, moment, context, snapshots));
      break;
    case "sequence":
      action.effects.forEach((nested) => captureRuleActionValues(state, nested, moment, context, snapshots));
      break;
    default:
      break;
  }
  return snapshots;
}

export function captureInstructionValues(
  state: MatchState,
  instruction: RuleInstruction,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number> = {},
) {
  captureRuleConditionValues(state, instruction.condition, moment, context, snapshots);
  instruction.choices.forEach((choice) => captureChoiceSpecValues(state, choice, moment, context, snapshots));
  instruction.actions.forEach((action) => captureRuleActionValues(state, action, moment, context, snapshots));
  return snapshots;
}

export function captureCardPlayValues(
  state: MatchState,
  play: CardPlayDefinition,
  moment: EvaluationMoment,
  context: ValueSnapshotContext,
  snapshots: Record<string, number> = {},
) {
  play.choices.forEach((choice) => captureChoiceSpecValues(state, choice, moment, context, snapshots));
  play.costModifiers.forEach((effect) => captureCostEffectValues(state, effect, moment, context, snapshots));
  return snapshots;
}
