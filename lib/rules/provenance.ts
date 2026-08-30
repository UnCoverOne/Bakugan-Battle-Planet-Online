import rulesSourcesJson from "../../content/rules-sources.json";
import type { GameCard } from "../game";
import type {
  AbilityDefinition,
  RuleAction,
  RuleCitation,
  RuleDefinition,
  RuleProvenance,
} from "./model";

export type RulesSource = {
  id: string;
  title: string;
  kind: "official-ruling" | "comprehensive-rules" | "official-glossary" | "printed-card" | "product-policy";
  priority: number;
  scope: string;
};

export const RULES_SOURCES = Object.freeze(
  (rulesSourcesJson as RulesSource[])
    .map((source) => Object.freeze({ ...source }))
    .sort((left, right) => right.priority - left.priority),
);
export const RULES_SOURCE_BY_ID = new Map(RULES_SOURCES.map((source) => [source.id, source]));

function actionKinds(actions: readonly RuleAction[], target = new Set<RuleAction["kind"]>()) {
  for (const action of actions) {
    target.add(action.kind);
    if (action.kind === "conditional") {
      actionKinds(action.whenTrue, target);
      actionKinds(action.whenFalse ?? [], target);
    } else if (action.kind === "replacement") actionKinds(action.replaceWith, target);
    else if (action.kind === "sequence") actionKinds(action.effects, target);
  }
  return target;
}

function abilityKinds(abilities: readonly AbilityDefinition[]) {
  return actionKinds(abilities.flatMap((ability) => ability.instructions.flatMap((instruction) => instruction.effects)));
}

function citation(sourceId: string, locator: string, note?: string): RuleCitation {
  return { sourceId, locator, note };
}

export function provenanceForDefinition(card: GameCard, abilities: readonly AbilityDefinition[]): RuleProvenance {
  const kinds = abilityKinds(abilities);
  const citations: RuleCitation[] = [
    citation("bp-card-printing", card.catalogId || `bb-${card.number}`, "Canonical printed characteristics and effect text."),
  ];

  if (kinds.has("trigger")) citations.push(citation("bp-complete-rulebook", "Triggered abilities and the Batch", "Trigger creation and resolution use the comprehensive timing rules."));
  if (kinds.has("replacement") || [...abilities].some((ability) => ability.instructions.some((instruction) => instruction.effects.some((effect) => effect.kind === "conditional" && effect.replacement)))) {
    citations.push(citation("bp-glossary", "Instead / replacement effects", "The replaced branch does not resolve in addition to the replacement."));
  }
  if (kinds.has("negate") || kinds.has("copy")) citations.push(citation("bp-public-rulings", "Negate and copy rulings", "Batch identity, source-zone handling and independent selections."));
  if (kinds.has("continuous") || kinds.has("grant-keyword")) citations.push(citation("bp-complete-rulebook", "Continuous effects and keyword rules", "Characteristic layers and protection are recalculated from active sources."));
  if (kinds.has("cost") || card.cost === "X" || /free|costs? .* less|Sacrifice/i.test(card.effect)) citations.push(citation("bp-complete-rulebook", "Playing cards and paying costs", "Announcement, payment, additional costs and FrostStrike are resolved before the object enters the Batch."));
  if (card.type === "Evo") citations.push(citation("bp-public-rulings", "Evo identity ruling", "Evo legality uses the specific canonical Character identity."));
  if (card.type === "Flip" || card.type === "Flip Hero") citations.push(citation("bp-complete-rulebook", "Damage Step and Flip cards", "A played Flip uses the normal Batch and priority procedure."));
  if (/BakuCore|\[(?:FT|FF|SD|MS|HE)\]/i.test(card.effect)) citations.push(citation("bp-complete-rulebook", "BakuCore attachment and Character abilities"));
  if (/ShadowStrike/i.test(card.effect)) citations.push(citation("bp-complete-rulebook", "ShadowStrike", "Reductions from cards and BakuCores are filtered while ShadowStrike is active."));
  if (/FrostStrike/i.test(card.effect)) citations.push(citation("bp-complete-rulebook", "FrostStrike", "The attacking Bakugan's current FrostStrike modifies Flip costs."));
  if (/roll|accuracy|double core/i.test(card.effect)) citations.push(citation("bbpo-digital-policy", "Digital rolling profile"));

  const unique = citations.filter((item, index, values) => values.findIndex((candidate) => candidate.sourceId === item.sourceId && candidate.locator === item.locator) === index);
  return {
    authorityOrder: RULES_SOURCES.map((source) => source.id),
    citations: unique,
    reviewed: true,
  };
}

export function validateDefinitionProvenance(definition: RuleDefinition) {
  const errors: string[] = [];
  if (!definition.provenance.reviewed) errors.push(`${definition.cardId}: provenance is not marked reviewed.`);
  if (!definition.provenance.citations.some((item) => item.sourceId === "bp-card-printing")) errors.push(`${definition.cardId}: missing card-printing provenance.`);
  for (const item of definition.provenance.citations) {
    if (!RULES_SOURCE_BY_ID.has(item.sourceId)) errors.push(`${definition.cardId}: unknown rules source ${item.sourceId}.`);
    if (!item.locator.trim()) errors.push(`${definition.cardId}: empty provenance locator for ${item.sourceId}.`);
  }
  const kinds = abilityKinds(definition.abilities);
  const nonObvious = [...kinds].some((kind) => ["trigger", "replacement", "continuous", "negate", "copy", "cost", "play"].includes(kind));
  if (nonObvious && !definition.provenance.citations.some((item) => item.sourceId !== "bp-card-printing")) {
    errors.push(`${definition.cardId}: non-obvious implementation lacks a rules authority citation.`);
  }
  return errors;
}
