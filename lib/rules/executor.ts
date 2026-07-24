import type { RuleAction, RuleInstruction, RuleProgram } from "./effects";

export type RuleExecutionCursor = {
  instructionIndex: number;
  actionIndex: number;
};

export type RuleExecutionContext = {
  conditionIsActive(instruction: RuleInstruction): boolean;
  beforeInstruction(instruction: RuleInstruction, instructionIndex: number): "continue" | "suspend" | "skip";
  execute(action: RuleAction, instruction: RuleInstruction, cursor: RuleExecutionCursor): void;
};

/**
 * The only generic RuleProgram execution loop. It deliberately knows nothing
 * about MatchState: the game supplies validated adapters for state mutation,
 * choices and condition checks. Returning a cursor makes suspension explicit
 * and serializable instead of requiring state rewind after resolution.
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
      context.execute(instruction.actions[actionIndex], instruction, { instructionIndex, actionIndex });
    }
  }
  return { completed: true, instructionIndex: program.instructions.length };
}

