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

export function compileCardEffect(card: GameCard, source = card.effect): RuleProgram {
  return programForCard(card, source);
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
    case "grant-keyword": return action.keyword === "DoubleStrike" ? 4 : 2.5;
    case "move": return ["destroy", "control", "remove"].includes(action.verb) ? action.amount * 3 : 1.5;
    case "negate": return match.batch.length ? 5 : -3;
    case "search": return 3;
    case "copy": return 3.5;
    case "cost": return action.operation === "increase" ? -action.amount : Math.max(1, action.amount);
    case "win-game": return 1_000;
    case "conditional": return Math.max(
      action.whenTrue.reduce((sum, nested) => sum + actionValue(nested, match), 0),
      (action.whenFalse ?? []).reduce((sum, nested) => sum + actionValue(nested, match), 0),
    );
    case "replacement": return action.replaceWith.reduce((sum, nested) => sum + actionValue(nested, match), 0);
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
