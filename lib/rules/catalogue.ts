import { textFingerprint } from "../content/catalogue";
import { CARD_CATALOGUE_VERSION, RULES_PROFILE_VERSION } from "../content/versions";
import { CARDS } from "../data";
import type { GameCard } from "../game";
import type {
  AbilityDefinition,
  CardPlayDefinition,
  ChoiceSpec,
  RuleAction,
  RuleDefinition,
  RuleProgram,
} from "./model";
import { provenanceForDefinition, validateDefinitionProvenance } from "./provenance";
import { ruleCardId } from "./catalogue-primitives";
import { abilityDefinitionsForCard, playDefinitionForCard } from "./catalogue-structure";
import {
  enhanceDeckInspectionAbilities,
  enhanceDeckInspectionPlayDefinition,
} from "./deck-inspection";

const FACTIONS: readonly GameCard["faction"][] = [
  "Aquos",
  "Aurelus",
  "Darkus",
  "Haos",
  "Pyrus",
  "Ventus",
];
const SINGULAR_NON_FACTION_BAKUGAN = /\b(?:a|an|one)\s+non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan\b/i;

const RULES_TEXT_NORMALIZATIONS: Partial<Record<string, string>> = {
  // The Battle Brawlers source row flattened Titan Nillious's visually
  // separated Core-condition and open-trigger lines into one sentence. Keep
  // the locked catalogue text intact, but compile the reviewed timing and
  // condition boundaries that are printed on the card.
  "bb-257": "[MS]: +200 [B]. When this opens, you may attach an additional BakuCore from the Field to Haos Titan Nillious. [FF]: +4 [Damage Rating].",
};

function cardForRules(card: GameCard): GameCard {
  const effect = RULES_TEXT_NORMALIZATIONS[ruleCardId(card)];
  return effect ? { ...card, effect } : card;
}

function nonFactionChoiceTiming(text: string): ChoiceSpec["timing"] {
  return /when you play this|when this opens|\bmay\b|\bSacrifice\b|\bBattle Mastery\b|\bVictor\s*[-:]|\bUnderdog\s*:|at (?:the )?end of (?:your |the )?turn/i.test(text)
    ? "resolve"
    : "announce";
}

function nonFactionTargetChoice(
  excludedFaction: GameCard["faction"],
  timing: ChoiceSpec["timing"],
): ChoiceSpec {
  return {
    id: "targetBakuganId",
    timing,
    selector: "chosen-bakugan",
    label: `Choose a non-${excludedFaction} Bakugan`,
    minimum: 1,
    maximum: 1,
    optional: false,
    chooser: "controller",
    visibility: "public",
    factions: FACTIONS.filter((faction) => faction !== excludedFaction),
    targetOwner: "any",
  };
}

function withChoice(choices: readonly ChoiceSpec[], selected: ChoiceSpec) {
  return choices.some((choice) => choice.id === selected.id && choice.timing === selected.timing)
    ? [...choices]
    : [...choices, selected];
}

function retargetSingularNonFactionActions(actions: readonly RuleAction[]): RuleAction[] {
  return actions.map((action) => {
    if (action.kind === "modify-stat" && action.scope === "all-bakugan") {
      return { ...action, scope: "target" };
    }
    if (action.kind === "conditional") {
      return {
        ...action,
        whenTrue: retargetSingularNonFactionActions(action.whenTrue),
        whenFalse: action.whenFalse
          ? retargetSingularNonFactionActions(action.whenFalse)
          : undefined,
      };
    }
    if (action.kind === "replacement") {
      return {
        ...action,
        replaceWith: retargetSingularNonFactionActions(action.replaceWith),
      };
    }
    if (action.kind === "sequence") {
      return {
        ...action,
        effects: retargetSingularNonFactionActions(action.effects),
      };
    }
    return action;
  });
}

function normalizeSingularNonFactionTargets(
  card: GameCard,
  play: CardPlayDefinition,
  abilities: AbilityDefinition[],
) {
  const cardMatch = card.effect.match(SINGULAR_NON_FACTION_BAKUGAN);
  let normalizedPlay = play;
  if (cardMatch) {
    const excludedFaction = cardMatch[1] as GameCard["faction"];
    const timing = nonFactionChoiceTiming(card.effect);
    if (timing === "announce") {
      normalizedPlay = {
        ...play,
        choices: withChoice(play.choices, nonFactionTargetChoice(excludedFaction, timing)),
      };
    }
  }

  const normalizedAbilities = abilities.map((ability) => ({
    ...ability,
    instructions: ability.instructions.map((instruction) => {
      const match = instruction.sourceText.match(SINGULAR_NON_FACTION_BAKUGAN);
      if (!match) return instruction;
      const excludedFaction = match[1] as GameCard["faction"];
      const timing = nonFactionChoiceTiming(instruction.sourceText);
      const actions = retargetSingularNonFactionActions(instruction.actions);
      return {
        ...instruction,
        effects: actions,
        actions,
        choices: withChoice(
          instruction.choices,
          nonFactionTargetChoice(excludedFaction, timing),
        ),
      };
    }),
  }));

  return { play: normalizedPlay, abilities: normalizedAbilities };
}

function definitionForCard(card: GameCard): RuleDefinition {
  const rulesCard = cardForRules(card);
  const rawAbilities = enhanceDeckInspectionAbilities(rulesCard, abilityDefinitionsForCard(rulesCard));
  const rawPlay = enhanceDeckInspectionPlayDefinition(rulesCard, playDefinitionForCard(rulesCard));
  const normalized = normalizeSingularNonFactionTargets(rulesCard, rawPlay, rawAbilities);
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
    play: normalized.play,
    abilities: normalized.abilities,
    provenance: provenanceForDefinition(card, normalized.abilities),
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
