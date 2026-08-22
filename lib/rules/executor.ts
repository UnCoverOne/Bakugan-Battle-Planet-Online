import { consumeEffectStep } from "../engine/limits";
import { UnsupportedCardTextError } from "./catalogue";
import type { RuleAction, RuleInstruction, RuleProgram } from "./effects";

export type RuleExecutionCursor = {
  instructionIndex: number;
  actionIndex: number;
  /** Legacy game-kernel alias for actionIndex. Keep both values identical. */
  effectIndex: number;
};

export type RuleExecutionContext = {
  conditionIsActive(instruction: RuleInstruction): boolean;
  beforeInstruction(instruction: RuleInstruction, instructionIndex: number): "continue" | "suspend" | "skip";
  execute(action: RuleAction, instruction: RuleInstruction, cursor: RuleExecutionCursor): void;
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
  const actionIndex = cursor.actionIndex * 100 + index;
  return { ...cursor, actionIndex, effectIndex: actionIndex };
}

function executeAction(
  action: RuleAction,
  instruction: RuleInstruction,
  cursor: RuleExecutionCursor,
  context: RuleExecutionContext,
) {
  consumeEffectStep();
  if (action.kind === "conditional") {
    const branchInstruction = nestedInstruction(instruction, action.condition, action.whenTrue);
    const selected = context.conditionIsActive(branchInstruction) ? action.whenTrue : (action.whenFalse ?? []);
    for (let index = 0; index < selected.length; index += 1) {
      executeAction(selected[index], instruction, nestedCursor(cursor, index), context);
    }
    return;
  }
  if (action.kind === "replacement") {
    if (!action.condition || context.conditionIsActive(nestedInstruction(instruction, action.condition, action.replaceWith))) {
      for (let index = 0; index < action.replaceWith.length; index += 1) {
        executeAction(action.replaceWith[index], instruction, nestedCursor(cursor, index), context);
      }
    }
    return;
  }
  if (action.kind === "sequence") {
    for (let index = 0; index < action.effects.length; index += 1) {
      executeAction(action.effects[index], instruction, nestedCursor(cursor, index), context);
    }
    return;
  }
  if (action.kind === "unsupported") {
    throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${action.code}: ${action.text}`);
  }
  context.execute(action, instruction, cursor);
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
    if (!context.conditionIsActive(instruction)) continue;
    const readiness = context.beforeInstruction(instruction, instructionIndex);
    if (readiness === "suspend") return { completed: false, instructionIndex };
    if (readiness === "skip") continue;
    for (let actionIndex = 0; actionIndex < instruction.actions.length; actionIndex += 1) {
      executeAction(instruction.actions[actionIndex], instruction, { instructionIndex, actionIndex, effectIndex: actionIndex }, context);
    }
  }
  return { completed: true, instructionIndex: program.instructions.length };
}
