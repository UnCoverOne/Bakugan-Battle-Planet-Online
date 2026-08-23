import { consumeEffectStep } from "../engine/limits";
import { UnsupportedCardTextError } from "./catalogue";
import type { RuleAction, RuleInstruction, RuleProgram } from "./effects";

export type RuleExecutionCursor = {
  instructionIndex: number;
  /** Structural action position used by the typed executor. */
  actionIndex: number;
  /** Monotonic leaf-effect position used by the game kernel and result binding. */
  effectIndex: number;
};

export type RuleExecutionContext = {
  conditionIsActive(instruction: RuleInstruction, instructionIndex: number): boolean;
  beforeInstruction(instruction: RuleInstruction, instructionIndex: number): "continue" | "suspend" | "skip";
  execute(action: RuleAction, instruction: RuleInstruction, cursor: RuleExecutionCursor): void;
  afterInstruction?(instruction: RuleInstruction, instructionIndex: number): "continue" | "suspend";
};

function nestedInstruction(parent: RuleInstruction, condition: RuleInstruction["condition"], effects: RuleAction[]): RuleInstruction {
  return {
    ...parent,
    id: `${parent.id}:branch`,
    condition,
    effects: effects.filter((effect): effect is RuleInstruction["effects"][number] => effect.kind !== "choice"),
    actions: effects,
    choices: [],
  };
}

function nestedCursor(cursor: RuleExecutionCursor, index: number): RuleExecutionCursor {
  return { ...cursor, actionIndex: cursor.actionIndex * 100 + index };
}

function executeAction(
  action: RuleAction,
  instruction: RuleInstruction,
  cursor: RuleExecutionCursor,
  context: RuleExecutionContext,
  nextEffectIndex: () => number,
) {
  consumeEffectStep();
  if (action.kind === "conditional") {
    const branchInstruction = nestedInstruction(instruction, action.condition, action.whenTrue);
    const selected = context.conditionIsActive(branchInstruction, cursor.instructionIndex) ? action.whenTrue : (action.whenFalse ?? []);
    for (let index = 0; index < selected.length; index += 1) {
      executeAction(selected[index], instruction, nestedCursor(cursor, index), context, nextEffectIndex);
    }
    return;
  }
  if (action.kind === "replacement") {
    if (!action.condition || context.conditionIsActive(
      nestedInstruction(instruction, action.condition, action.replaceWith),
      cursor.instructionIndex,
    )) {
      for (let index = 0; index < action.replaceWith.length; index += 1) {
        executeAction(action.replaceWith[index], instruction, nestedCursor(cursor, index), context, nextEffectIndex);
      }
    }
    return;
  }
  if (action.kind === "sequence") {
    for (let index = 0; index < action.effects.length; index += 1) {
      executeAction(action.effects[index], instruction, nestedCursor(cursor, index), context, nextEffectIndex);
    }
    return;
  }
  if (action.kind === "unsupported") {
    throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${action.code}: ${action.text}`);
  }
  context.execute(action, instruction, { ...cursor, effectIndex: nextEffectIndex() });
}

/**
 * The generic typed-program execution loop. It is state-agnostic, serializable,
 * and suspends only at instruction boundaries so pending choices can be stored.
 */
export function executeRuleProgram(
  program: RuleProgram,
  context: RuleExecutionContext,
  startInstruction = 0,
) {
  for (let instructionIndex = startInstruction; instructionIndex < program.instructions.length; instructionIndex += 1) {
    const instruction = program.instructions[instructionIndex];
    const selectionCondition = instruction.condition.kind === "selection-made"
      && instruction.choices.some((choice) => choice.id === instruction.condition.choiceId);
    if (!selectionCondition && !context.conditionIsActive(instruction, instructionIndex)) continue;
    const readiness = context.beforeInstruction(instruction, instructionIndex);
    if (readiness === "suspend") return { completed: false, instructionIndex };
    if (readiness === "skip") continue;
    if (selectionCondition && !context.conditionIsActive(instruction, instructionIndex)) continue;
    let effectIndex = 0;
    const nextEffectIndex = () => effectIndex++;
    for (let actionIndex = 0; actionIndex < instruction.actions.length; actionIndex += 1) {
      executeAction(
        instruction.actions[actionIndex],
        instruction,
        { instructionIndex, actionIndex, effectIndex: -1 },
        context,
        nextEffectIndex,
      );
    }
    if (context.afterInstruction?.(instruction, instructionIndex) === "suspend") {
      return { completed: false, instructionIndex };
    }
  }
  return { completed: true, instructionIndex: program.instructions.length };
}
