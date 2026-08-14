import type { CardChoices, CardType, GameCard, MatchState, PlayerState } from "../game";
import { consumeTriggerCreation } from "../engine/limits";
import { ruleDefinitionForCard } from "./catalogue";
import { ruleConditionActive } from "./modifiers";
import type { RuleAction, RuleObject, TriggerDefinition, TriggerEventName } from "./model";
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
  choices?: CardChoices;
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

function sourceBakuganFor(owner: PlayerState, source: GameCard) {
  return owner.bakugan.find((bakugan) => (
    bakugan.character.id === source.id || bakugan.evoStack.some((candidate) => candidate.id === source.id)
  ));
}

function relationshipMatches(trigger: TriggerDefinition, ownerId: string, event: RuleEvent) {
  if (trigger.relationship === "any") return true;
  if (trigger.relationship === "controller") return event.actorId === ownerId;
  return event.actorId !== ownerId;
}

function actionUsesImplicitControllerBakugan(action: RuleAction): boolean {
  switch (action.kind) {
    case "modify-stat":
      return (action.scope ?? "target") === "target" && !action.targetChoiceId;
    case "grant-keyword":
    case "set-stat":
      return true;
    case "reroll":
      return action.target === "controller";
    case "conditional":
      return action.whenTrue.some(actionUsesImplicitControllerBakugan)
        || Boolean(action.whenFalse?.some(actionUsesImplicitControllerBakugan));
    case "sequence":
      return action.effects.some(actionUsesImplicitControllerBakugan);
    case "replacement":
      return action.replaceWith.some(actionUsesImplicitControllerBakugan);
    default:
      return false;
  }
}

function actionIsPlayedOnActiveBakugan(card: GameCard | undefined) {
  if (!card || card.type !== "Action") return false;
  const definition = ruleDefinitionForCard(card);
  const hasExplicitBakuganSelection = definition.play.choices.some((choice) => (
    ["targetBakuganId", "secondaryTargetBakuganId"].includes(String(choice.id))
    && choice.timing === "announce"
  ));
  if (hasExplicitBakuganSelection) return false;
  return definition.abilities
    .filter((ability) => ability.kind === "spell")
    .flatMap((ability) => ability.instructions)
    .some((instruction) => instruction.actions.some(actionUsesImplicitControllerBakugan));
}

function sourceTargetMatches(source: GameCard, owner: PlayerState, event: RuleEvent) {
  if (!/\bwhen you play an Action(?: card)? on this\b/i.test(source.effect)) return true;
  const sourceBakugan = sourceBakuganFor(owner, source);
  if (!sourceBakugan) return false;
  const explicitTargets = [
    event.choices?.targetBakuganId,
    event.choices?.secondaryTargetBakuganId,
  ].filter((target): target is string => Boolean(target));
  if (explicitTargets.length) return explicitTargets.includes(sourceBakugan.id);
  return actionIsPlayedOnActiveBakugan(event.card) && event.targetBakuganId === sourceBakugan.id;
}

function triggerMatches(
  trigger: TriggerDefinition,
  source: GameCard,
  owner: PlayerState,
  event: RuleEvent,
  state: MatchState,
) {
  if (trigger.event !== event.name) return false;
  if (trigger.minimumEventAmount != null && (event.amount ?? 0) < trigger.minimumEventAmount) return false;
  if (!relationshipMatches(trigger, owner.id, event)) return false;
  if (trigger.source === "self" && source.id !== event.card?.id) return false;
  if (trigger.cardType && trigger.cardType !== event.cardType) return false;
  if (!sourceTargetMatches(source, owner, event)) return false;
  const target = event.targetBakuganId
    ? state.players.flatMap((player) => player.bakugan).find((candidate) => candidate.id === event.targetBakuganId)
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
        const sourceBakugan = sourceBakuganFor(owner, source);
        const sourceBakuganId = sourceBakugan?.id
          ?? (ability.trigger.source === "self" && event.card?.type === "Evo" ? event.targetBakuganId : undefined);
        const choices: CardChoices = {
          ...(ability.trigger.source === "self" ? event.choices ?? {} : {}),
          ...(sourceBakuganId ? { sourceBakuganId } : {}),
        };
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
  const target = object.choices.sourceBakuganId
    ? state.players.flatMap((player) => player.bakugan).find((candidate) => candidate.id === object.choices.sourceBakuganId)
    : undefined;
  return Boolean(owner && ruleConditionActive(state, owner, ability.trigger.interveningCondition, target));
}
