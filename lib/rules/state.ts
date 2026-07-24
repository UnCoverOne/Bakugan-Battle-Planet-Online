import type { MatchState } from "../game";
import type { RuleObject, RulesState } from "./model";

export type RulesBackedMatchState = MatchState & { rules?: RulesState };

export function ensureRulesState(input: MatchState): RulesState {
  const state = input as RulesBackedMatchState;
  if (!state.rules || state.rules.version !== 3) {
    state.rules = { version: 3, modifiers: [], replacements: [], triggerUsage: {} };
  }
  state.rules.modifiers = Array.isArray(state.rules.modifiers) ? state.rules.modifiers : [];
  state.rules.replacements = Array.isArray(state.rules.replacements) ? state.rules.replacements : [];
  state.rules.triggerUsage = state.rules.triggerUsage && typeof state.rules.triggerUsage === "object" ? state.rules.triggerUsage : {};
  return state.rules;
}

export function isRuleObject(value: unknown): value is RuleObject {
  if (!value || typeof value !== "object") return false;
  const object = value as Partial<RuleObject>;
  return object.rulesObjectVersion === 3 && typeof object.definitionId === "string"
    && typeof object.abilityId === "string" && typeof object.status === "string" && Boolean(object.cursor);
}

export function normalizeRuleObjects(state: MatchState) {
  ensureRulesState(state);
  state.batch = state.batch.map((pending, index) => {
    if (isRuleObject(pending)) {
      if (pending.kind === "copy" && pending.independentChoiceSetId.endsWith(":legacy")) {
        pending.choices = {};
        pending.resolvedChoices = {};
        pending.independentChoiceSetId = `${pending.id}:choices`;
      }
      return pending;
    }
    const definitionId = (pending.card.catalogId || `bb-${pending.card.number}`) as RuleObject["definitionId"];
    const sourceId = pending.sourceId ?? pending.card.id;
    const copied = pending.kind === "copy";
    return {
      ...pending,
      choices: copied ? {} : pending.choices,
      resolvedChoices: copied ? {} : pending.resolvedChoices,
      rulesObjectVersion: 3 as const,
      definitionId,
      abilityId: `${definitionId}:${pending.kind}`,
      sourceRef: { kind: "card" as const, instanceId: sourceId, catalogId: definitionId },
      status: pending.negated ? "negated" as const : "pending" as const,
      cursor: { instructionIndex: pending.instructionIndex ?? 0, effectIndex: 0 },
      independentChoiceSetId: copied ? `${pending.id}:choices` : `${pending.id}:choices:${index}`,
    } satisfies RuleObject;
  });
  return state;
}
