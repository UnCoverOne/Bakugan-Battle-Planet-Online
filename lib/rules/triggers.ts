import type { CardChoices, CardType, GameCard, MatchState, PlayerState } from "../game";
import { consumeTriggerCreation } from "../engine/limits";
import { ruleDefinitionForCard } from "./catalogue";
import { ruleConditionActive } from "./modifiers";
import type { RuleAction, RuleObject, TriggerDefinition, TriggerEventName } from "./model";
import { createRuleObject } from "./objects";
import { ensureRulesState } from "./state";
import { evaluateNumberValue } from "./values";
import { captureInstructionValues } from "./value-capture";
import { effectiveCardFactions } from "./derived-characteristics";

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
  const selectedId = state.selected[owner.id];
  // Triggered abilities belong to the top card of every Bakugan that is
  // currently participating in play, not only the Bakugan selected this turn.
  // Keep the selected Bakugan active even while closed so existing pre-open and
  // reroll semantics remain intact, and also include every other open Bakugan.
  const bakuganSources = owner.bakugan
    .filter((bakugan) => bakugan.open || bakugan.id === selectedId)
    .map((bakugan) => bakugan.evoStack.at(-1) ?? bakugan.character);
  const playedSource = event.card && (event.controllerId ?? event.actorId) === owner.id ? event.card : undefined;
  const sources = [...bakuganSources, ...owner.heroes, ...(playedSource ? [playedSource] : [])];
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

function sourceTargetMatches(
  source: GameCard,
  owner: PlayerState,
  event: RuleEvent,
  triggerText: string,
) {
  const sourceBakugan = sourceBakuganFor(owner, source);
  // "When this opens" belongs to the Bakugan carrying the Character/Evo
  // source. It is not the same controller-wide event as "When you open a
  // Bakugan" on Heroes such as Shun Kazami.
  if (event.name === "BAKUGAN_OPENED" && /\bwhen this opens\b/i.test(triggerText)) {
    return Boolean(sourceBakugan && sourceBakugan.id === event.targetBakuganId);
  }
  if (!/\bwhen you play an Action(?: card)? on this\b/i.test(source.effect)) return true;
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
  triggerText: string,
) {
  if (trigger.event !== event.name) return false;
  if (trigger.minimumEventAmount != null && (event.amount ?? 0) < evaluateNumberValue(state, trigger.minimumEventAmount, {
    controllerId: owner.id,
    choices: event.choices,
    sourceCardId: source.id,
    sourceBakuganId: sourceBakuganFor(owner, source)?.id,
    event: { amount: event.amount, playerId: event.actorId, sourceId: event.card?.id, targetId: event.targetBakuganId },
    moment: "event",
  })) return false;
  if (trigger.minimumPrintedCost != null) {
    const printedCost = event.card?.cost === "X" ? 0 : event.card?.cost ?? 0;
    if (printedCost < evaluateNumberValue(state, trigger.minimumPrintedCost, {
      controllerId: owner.id,
      choices: event.choices,
      sourceCardId: source.id,
      sourceBakuganId: sourceBakuganFor(owner, source)?.id,
      event: { amount: event.amount, playerId: event.actorId, sourceId: event.card?.id, targetId: event.targetBakuganId },
      moment: "event",
    })) return false;
  }
  if (!relationshipMatches(trigger, owner.id, event)) return false;
  if (trigger.source === "self" && source.id !== event.card?.id) return false;
  if (trigger.cardType && trigger.cardType !== event.cardType) return false;
  if (trigger.cardMechanic && !event.card?.mechanics.some((mechanic) => mechanic.toLowerCase() === trigger.cardMechanic!.toLowerCase())) return false;
  if (trigger.limit?.kind === "first-each-turn" && trigger.cardType) {
    const occurrences = (owner.playedCardTypesThisTurn ?? []).filter((cardType) => cardType === trigger.cardType).length;
    if (occurrences !== 1) return false;
  }
  if (trigger.factions?.length) {
    const playedFactions = event.card ? effectiveCardFactions(event.card) : [];
    if (!trigger.factions.some((faction) => playedFactions.includes(faction))) return false;
  }
  if (!sourceTargetMatches(source, owner, event, triggerText)) return false;
  const target = event.targetBakuganId
    ? state.players.flatMap((player) => player.bakugan).find((candidate) => candidate.id === event.targetBakuganId)
    : undefined;
  if (trigger.interveningCondition && !ruleConditionActive(state, owner, trigger.interveningCondition, target, event.choices ?? {})) return false;
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
        const triggerText = ability.instructions[0]?.sourceText ?? source.effect;
        if (ability.kind !== "triggered" || !ability.trigger || !triggerMatches(ability.trigger, source, owner, event, state, triggerText)) continue;
        const key = usageKey({ source, abilityId: ability.id }, owner.id, state.turn);
        if (ability.trigger.limit && rules.triggerUsage[key]) continue;
        if (ability.trigger.limit) rules.triggerUsage[key] = (rules.triggerUsage[key] ?? 0) + 1;
        const sourceBakugan = sourceBakuganFor(owner, source);
        const sourceBakuganId = sourceBakugan?.id
          ?? (ability.trigger.source === "self" && event.card?.type === "Evo" ? event.targetBakuganId : undefined);
        const controllerTargetBakuganId = event.actorId === owner.id ? event.targetBakuganId : undefined;
        const choices: CardChoices = {
          ...(ability.trigger.source === "self" ? event.choices ?? {} : {}),
          ...(sourceBakuganId ? { sourceBakuganId } : {}),
          ...(controllerTargetBakuganId ? { targetBakuganId: controllerTargetBakuganId } : {}),
          ...(event.card?.id ? { eventCardId: event.card.id } : {}),
        };
        const object = createRuleObject({
          controllerId: owner.id,
          card: source,
          ability,
          kind: "trigger",
          choices,
          sourceId: source.id,
          createdByEventId: event.id,
        });
        object.valueSnapshots = ability.instructions.reduce<Record<string, number>>((snapshots, instruction) => (
          captureInstructionValues(state, instruction, "event", {
            controllerId: owner.id,
            chosenPlayerId: choices.targetPlayerId,
            choices,
            sourceCardId: source.id,
            sourceBakuganId,
            event: {
              amount: event.amount,
              playerId: event.actorId,
              sourceId: event.card?.id,
              targetId: event.targetBakuganId,
            },
          }, snapshots)
        ), object.valueSnapshots ?? {});
        collected.push({ owner, object });
      }
    }
  }

  // Actions such as AtmosFEAR and Regrowth create a promise that survives the
  // Action object: if the opponent plays a Flip later in the same turn, the
  // promised clause becomes a new triggered object. These listeners are
  // deliberately one-shot and expire at the next turn boundary.
  const consumedWatchIds = new Set<string>();
  for (const watch of rules.delayedCardTriggers) {
    if (watch.createdTurn !== state.turn) continue;
    const owner = state.players.find((candidate) => candidate.id === watch.controllerId);
    if (!owner || !triggerMatches(watch.definition, watch.card, owner, event, state, watch.effectText)) continue;
    const definition = ruleDefinitionForCard(watch.card);
    const ability = definition.abilities.find((candidate) => (
      candidate.instructions.some((instruction) => instruction.sourceText === watch.effectText)
    ));
    if (!ability) continue;
    const instruction = ability.instructions.find((candidate) => candidate.sourceText === watch.effectText);
    if (!instruction) continue;
    const choices: CardChoices = event.card?.id ? { eventCardId: event.card.id } : {};
    const object = createRuleObject({
      controllerId: watch.controllerId,
      cardOwnerId: watch.cardOwnerId,
      card: watch.card,
      ability,
      kind: "trigger",
      choices,
      sourceId: watch.card.id,
      createdByEventId: event.id,
    });
    // Limit compilation and resolution to the promised payoff clause rather
    // than replaying the Action's complete spell ability.
    object.effect = watch.effectText;
    object.valueSnapshots = captureInstructionValues(state, instruction, "event", {
      controllerId: watch.controllerId,
      choices,
      sourceCardId: watch.card.id,
      event: {
        amount: event.amount,
        playerId: event.actorId,
        sourceId: event.card?.id,
        targetId: event.targetBakuganId,
      },
    }, object.valueSnapshots ?? {});
    collected.push({ owner, object });
    consumedWatchIds.add(watch.id);
  }
  rules.delayedCardTriggers = rules.delayedCardTriggers.filter((watch) => (
    watch.createdTurn === state.turn && !consumedWatchIds.has(watch.id)
  ));

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
  return Boolean(owner && ruleConditionActive(state, owner, ability.trigger.interveningCondition, target, object.choices));
}
