import type { CardChoices, GameCard, MatchState } from "./game";
import {
  compileCardEffect,
  type RuleAction,
  type RuleInstruction,
} from "./rules/effects";
import { ruleConditionActive } from "./rules/modifiers";

export type AiCardActionEntry = {
  instruction: RuleInstruction;
  action: RuleAction;
  sourceText: string;
};

const NON_SUBSTANTIVE_ACTIONS = new Set<RuleAction["kind"]>([
  "choice",
  "trigger",
]);

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function activeBakugan(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  return player?.bakugan.find((bakugan) => bakugan.id === match.selected[playerId]);
}

export function aiConditionActive(
  match: MatchState,
  playerId: string,
  condition: Parameters<typeof ruleConditionActive>[2],
) {
  const player = playerById(match, playerId);
  return Boolean(player && ruleConditionActive(
    match,
    player,
    condition,
    activeBakugan(match, playerId),
  ));
}

export function isTemporaryCombatAction(action: RuleAction) {
  if (action.kind === "set-stat" || action.kind === "set-rule") return true;
  return (action.kind === "modify-stat" || action.kind === "grant-keyword")
    && action.duration !== "while-source-in-play"
    && action.duration !== "next-card";
}

export function allLeafActions(action: RuleAction): RuleAction[] {
  if (action.kind === "conditional") {
    return [...action.whenTrue, ...(action.whenFalse ?? [])].flatMap(allLeafActions);
  }
  if (action.kind === "replacement") return action.replaceWith.flatMap(allLeafActions);
  if (action.kind === "sequence") return action.effects.flatMap(allLeafActions);
  return [action];
}

export function allInstructionLeafActions(instruction: RuleInstruction) {
  return instruction.actions.flatMap(allLeafActions);
}

function substantiveLeafActions(action: RuleAction): RuleAction[] {
  const nested = allLeafActions(action);
  return nested.filter((candidate) => !NON_SUBSTANTIVE_ACTIONS.has(candidate.kind));
}

export function cardLeafActions(card: GameCard, source = card.effect) {
  return compileCardEffect(card, source).instructions
    .flatMap((instruction) => instruction.actions)
    .flatMap(substantiveLeafActions);
}

export function pureTemporaryCombatProgram(card: GameCard) {
  const substantive = cardLeafActions(card);
  return substantive.length > 0
    && substantive.some(isTemporaryCombatAction)
    && substantive.every(isTemporaryCombatAction);
}

function activeLeafActions(
  match: MatchState,
  playerId: string,
  action: RuleAction,
): RuleAction[] {
  if (action.kind === "conditional") {
    const branch = aiConditionActive(match, playerId, action.condition)
      ? action.whenTrue
      : action.whenFalse ?? [];
    return branch.flatMap((nested) => activeLeafActions(match, playerId, nested));
  }
  if (action.kind === "replacement") {
    if (action.condition && !aiConditionActive(match, playerId, action.condition)) return [];
    return action.replaceWith.flatMap((nested) => activeLeafActions(match, playerId, nested));
  }
  if (action.kind === "sequence") {
    return action.effects.flatMap((nested) => activeLeafActions(match, playerId, nested));
  }
  return [action];
}

type ActiveCardActionOptions = {
  /**
   * `play` excludes payloads belonging to future triggers, while still allowing
   * effects that trigger from the card's own play. `all` is useful for
   * long-horizon retention analysis.
   */
  execution?: "play" | "all";
};

export function activeCardActionEntries(
  match: MatchState,
  playerId: string,
  card: GameCard,
  _choices: CardChoices = {},
  options: ActiveCardActionOptions = {},
): AiCardActionEntry[] {
  const execution = options.execution ?? "play";
  void _choices;
  const entries: AiCardActionEntry[] = [];
  for (const instruction of compileCardEffect(card).instructions) {
    if (!aiConditionActive(match, playerId, instruction.condition)) continue;
    const leaves = instruction.actions.flatMap((action) => (
      activeLeafActions(match, playerId, action)
    ));
    const triggers = leaves.filter((action): action is Extract<RuleAction, { kind: "trigger" }> => (
      action.kind === "trigger"
    ));
    if (execution === "play" && triggers.length) {
      const firesFromThisPlay = triggers.some((trigger) => (
        trigger.definition.event === "CARD_PLAYED"
        && trigger.definition.relationship === "controller"
      ));
      if (!firesFromThisPlay) continue;
    }
    for (const action of leaves) {
      if (NON_SUBSTANTIVE_ACTIONS.has(action.kind)) continue;
      entries.push({ instruction, action, sourceText: instruction.sourceText });
    }
  }
  return entries;
}

export function estimateRuleActionValue(action: RuleAction, match: MatchState) {
  switch (action.kind) {
    case "modify-stat":
      return action.amount * (
        action.stat === "power" ? 0.012 : action.stat === "damage" ? 0.9 : 0.65
      );
    case "draw": return action.amount * 2.4;
    case "discard": return -action.amount * 1.4;
    case "energize": return action.amount * 2;
    case "generate-energy": return action.amount * 1.6;
    case "grant-keyword": return action.keyword === "DoubleStrike" ? 4 : 2.5;
    case "move": return ["destroy", "control", "remove"].includes(action.verb)
      ? action.amount * 3
      : 1.5;
    case "negate": return match.batch.length ? 5 : -3;
    case "search": return 3;
    case "copy": return 3.5;
    case "cost": return action.operation === "increase" ? -action.amount : Math.max(1, action.amount);
    case "set-stat": return action.stat === "power" ? action.value * 0.006 : action.value * 0.45;
    case "set-rule": return 2;
    case "win-game": return 1_000;
    case "damage-to-hand": return 3;
    case "end-turn": return 4;
    case "shuffle-deck": return 0.5;
    case "reveal": return 0.8;
    case "reorder-deck": return 1.5;
    case "play": return 3;
    case "attack": return action.amount * 0.9;
    case "reroll": return 0;
    case "continuous": return Math.abs(action.modifier.amount) * 0.01;
    case "prevention": return action.amount ?? 2;
    case "unsupported": return Number.NEGATIVE_INFINITY;
    default: return 0;
  }
}

function temporaryActionPotential(action: RuleAction): number {
  if (action.kind === "conditional") {
    const whenTrue = action.whenTrue.reduce(
      (sum, nested) => sum + temporaryActionPotential(nested),
      0,
    );
    const whenFalse = (action.whenFalse ?? []).reduce(
      (sum, nested) => sum + temporaryActionPotential(nested),
      0,
    );
    return Math.max(whenTrue, whenFalse);
  }
  if (action.kind === "replacement") {
    return action.replaceWith.reduce(
      (sum, nested) => sum + temporaryActionPotential(nested),
      0,
    );
  }
  if (action.kind === "sequence") {
    return action.effects.reduce(
      (sum, nested) => sum + temporaryActionPotential(nested),
      0,
    );
  }
  if (!isTemporaryCombatAction(action)) return 0;
  if (action.kind === "modify-stat") {
    return Math.abs(action.amount) * (
      action.stat === "power" ? 0.012 : action.stat === "damage" ? 0.9 : 0.65
    );
  }
  if (action.kind === "grant-keyword") return action.keyword === "DoubleStrike" ? 4 : 2.5;
  if (action.kind === "set-stat") return action.stat === "power" ? 3 : 2.5;
  if (action.kind === "set-rule") return 2;
  return 0;
}

export function temporaryCombatPotential(card: GameCard) {
  try {
    const total = compileCardEffect(card).instructions.reduce((sum, instruction) => (
      sum + instruction.actions.reduce(
        (instructionSum, action) => instructionSum + temporaryActionPotential(action),
        0,
      )
    ), 0);
    return Math.min(4.5, total);
  } catch {
    return 0;
  }
}

export function hasNonDeferrablePreRollTiming(sourceText: string) {
  return /(?:before|when) (?:you )?(?:select|roll)|select a Bakugan to roll|turn a BakuCore .*face up|during the Roll Step|before the Roll Step/i.test(sourceText);
}
