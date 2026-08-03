import type { CardType, GameCard, MatchState, PlayerState } from "../game";
import { consumeTriggerCreation } from "../engine/limits";
import { ruleDefinitionForCard } from "./catalogue";
import { ruleConditionActive } from "./modifiers";
import type { RuleObject, TriggerDefinition, TriggerEventName } from "./model";
import { createRuleObject } from "./objects";
import { ensureRulesState } from "./state";

export type RuleEvent = {
  id: string;
  name: TriggerEventName;
  actorId: string;
  controllerId?: string;
  card?: GameCard;
  cardType?: CardType;
  targetBakuganId?: string;
  amount?: number;
  createdAt: number;
};

function activeSources(state: MatchState, owner: PlayerState, event: RuleEvent) {
  const selected = owner.bakugan.find((bakugan) => bakugan.id === state.selected[owner.id]);
  const top = selected ? selected.evoStack.at(-1) ?? selected.character : undefined;
  const playedSource = event.card && (event.controllerId ?? event.actorId) === owner.id ? event.card : undefined;
  const sources = [...(top ? [top] : []), ...owner.heroes, ...(playedSource ? [playedSource] : [])];
  return sources.filter((source, index) => sources.findIndex((candidate) => candidate.id === source.id) === index);
}

function relationshipMatches(trigger: TriggerDefinition, ownerId: string, event: RuleEvent) {
  if (trigger.relationship === "any") return true;
  if (trigger.relationship === "controller") return event.actorId === ownerId || event.controllerId === ownerId;
  return event.actorId !== ownerId && event.controllerId !== ownerId;
}

function triggerMatches(
  trigger: TriggerDefinition,
  source: GameCard,
  owner: PlayerState,
  event: RuleEvent,
  state: MatchState,
) {
  if (trigger.event !== event.name) return false;
  if (!relationshipMatches(trigger, owner.id, event)) return false;
  if (trigger.source === "self" && source.id !== event.card?.id) return false;
  if (trigger.cardType && trigger.cardType !== event.cardType) return false;
  const target = event.targetBakuganId
    ? owner.bakugan.find((candidate) => candidate.id === event.targetBakuganId)
    : undefined;
  if (trigger.interveningCondition && !ruleConditionActive(state, owner, trigger.interveningCondition, target)) return false;
  return true;
}

function usageKey(object: { source: GameCard; abilityId: string }, ownerId: string, turn: number) {
  return `${turn}:${ownerId}:${object.source.id}:${object.abilityId}`;
}

export function collectRuleTriggers(state: MatchState, event: RuleEvent): RuleObject[] {
  const rules = ensureRulesState(state);
  const collected: Array<{ owner: PlayerState; object: RuleObject }> = [];
  for (const owner of state.players) {
    for (const source of activeSources(state, owner, event)) {
      const definition = ruleDefinitionForCard(source);
      for (const ability of definition.abilities) {
        if (ability.kind !== "triggered" || !ability.trigger || !triggerMatches(ability.trigger, source, owner, event, state)) continue;
        const key = usageKey({ source, abilityId: ability.id }, owner.id, state.turn);
        if (ability.trigger.limit && rules.triggerUsage[key]) continue;
        if (ability.trigger.limit) rules.triggerUsage[key] = (rules.triggerUsage[key] ?? 0) + 1;
        const choices = event.targetBakuganId ? { targetBakuganId: event.targetBakuganId } : {};
        collected.push({
          owner,
          object: createRuleObject({
            controllerId: owner.id,
            card: source,
            ability,
            kind: "trigger",
            choices,
            sourceId: source.id,
            createdByEventId: event.id,
          }),
        });
      }
    }
  }
  const objects = collected
    .sort((left, right) => {
      const leftActive = Number(left.owner.id === state.startingPlayer);
      const rightActive = Number(right.owner.id === state.startingPlayer);
      return rightActive - leftActive || left.object.id.localeCompare(right.object.id);
    })
    .map((entry) => entry.object);
  consumeTriggerCreation(objects.length);
  return objects;
}

export function emitRuleEvent(state: MatchState, event: RuleEvent) {
  const eventKey = `rules:${event.id}`;
  if (state.collectedEventKeys.includes(eventKey)) return [];
  state.collectedEventKeys.push(eventKey);
  const objects = collectRuleTriggers(state, event);
  state.batch.push(...objects);
  return objects;
}

export function conditionStillValidAtResolution(state: MatchState, object: RuleObject) {
  const definition = ruleDefinitionForCard(object.card);
  const ability = definition.abilities.find((candidate) => candidate.id === object.abilityId);
  if (!ability?.trigger?.interveningCondition) return true;
  const owner = state.players.find((player) => player.id === object.controllerId);
  const target = owner?.bakugan.find((candidate) => candidate.id === object.choices.targetBakuganId);
  return Boolean(owner && ruleConditionActive(state, owner, ability.trigger.interveningCondition, target));
}
