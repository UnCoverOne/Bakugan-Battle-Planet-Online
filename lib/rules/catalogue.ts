import { textFingerprint } from "../content/catalogue";
import { CARD_CATALOGUE_VERSION, RULES_PROFILE_VERSION } from "../content/versions";
import { CARDS } from "../data";
import type { GameCard } from "../game";
import type { RuleDefinition, RuleProgram } from "./model";
import { provenanceForDefinition, validateDefinitionProvenance } from "./provenance";
import { ruleCardId } from "./catalogue-primitives";
import { abilityDefinitionsForCard, playDefinitionForCard } from "./catalogue-structure";
import {
  enhanceDeckInspectionAbilities,
  enhanceDeckInspectionPlayDefinition,
} from "./deck-inspection";

function definitionForCard(card: GameCard): RuleDefinition {
  const abilities = enhanceDeckInspectionAbilities(card, abilityDefinitionsForCard(card));
  return {
    cardId: ruleCardId(card),
    printingId: ruleCardId(card),
    sourceText: card.effect,
    sourceTextFingerprint: textFingerprint(card.effect),
    cardName: card.displayName || card.name,
    cardType: card.type,
    faction: card.faction,
    factions: card.factions,
    implementationStatus: "complete",
    rulesVersion: RULES_PROFILE_VERSION,
    contentVersion: CARD_CATALOGUE_VERSION,
    play: enhanceDeckInspectionPlayDefinition(card, playDefinitionForCard(card)),
    abilities,
    provenance: provenanceForDefinition(card, abilities),
    goldenTestIds: [`card-golden:${ruleCardId(card)}`],
  };
}

export function authorRuleDefinitionForCard(
  card: GameCard,
): RuleDefinition & { implementationStatus: "draft" } {
  const definition = definitionForCard(card);
  return {
    ...definition,
    implementationStatus: "draft",
    provenance: {
      authorityOrder: [...definition.provenance.authorityOrder],
      citations: definition.provenance.citations.map((citation) => ({ ...citation })),
      reviewed: false,
    },
    goldenTestIds: [],
  };
}

const DEFINITIONS = Object.freeze(CARDS.map(definitionForCard));
const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.cardId, definition]));

export class UnsupportedCardTextError extends Error {
  constructor(public readonly code: "UNKNOWN_CARD_DEFINITION" | "CARD_TEXT_MISMATCH" | "UNSUPPORTED_RULE_NODE", message: string) {
    super(message);
    this.name = "UnsupportedCardTextError";
  }
}

export function allRuleDefinitions(): readonly RuleDefinition[] {
  return DEFINITIONS;
}

export function ruleDefinitionForCard(card: GameCard): RuleDefinition {
  const definition = BY_ID.get(ruleCardId(card));
  if (!definition) throw new UnsupportedCardTextError("UNKNOWN_CARD_DEFINITION", `No typed rule definition exists for ${card.catalogId || card.name}.`);
  if (definition.sourceText !== card.effect) throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} does not match the reviewed rules text for ${definition.cardId}.`);
  return definition;
}

export function validateCardAgainstRules(card: GameCard) {
  const definition = ruleDefinitionForCard(card);
  if (definition.implementationStatus !== "complete") throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} is not a reviewed production definition.`);
  if (definition.sourceTextFingerprint !== textFingerprint(card.effect)) throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} has an invalid text fingerprint.`);
  const provenanceErrors = validateDefinitionProvenance(definition);
  if (provenanceErrors.length) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", provenanceErrors.join(" "));
  for (const ability of definition.abilities) for (const instruction of ability.instructions) {
    if (!instruction.effects.length) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} has an empty typed instruction.`);
    if (instruction.effects.some((effect) => effect.kind === "unsupported")) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} contains an unsupported rule node.`);
  }
  return true;
}

export function programForCard(card: GameCard, source = card.effect): RuleProgram {
  const definition = ruleDefinitionForCard(card);
  const instructions = definition.abilities.flatMap((ability) => ability.instructions);
  const selected = source === card.effect
    ? instructions
    : instructions.filter((instruction) => instruction.sourceText === source || source.includes(instruction.sourceText));
  if (!selected.length && source.trim()) {
    throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} attempted to execute unreviewed derived text.`);
  }
  return { cardId: definition.cardId, source, instructions: selected.length ? selected : instructions };
}
