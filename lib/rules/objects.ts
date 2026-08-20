import type { CardChoices, GameCard } from "../game";
import { cardDefinitionId } from "./identity";
import type { AbilityDefinition, RuleObject } from "./model";

function objectId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createRuleObject(input: {
  controllerId: string;
  cardOwnerId?: string;
  card: GameCard;
  ability: AbilityDefinition;
  kind?: RuleObject["kind"];
  choices?: CardChoices;
  sourceId?: string;
  createdByEventId?: string;
}): RuleObject {
  const definitionId = cardDefinitionId(input.card);
  const id = objectId(`${definitionId}-object`);
  const sourceId = input.sourceId ?? input.card.id;
  return {
    rulesObjectVersion: 3,
    id,
    controllerId: input.controllerId,
    cardOwnerId: input.cardOwnerId ?? input.controllerId,
    card: input.card,
    choices: structuredClone(input.choices ?? {}),
    kind: input.kind ?? (input.ability.kind === "triggered" ? "trigger" : "card"),
    effect: input.ability.instructions.map((instruction) => instruction.sourceText).join(" ").trim(),
    sourceId,
    definitionId,
    abilityId: input.ability.id,
    sourceRef: { kind: "card", instanceId: sourceId, catalogId: definitionId },
    status: "pending",
    cursor: { instructionIndex: 0, effectIndex: 0 },
    createdByEventId: input.createdByEventId,
    independentChoiceSetId: `${id}:choices`,
  };
}

export function beginRuleObjectResolution(object: RuleObject) {
  if (object.status === "negated" || object.status === "resolved") return object;
  object.status = "resolving";
  return object;
}

export function completeRuleObject(object: RuleObject) {
  if (object.status !== "negated") object.status = "resolved";
  return object;
}

export function negateRuleObject(object: RuleObject) {
  object.status = "negated";
  object.negated = true;
  return object;
}

export function copyRuleObject(
  source: RuleObject,
  controllerId: string,
  options: { independentChoices?: boolean } = {},
): RuleObject {
  const id = objectId(`${source.definitionId}-copy`);
  const independentChoices = options.independentChoices ?? true;
  return {
    ...structuredClone(source),
    id,
    controllerId,
    kind: "copy",
    status: "pending",
    negated: false,
    cursor: { instructionIndex: 0, effectIndex: 0 },
    resolvedChoices: independentChoices ? {} : structuredClone(source.resolvedChoices ?? {}),
    choices: independentChoices ? {} : structuredClone(source.choices),
    independentChoiceSetId: `${id}:choices`,
    copiedFromObjectId: source.id,
  };
}

export function copyRuleObjects(
  source: RuleObject,
  controllerId: string,
  count: number,
  options: { independentChoices?: boolean } = {},
): RuleObject[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => copyRuleObject(source, controllerId, options));
}
