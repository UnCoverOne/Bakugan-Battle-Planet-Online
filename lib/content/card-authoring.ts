import type { GameCard } from "../game";
import { authorRuleDefinitionForCard } from "../rules/catalogue";
import type { RuleAction, RuleDefinition } from "../rules/model";
import {
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  RULES_PROFILE_VERSION,
} from "./versions";
import {
  CONTROLLED_CATALOGUE,
  textFingerprint,
  type ControlledCardRecord,
} from "./catalogue";
import { constructionIdentityForCard } from "./construction-identity";

export const CARD_EDITOR_VERSION = "card-editor-v1" as const;

export type CardDraft = Omit<ControlledCardRecord, "id"> & { id: string };
export type CardAuthoringSeverity = "error" | "warning" | "info";
export type CardAuthoringIssue = {
  severity: CardAuthoringSeverity;
  code: string;
  field: keyof CardDraft | "rules" | "provenance" | "catalogue";
  message: string;
};

export type DraftRuleDefinition = Omit<RuleDefinition, "implementationStatus"> & {
  implementationStatus: "draft";
};

export type CardAuthoringPatch = {
  operation: "replace" | "add";
  cardId: string;
  baseFingerprint?: string;
  changedFields: Partial<CardDraft>;
};

export type CardAuthoringBundle = {
  editorVersion: typeof CARD_EDITOR_VERSION;
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  catalogueVersion: typeof CARD_CATALOGUE_VERSION;
  rulesVersion: typeof RULES_PROFILE_VERSION;
  exportedAt: string;
  baseCardId?: string;
  card: CardDraft;
  patch: CardAuthoringPatch;
  generatedDefinition?: DraftRuleDefinition;
  issues: CardAuthoringIssue[];
  goldenTestTemplate: string;
  fingerprint: string;
};

const FACTIONS = ["Aquos", "Pyrus", "Darkus", "Haos", "Ventus", "Aurelus"] as const;
const CARD_TYPES = ["Action", "Flip", "Hero", "Evo", "Character"] as const;
const CORE_TYPES = ["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"] as const;

const clone = <T>(value: T): T => structuredClone(value);
const slugify = (value: string) => value
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

function issue(
  severity: CardAuthoringSeverity,
  code: string,
  field: CardAuthoringIssue["field"],
  message: string,
): CardAuthoringIssue {
  return { severity, code, field, message };
}

export function cardDraftFromCatalogue(card: ControlledCardRecord): CardDraft {
  return clone(card) as CardDraft;
}

export function emptyCardDraft(number = 1): CardDraft {
  const safeNumber = Number.isInteger(number) && number > 0 ? number : 1;
  const displayName = "Untitled Card";
  const effect = "";
  return {
    id: `bb-${safeNumber}`,
    number: safeNumber,
    name: displayName,
    displayName,
    constructionIdentity: constructionIdentityForCard({ displayName, effect }),
    faction: "Aquos",
    factions: ["Aquos"],
    type: "Action",
    cost: 0,
    rarity: "Common",
    effect,
    mechanics: [],
    bPower: null,
    damage: null,
    coreTypes: [],
    evolvesFrom: null,
    art: "/assets/cards/card-missing.svg",
    source: "Card editor draft",
    hasProvidedScan: false,
    slug: `untitled-card-${safeNumber}`,
  };
}

export function normalizeCardDraft(value: unknown): CardDraft {
  const candidate = value && typeof value === "object" ? value as Partial<CardDraft> : {};
  const number = Number.isInteger(candidate.number) ? Number(candidate.number) : 1;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "Untitled Card";
  const displayName = typeof candidate.displayName === "string" && candidate.displayName.trim()
    ? candidate.displayName.trim()
    : name;
  const effect = typeof candidate.effect === "string"
    ? candidate.effect.replace(/\r\n/g, "\n")
    : "";
  const faction = FACTIONS.includes(candidate.faction as typeof FACTIONS[number])
    ? candidate.faction as typeof FACTIONS[number]
    : "Aquos";
  const factions = Array.isArray(candidate.factions)
    ? [...new Set(candidate.factions.filter((item): item is typeof FACTIONS[number] => FACTIONS.includes(item as typeof FACTIONS[number])))]
    : [faction];
  if (!factions.includes(faction)) factions.unshift(faction);
  const type = CARD_TYPES.includes(candidate.type as typeof CARD_TYPES[number])
    ? candidate.type as typeof CARD_TYPES[number]
    : "Action";
  const cost = candidate.cost === "X" ? "X" : Number.isInteger(candidate.cost) ? Math.max(0, Number(candidate.cost)) : 0;
  const coreTypes = Array.isArray(candidate.coreTypes)
    ? [...new Set(candidate.coreTypes.filter((item): item is typeof CORE_TYPES[number] => CORE_TYPES.includes(item as typeof CORE_TYPES[number])))]
    : [];
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `bb-${number}`,
    number,
    name,
    displayName,
    constructionIdentity: constructionIdentityForCard({ displayName, effect }),
    faction,
    factions,
    type,
    cost,
    rarity: typeof candidate.rarity === "string" && candidate.rarity.trim() ? candidate.rarity.trim() : "Common",
    effect,
    mechanics: Array.isArray(candidate.mechanics)
      ? [...new Set(candidate.mechanics.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : [],
    bPower: candidate.bPower == null || String(candidate.bPower).trim() === "" ? null : Number(candidate.bPower),
    damage: candidate.damage == null || String(candidate.damage).trim() === "" ? null : Number(candidate.damage),
    coreTypes,
    evolvesFrom: typeof candidate.evolvesFrom === "string" && candidate.evolvesFrom.trim() ? candidate.evolvesFrom.trim() : null,
    art: typeof candidate.art === "string" && candidate.art.trim() ? candidate.art.trim() : "/assets/cards/card-missing.svg",
    source: typeof candidate.source === "string" && candidate.source.trim() ? candidate.source.trim() : "Card editor draft",
    hasProvidedScan: Boolean(candidate.hasProvidedScan),
    slug: typeof candidate.slug === "string" && candidate.slug.trim() ? candidate.slug.trim() : slugify(displayName),
  };
}

function flattenActions(actions: readonly RuleAction[], target: RuleAction[] = []) {
  for (const action of actions) {
    target.push(action);
    if (action.kind === "conditional") {
      flattenActions(action.whenTrue, target);
      flattenActions(action.whenFalse ?? [], target);
    } else if (action.kind === "replacement") flattenActions(action.replaceWith, target);
    else if (action.kind === "sequence") flattenActions(action.effects, target);
  }
  return target;
}

function asGameCard(draft: CardDraft): GameCard {
  return {
    ...clone(draft),
    id: `authoring-instance:${draft.id}`,
    catalogId: draft.id,
  } as GameCard;
}

export function compileCardDraft(draft: CardDraft): DraftRuleDefinition {
  return authorRuleDefinitionForCard(asGameCard(draft));
}

export function validateCardDraft(
  draftInput: CardDraft,
  options: { baseCardId?: string; catalogue?: readonly ControlledCardRecord[] } = {},
) {
  const draft = normalizeCardDraft(draftInput);
  const catalogue = options.catalogue ?? CONTROLLED_CATALOGUE;
  const issues: CardAuthoringIssue[] = [];
  if (!/^bb-[1-9]\d*$/.test(draft.id)) issues.push(issue("error", "CARD_ID_FORMAT", "id", "Use a canonical ID such as bb-93."));
  if (!Number.isInteger(draft.number) || draft.number < 1 || draft.number > 374) {
    issues.push(issue("error", "CARD_NUMBER_RANGE", "number", "Battle Brawlers collector numbers must be integers from 1 through 374."));
  }
  if (draft.id !== `bb-${draft.number}`) issues.push(issue("error", "CARD_ID_NUMBER_MISMATCH", "id", `The ID must be bb-${draft.number}.`));
  if (!draft.name.trim()) issues.push(issue("error", "NAME_REQUIRED", "name", "Internal name is required."));
  if (!draft.displayName.trim()) issues.push(issue("error", "DISPLAY_NAME_REQUIRED", "displayName", "Display name is required."));
  if (!draft.constructionIdentity.trim()) issues.push(issue("error", "CONSTRUCTION_IDENTITY_REQUIRED", "constructionIdentity", "Construction identity is required."));
  if (!FACTIONS.includes(draft.faction)) issues.push(issue("error", "FACTION_INVALID", "faction", "Choose a supported Battle Planet faction."));
  if (!draft.factions.length || !draft.factions.includes(draft.faction)) issues.push(issue("error", "PRIMARY_FACTION_MISSING", "factions", "The faction list must include the primary faction."));
  if (!CARD_TYPES.includes(draft.type)) issues.push(issue("error", "CARD_TYPE_INVALID", "type", "Choose a supported card type."));
  if (draft.cost !== "X" && (!Number.isInteger(draft.cost) || draft.cost < 0)) issues.push(issue("error", "COST_INVALID", "cost", "Energy cost must be a non-negative integer or X."));
  if (!draft.rarity.trim()) issues.push(issue("error", "RARITY_REQUIRED", "rarity", "Rarity is required."));
  if (!Array.isArray(draft.mechanics)) issues.push(issue("error", "MECHANICS_INVALID", "mechanics", "Mechanics must be an array."));
  if (!Array.isArray(draft.coreTypes) || draft.coreTypes.some((core) => !CORE_TYPES.includes(core))) issues.push(issue("error", "CORE_TYPE_INVALID", "coreTypes", "Use only official BakuCore types."));
  if (!draft.art.startsWith("/assets/")) issues.push(issue("error", "ART_PATH_INVALID", "art", "Artwork must use a repository /assets/ path."));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug ?? "")) issues.push(issue("error", "SLUG_INVALID", "slug", "Slug must contain lowercase letters, numbers, and single hyphens."));

  const otherCards = catalogue.filter((card) => card.id !== options.baseCardId);
  if (otherCards.some((card) => card.id === draft.id)) issues.push(issue("error", "DUPLICATE_CARD_ID", "id", `${draft.id} already belongs to another catalogue record.`));
  if (otherCards.some((card) => card.number === draft.number)) issues.push(issue("error", "DUPLICATE_CARD_NUMBER", "number", `Collector number ${draft.number} already belongs to another catalogue record.`));
  if (otherCards.some((card) => card.slug === draft.slug)) issues.push(issue("error", "DUPLICATE_CARD_SLUG", "slug", `${draft.slug} is already used by another card.`));

  if (["Character", "Evo"].includes(draft.type)) {
    if (!Number.isFinite(draft.bPower) || Number(draft.bPower) < 0) issues.push(issue("error", "BPOWER_REQUIRED", "bPower", `${draft.type} cards require non-negative B-Power.`));
    if (!Number.isFinite(draft.damage) || Number(draft.damage) < 0) issues.push(issue("error", "DAMAGE_REQUIRED", "damage", `${draft.type} cards require non-negative Damage Rating.`));
  } else if (draft.bPower != null || draft.damage != null) {
    issues.push(issue("warning", "UNUSED_COMBAT_STATS", "bPower", `${draft.type} cards normally leave B-Power and Damage Rating empty.`));
  }
  if (draft.type === "Character" && draft.coreTypes.length !== 2) issues.push(issue("warning", "CHARACTER_CORE_COUNT", "coreTypes", "Character printings normally show exactly two BakuCore indicators."));
  if (draft.type === "Evo" && !draft.evolvesFrom) issues.push(issue("error", "EVO_IDENTITY_REQUIRED", "evolvesFrom", "Evo cards require the canonical Character name they evolve from."));
  if (draft.type !== "Evo" && draft.evolvesFrom) issues.push(issue("warning", "UNUSED_EVO_IDENTITY", "evolvesFrom", "Only Evo cards use evolvesFrom."));

  let generatedDefinition: DraftRuleDefinition | undefined;
  if (!issues.some((item) => item.severity === "error")) {
    try {
      generatedDefinition = compileCardDraft(draft);
      const actions = generatedDefinition.abilities.flatMap((ability) => ability.instructions.flatMap((instruction) => flattenActions(instruction.effects)));
      if (actions.some((action) => action.kind === "unsupported")) issues.push(issue("error", "UNSUPPORTED_RULE_NODE", "rules", "The compiler produced an unsupported rule node."));
      const meaningful = actions.some((action) => action.kind !== "sequence" || action.effects.length > 0);
      if (draft.effect.trim() && !meaningful) issues.push(issue("warning", "NO_EXECUTABLE_RULE_ACTION", "rules", "The printed effect did not compile into an executable typed action. Add a bespoke implementation before review."));
      if (!generatedDefinition.provenance.citations.length) issues.push(issue("error", "PROVENANCE_MISSING", "provenance", "The generated definition has no source citation."));
      else issues.push(issue("info", "HUMAN_REVIEW_REQUIRED", "provenance", "Generated provenance is intentionally unreviewed until the exported change is approved in source control."));
    } catch (error) {
      issues.push(issue("error", "RULE_COMPILER_FAILED", "rules", error instanceof Error ? error.message : String(error)));
    }
  }
  return { draft, issues, generatedDefinition };
}

function comparableCard(card: CardDraft | ControlledCardRecord) {
  const copy = clone(card) as Record<string, unknown>;
  delete copy.hasProvidedScan;
  return copy;
}

export function createCardAuthoringPatch(draft: CardDraft, baseCardId?: string): CardAuthoringPatch {
  const base = baseCardId ? CONTROLLED_CATALOGUE.find((card) => card.id === baseCardId) : undefined;
  if (!base) return { operation: "add", cardId: draft.id, changedFields: clone(draft) };
  const changedFields: Partial<CardDraft> = {};
  const left = comparableCard(base);
  const right = comparableCard(draft);
  for (const key of Object.keys(right) as Array<keyof CardDraft>) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) changedFields[key] = clone(draft[key]) as never;
  }
  return {
    operation: "replace",
    cardId: draft.id,
    baseFingerprint: textFingerprint(JSON.stringify(left)),
    changedFields,
  };
}

export function goldenTestTemplateForCard(draft: CardDraft) {
  return `test("card-golden:${draft.id} ${draft.displayName}", () => {\n  const card = CARDS.find((candidate) => candidate.catalogId === "${draft.id}");\n  assert.ok(card, "${draft.id} must exist in the controlled catalogue");\n  const definition = ruleDefinitionForCard(card);\n  assert.equal(definition.sourceText, card.effect);\n  // Arrange one ordinary resolution and one edge case before marking this card reviewed.\n  assert.ok(definition.abilities.length > 0);\n});`;
}

export function createCardAuthoringBundle(draftInput: CardDraft, baseCardId?: string): CardAuthoringBundle {
  const validation = validateCardDraft(draftInput, { baseCardId });
  const payload = {
    editorVersion: CARD_EDITOR_VERSION,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    catalogueVersion: CARD_CATALOGUE_VERSION,
    rulesVersion: RULES_PROFILE_VERSION,
    baseCardId,
    card: validation.draft,
    patch: createCardAuthoringPatch(validation.draft, baseCardId),
    generatedDefinition: validation.generatedDefinition,
    issues: validation.issues,
    goldenTestTemplate: goldenTestTemplateForCard(validation.draft),
  };
  return {
    ...payload,
    exportedAt: new Date().toISOString(),
    fingerprint: textFingerprint(JSON.stringify(payload)),
  };
}

export function serializeCardAuthoringBundle(bundle: CardAuthoringBundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseCardAuthoringBundle(value: string | unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object") throw new Error("Card authoring input must be a JSON object.");
  const candidate = parsed as Partial<CardAuthoringBundle> & Partial<CardDraft>;
  const card = "card" in candidate ? candidate.card : candidate;
  const draft = normalizeCardDraft(card);
  const baseCardId = typeof candidate.baseCardId === "string"
    ? candidate.baseCardId
    : CONTROLLED_CATALOGUE.some((item) => item.id === draft.id)
      ? draft.id
      : undefined;
  return createCardAuthoringBundle(draft, baseCardId);
}
