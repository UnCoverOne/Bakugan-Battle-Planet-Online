import type { MatchState } from "../game";
import { consumeReplacementIteration, EngineRuntimeLimitError, MAX_REPLACEMENT_ITERATIONS } from "../engine/limits";
import { ruleConditionActive } from "./modifiers";
import type { ProposedEvent, RuleAction, RuleSourceReference } from "./model";
import { ensureRulesState } from "./state";
import { evaluateNumberValue } from "./values";

export type ReplacementApplication = {
  event: ProposedEvent | null;
  appliedIds: string[];
  preventedAmount: number;
};

function controllerFor(state: MatchState, controllerId: string) {
  const controller = state.players.find((player) => player.id === controllerId);
  if (!controller) throw new Error("A replacement effect has an unknown controller.");
  return controller;
}

function eventFromActions(state: MatchState, controllerId: string, event: ProposedEvent, actions: RuleAction[]) {
  let next = structuredClone(event);
  for (const action of actions) {
    if (action.kind === "move" && action.verb === "return") {
      next.destination = action.object === "card" ? action.destination ?? "owner-hand" : next.destination;
    }
    else if (action.kind === "damage-to-hand" && next.kind === "DAMAGE") next.metadata = { ...(next.metadata ?? {}), damageDestination: "hand" };
    else if (action.kind === "prevention" && action.event === next.kind) {
      const amount = action.amount == null ? next.amount ?? 0 : evaluateNumberValue(state, action.amount, {
        controllerId,
        event: { amount: next.amount, playerId: next.actorId, sourceId: next.sourceId, targetId: next.targetId },
        moment: "event",
      });
      next.amount = Math.max(0, (next.amount ?? 0) - amount);
    }
    else if (action.kind === "replacement" && action.event === next.kind) next = eventFromActions(state, controllerId, next, action.replaceWith);
    else if (action.kind === "sequence") next = eventFromActions(state, controllerId, next, action.effects);
  }
  return next;
}

export function registerReplacement(
  state: MatchState,
  input: {
    id: string;
    source: RuleSourceReference;
    controllerId: string;
    effect: Extract<RuleAction, { kind: "replacement" | "prevention" }>;
  },
) {
  const rules = ensureRulesState(state);
  rules.replacements = rules.replacements.filter((replacement) => replacement.id !== input.id);
  rules.replacements.push(structuredClone(input));
  return state;
}

export function removeReplacement(state: MatchState, id: string) {
  const rules = ensureRulesState(state);
  rules.replacements = rules.replacements.filter((replacement) => replacement.id !== id);
  return state;
}

/**
 * Applies one replacement at a time and re-evaluates the changed event. This
 * prevents "instead" text from executing both the original event and the
 * replacement branch. A stable ID may affect a proposed event only once.
 */
export function applyReplacements(state: MatchState, proposed: ProposedEvent): ReplacementApplication {
  const rules = ensureRulesState(state);
  let event: ProposedEvent | null = structuredClone(proposed);
  const appliedIds: string[] = [];
  let preventedAmount = 0;

  for (let iteration = 0; event && iteration < MAX_REPLACEMENT_ITERATIONS; iteration += 1) {
    consumeReplacementIteration();
    const applicable = rules.replacements
      .filter((replacement) => !appliedIds.includes(replacement.id) && replacement.effect.event === event!.kind)
      .filter((replacement) => ruleConditionActive(state, controllerFor(state, replacement.controllerId), replacement.effect.condition))
      .sort((left, right) => {
        const leftActive = Number(left.controllerId === state.startingPlayer);
        const rightActive = Number(right.controllerId === state.startingPlayer);
        return rightActive - leftActive || left.id.localeCompare(right.id);
      });
    const selected = applicable[0];
    if (!selected) break;
    appliedIds.push(selected.id);
    if (selected.effect.kind === "prevention") {
      const amount = selected.effect.amount == null
        ? event.amount ?? 0
        : evaluateNumberValue(state, selected.effect.amount, {
          controllerId: selected.controllerId,
          event: { amount: event.amount, playerId: event.actorId, sourceId: event.sourceId, targetId: event.targetId },
          moment: "event",
        });
      preventedAmount += Math.min(event.amount ?? amount, amount);
      if (event.amount == null || amount >= event.amount) event = null;
      else event.amount -= amount;
    } else {
      event = eventFromActions(state, selected.controllerId, event, selected.effect.replaceWith);
    }
  }

  if (event && appliedIds.length >= MAX_REPLACEMENT_ITERATIONS) throw new EngineRuntimeLimitError("replacementIterations", MAX_REPLACEMENT_ITERATIONS, MAX_REPLACEMENT_ITERATIONS + 1);
  return { event, appliedIds, preventedAmount };
}
