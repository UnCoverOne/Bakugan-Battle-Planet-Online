export type DeckValidationSection = "identity" | "team" | "cores" | "mainDeck";

export type DeckValidationIssueCode =
  | "identity.name_required"
  | "team.exactly_three"
  | "team.distinct"
  | "team.unknown_character"
  | "cores.exactly_six"
  | "cores.unknown_core"
  | "cores.indicators_mismatch"
  | "cores.copy_limit"
  | "main_deck.exactly_forty"
  | "main_deck.exactly_fifty"
  | "main_deck.unknown_card"
  | "main_deck.faction_mismatch"
  | "main_deck.copy_limit"
  | "main_deck.ranked_restriction";

export type DeckValidationIssue = {
  code: DeckValidationIssueCode;
  section: DeckValidationSection;
  path: "name" | "bakuganIds" | "coreIds" | "cardIds";
  message: string;
  cardId?: string;
  expected?: number | string[];
  actual?: number | string[];
};

export type ValidatableDeck = {
  name?: string;
  format?: "standard" | "singleton" | "competitive";
  bakuganIds: string[];
  coreIds: string[];
  cardIds: string[];
};

export type ValidationCard = {
  catalogId: string;
  name?: string;
  displayName?: string;
  effect?: string;
  constructionIdentity?: string;
  faction?: string;
  factions?: string[];
};

export type ValidationCharacter = {
  id: string;
  faction: string;
  character?: { coreTypes?: string[]; factions?: string[] };
  coreTypes?: string[];
};

export type ValidationCore = {
  id: string;
  type: string;
};

export type DeckValidationCatalogue = {
  cards: ReadonlyMap<string, ValidationCard>;
  characters: ReadonlyMap<string, ValidationCharacter>;
  cores: ReadonlyMap<string, ValidationCore>;
};

export type DeckValidationResult = {
  isLegal: boolean;
  issues: DeckValidationIssue[];
  bySection: Record<DeckValidationSection, DeckValidationIssue[]>;
  counts: { cards: number; characters: number; cores: number };
  teamFactions: string[];
  requiredCoreTypes: string[];
  selectedCoreTypes: string[];
};

export type DeckRestriction = {
  constructionIdentity: string;
  limit: 0 | 1 | 2;
  reason?: string;
};

export type DeckValidationOptions = {
  restrictions?: readonly DeckRestriction[];
};

const sectionOrder: DeckValidationSection[] = ["identity", "team", "cores", "mainDeck"];

function issue(
  code: DeckValidationIssueCode,
  section: DeckValidationSection,
  path: DeckValidationIssue["path"],
  message: string,
  detail: Partial<Omit<DeckValidationIssue, "code" | "section" | "path" | "message">> = {},
): DeckValidationIssue {
  return { code, section, path, message, ...detail };
}

function frequencies(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sameMultiset(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Pure construction-rules engine shared by editing, play setup, copying,
 * persistence boundaries, and match creation. Consumers may choose how to
 * present or enforce a result, but must not recreate these rules.
 */
export function validateDeckConstruction(
  deck: ValidatableDeck,
  catalogue: DeckValidationCatalogue,
  options: DeckValidationOptions = {},
): DeckValidationResult {
  const issues: DeckValidationIssue[] = [];
  const format = deck.format === "singleton" || deck.format === "competitive" ? deck.format : "standard";
  const cardCopyLimit = format === "singleton" ? 1 : 3;
  const coreCopyLimit = format === "singleton" ? 1 : 6;

  if (!deck.name?.trim()) {
    issues.push(issue("identity.name_required", "identity", "name", "Give this deck a name before saving."));
  }

  const characters = deck.bakuganIds
    .map((id) => catalogue.characters.get(id))
    .filter((value): value is ValidationCharacter => Boolean(value));
  const unknownCharacters = deck.bakuganIds.filter((id) => !catalogue.characters.has(id));
  if (deck.bakuganIds.length !== 3) {
    issues.push(issue("team.exactly_three", "team", "bakuganIds", "Bakugan Team must contain exactly three Character cards.", { expected: 3, actual: deck.bakuganIds.length }));
  }
  if (new Set(deck.bakuganIds).size !== deck.bakuganIds.length) {
    issues.push(issue("team.distinct", "team", "bakuganIds", "Each Character card in the Bakugan Team must be distinct."));
  }
  if (unknownCharacters.length) {
    issues.push(issue("team.unknown_character", "team", "bakuganIds", "Every Bakugan Team ID must identify a Character card in the catalogue.", { actual: unknownCharacters }));
  }

  const cores = deck.coreIds
    .map((id) => catalogue.cores.get(id))
    .filter((value): value is ValidationCore => Boolean(value));
  const unknownCores = deck.coreIds.filter((id) => !catalogue.cores.has(id));
  if (deck.coreIds.length !== 6) {
    issues.push(issue("cores.exactly_six", "cores", "coreIds", "BakuCore configuration must contain exactly six BakuCores.", { expected: 6, actual: deck.coreIds.length }));
  }
  if (unknownCores.length) {
    issues.push(issue("cores.unknown_core", "cores", "coreIds", "Every BakuCore ID must identify a BakuCore in the catalogue.", { actual: unknownCores }));
  }
  const overCoreLimit = [...frequencies(deck.coreIds)].find(([, count]) => count > coreCopyLimit);
  if (overCoreLimit) {
    issues.push(issue(
      "cores.copy_limit",
      "cores",
      "coreIds",
      `${format === "singleton" ? "Singleton" : "Standard"} allows no more than ${coreCopyLimit} ${coreCopyLimit === 1 ? "copy" : "copies"} of a BakuCore.`,
      { cardId: overCoreLimit[0], expected: coreCopyLimit, actual: overCoreLimit[1] },
    ));
  }
  const requiredCoreTypes = characters.flatMap((character) => character.character?.coreTypes ?? character.coreTypes ?? []);
  const selectedCoreTypes = cores.map((core) => core.type);
  if (
    characters.length === deck.bakuganIds.length
    && cores.length === deck.coreIds.length
    && !sameMultiset(requiredCoreTypes, selectedCoreTypes)
  ) {
    issues.push(issue(
      "cores.indicators_mismatch",
      "cores",
      "coreIds",
      "BakuCore types must exactly match the six indicators on the selected Character cards.",
      { expected: [...requiredCoreTypes].sort(), actual: [...selectedCoreTypes].sort() },
    ));
  }

  const cards = deck.cardIds
    .map((id) => catalogue.cards.get(id))
    .filter((value): value is ValidationCard => Boolean(value));
  const unknownCards = deck.cardIds.filter((id) => !catalogue.cards.has(id));
  const requiredCardCount = format === "competitive" ? 50 : 40;
  if (deck.cardIds.length !== requiredCardCount) {
    issues.push(issue(
      format === "competitive" ? "main_deck.exactly_fifty" : "main_deck.exactly_forty",
      "mainDeck",
      "cardIds",
      `Main Deck must contain exactly ${requiredCardCount} cards.`,
      { expected: requiredCardCount, actual: deck.cardIds.length },
    ));
  }
  if (unknownCards.length) {
    issues.push(issue("main_deck.unknown_card", "mainDeck", "cardIds", "Every Main Deck ID must identify a card in the catalogue.", { actual: unknownCards }));
  }

  const teamFactions = [...new Set(characters.flatMap((character) => character.character?.factions?.length ? character.character.factions : [character.faction]))];
  const incompatible = cards.find((card) => {
    const factions = card.factions?.length ? card.factions : card.faction ? [card.faction] : [];
    return !factions.every((faction) => teamFactions.includes(faction));
  });
  if (incompatible) {
    issues.push(issue(
      "main_deck.faction_mismatch",
      "mainDeck",
      "cardIds",
      "Every Main Deck card must share a faction with at least one Bakugan on the team.",
      { cardId: incompatible.catalogId },
    ));
  }

  const constructionKeys = cards.map((card) => (
    card.constructionIdentity
    ?? `${card.name ?? card.displayName ?? card.catalogId}|${card.effect ?? ""}`
  ));
  const overCardLimit = [...frequencies(constructionKeys)].find(([, count]) => count > cardCopyLimit);
  if (overCardLimit) {
    const offendingIndex = constructionKeys.indexOf(overCardLimit[0]);
    issues.push(issue(
      "main_deck.copy_limit",
      "mainDeck",
      "cardIds",
      `${format === "singleton" ? "Singleton" : format === "competitive" ? "Competitive" : "Standard"} allows no more than ${cardCopyLimit} ${cardCopyLimit === 1 ? "copy" : "copies"} of a Main Deck card.`,
      { cardId: cards[offendingIndex]?.catalogId, expected: cardCopyLimit, actual: overCardLimit[1] },
    ));
  }

  if (format === "competitive") {
    const restrictions = new Map(options.restrictions?.map((restriction) => [restriction.constructionIdentity, restriction]) ?? []);
    for (const [constructionIdentity, count] of frequencies(constructionKeys)) {
      const restriction = restrictions.get(constructionIdentity);
      if (!restriction || count <= restriction.limit) continue;
      const offendingIndex = constructionKeys.indexOf(constructionIdentity);
      const card = cards[offendingIndex];
      const label = card?.displayName ?? card?.name ?? card?.catalogId ?? "This card";
      issues.push(issue(
        "main_deck.ranked_restriction",
        "mainDeck",
        "cardIds",
        restriction.limit === 0
          ? `${label} is banned in Competitive.`
          : `${label} is restricted to ${restriction.limit} ${restriction.limit === 1 ? "copy" : "copies"} in Competitive.`,
        { cardId: card?.catalogId, expected: restriction.limit, actual: count },
      ));
    }
  }

  const bySection = Object.fromEntries(sectionOrder.map((section) => [
    section,
    issues.filter((candidate) => candidate.section === section),
  ])) as DeckValidationResult["bySection"];

  return {
    isLegal: issues.length === 0,
    issues,
    bySection,
    counts: { cards: deck.cardIds.length, characters: deck.bakuganIds.length, cores: deck.coreIds.length },
    teamFactions,
    requiredCoreTypes,
    selectedCoreTypes,
  };
}

export function deckValidationMessages(result: DeckValidationResult) {
  return result.issues.map((candidate) => candidate.message);
}
