import type { CardChoices, GameCard, MatchState } from "../game";
import { programForCard } from "./catalogue";
import type {
  RuleAction as TypedRuleAction,
  RuleCondition,
  RuleInstruction,
  RuleProgram,
  RulesDuration,
} from "./model";

/**
 * Compatibility-free public rule types. The extra choice marker remains in the
 * union only because the game kernel deliberately skips declarative choice
 * metadata during effect execution; choices are resolved by the choice engine.
 */
export type RuleAction = TypedRuleAction | {
  kind: "choice";
  mode: "may" | "up-to" | "any-number" | "x" | "modes" | "opponent" | "simultaneous" | "target";
};
export type { RuleCondition, RuleInstruction, RuleProgram, RulesDuration };
export type Duration = RulesDuration;

function normalizeRuntimeAction(action: TypedRuleAction, sourceText: string): TypedRuleAction {
  if (action.kind === "discard" && /discard (?:their|your) entire hand/i.test(sourceText)) {
    // Entire-hand discards are deterministic rather than selections. A
    // positive minimum makes the existing discard executor consume its printed
    // amount (99 = all available cards) when no discardCardIds were selected.
    return { ...action, minimum: 1 };
  }
  if (action.kind === "conditional") {
    return {
      ...action,
      whenTrue: action.whenTrue.map((nested) => normalizeRuntimeAction(nested, sourceText)),
      whenFalse: action.whenFalse?.map((nested) => normalizeRuntimeAction(nested, sourceText)),
    };
  }
  if (action.kind === "replacement") {
    return {
      ...action,
      replaceWith: action.replaceWith.map((nested) => normalizeRuntimeAction(nested, sourceText)),
    };
  }
  if (action.kind === "sequence") {
    return {
      ...action,
      effects: action.effects.map((nested) => normalizeRuntimeAction(nested, sourceText)),
    };
  }
  return action;
}

function normalizeRuntimeProgram(program: RuleProgram): RuleProgram {
  return {
    ...program,
    instructions: program.instructions.map((instruction) => {
      if (!/discard (?:their|your) entire hand/i.test(instruction.sourceText)) return instruction;
      const actions = instruction.actions.map((action) => normalizeRuntimeAction(action, instruction.sourceText));
      return { ...instruction, effects: actions, actions };
    }),
  };
}

export function compileCardEffect(card: GameCard, source = card.effect): RuleProgram {
  return normalizeRuntimeProgram(programForCard(card, source));
}

export function cardProgramIsExecutable(program: RuleProgram) {
  return program.instructions.every((instruction) => (
    instruction.effects.length > 0
    && instruction.effects.every((effect) => effect.kind !== "unsupported")
  ));
}

function actionValue(action: TypedRuleAction, match: MatchState) {
  switch (action.kind) {
    case "modify-stat": return action.amount * (action.stat === "power" ? 0.012 : action.stat === "damage" ? 0.9 : 0.65);
    case "draw": return action.amount * 2.4;
    case "discard": return -action.amount * 1.4;
    case "energize": return action.amount * 2;
    case "recharge-energy": return action.amount === "all" ? 4 : action.amount * 1.6;
    case "grant-keyword": return action.keyword === "DoubleStrike" ? 4 : 2.5;
    case "move": return ["destroy", "control", "remove"].includes(action.verb) ? action.amount * 3 : 1.5;
    case "negate": return match.batch.length ? 5 : -3;
    case "search": return 3;
    case "copy": return 3.5;
    case "cost": return action.operation === "increase" ? -action.amount : Math.max(1, action.amount);
    case "fusion": return action.operation === "unfuse" ? -1 : 10;
    case "win-game": return 1_000;
    case "conditional": return Math.max(
      action.whenTrue.reduce((sum, nested) => sum + actionValue(nested, match), 0),
      (action.whenFalse ?? []).reduce((sum, nested) => sum + actionValue(nested, match), 0),
    );
    case "replacement": return action.replaceWith.reduce((sum, nested) => sum + actionValue(nested, match), 0);
    case "schedule": return action.effects.reduce((sum, nested) => sum + actionValue(nested, match), 0);
    case "sequence": return action.effects.reduce((sum, nested) => sum + actionValue(nested, match), 0);
    case "unsupported": return -Infinity;
    default: return 0;
  }
}

export function estimateProgramValue(program: RuleProgram, match: MatchState, playerId: string, choices: CardChoices = {}) {
  if (!match.players.some((candidate) => candidate.id === playerId)) return -Infinity;
  let value = 0;
  for (const instruction of program.instructions) {
    for (const action of instruction.effects) value += actionValue(action, match);
  }
  if (choices.confirmed === false) value = 0;
  return value;
}
