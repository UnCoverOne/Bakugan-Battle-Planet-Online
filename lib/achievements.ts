import { CORES, deckIsLegal, type DeckRecord } from "./data";
import {
  achievementDeckSignature,
  distinctDeckEvidence,
  normalizeAchievementProgress,
  observeAchievementDecks,
  type AchievementProgress,
  type MonoMasteryFaction,
} from "./achievement-progress";
import type { LifetimeMatchStats, MatchResultRecord } from "./persistence";
import { accountStatMatches } from "./match-statistics";

export const ACHIEVEMENT_CATEGORIES = [
  "Arsenal",
  "Arena",
  "Brawler Network",
  "Compendium",
] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_CATEGORY_DETAILS: Record<
  AchievementCategory,
  { glyph: string; color: string; description: string }
> = {
  Arsenal: {
    glyph: "▤",
    color: "#f3b44f",
    description: "Build legal decks and master the pieces that make them work.",
  },
  Arena: {
    glyph: "⚔",
    color: "#ef6f61",
    description: "Prove your skill through victories, formats, Ranked play, and faction mastery.",
  },
  "Brawler Network": {
    glyph: "◎",
    color: "#5bd7ee",
    description: "Share strategies and connect with Brawlers across the Battle Planet.",
  },
  Compendium: {
    glyph: "◇",
    color: "#a88cf2",
    description: "Discover the Main Deck card pool by bringing cards into completed battles.",
  },
};

export const ACHIEVEMENT_METRICS = [
  "standardDecks",
  "singletonDecks",
  "competitiveDecks",
  "publishedDecks",
  "characterCards",
  "coreTypes",
  "matches",
  "wins",
  "bo1Wins",
  "bo3Wins",
  "rankedWins",
  "onlineGames",
  "onlineOpponents",
  "discoveredMainCards",
  "winningFactions",
  "monoPyrusWins",
  "monoAquosWins",
  "monoVentusWins",
  "monoHaosWins",
  "monoDarkusWins",
  "elementalMastery",

  // Legacy metric keys remain valid so deliberate Administrator configurations
  // remain readable while bundled achievements move to the new progression model.
  "decks",
  "completeDecks",
  "publicDecks",
  "privateDecks",
  "favouriteDecks",
  "describedDecks",
  "deckFactions",
  "trainingGames",
  "bo1Games",
  "bo3Games",
  "onlineWins",
  "uniqueMainCards",
  "uniqueCharacters",
  "uniqueCores",
] as const;

export type AchievementStatus = "completed" | "in-progress" | "locked";
export type AchievementMetricKey = (typeof ACHIEVEMENT_METRICS)[number];
export type AchievementCompletionMap = Record<string, string>;
export type AchievementTrainingRule = "allowed" | "blocked" | "ranked" | "derived" | null;

export type Achievement = {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  current: number;
  target: number;
  unlocked: boolean;
  status: AchievementStatus;
  completedAt: string | null;
  trainingRule: AchievementTrainingRule;
};

export type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  metric: AchievementMetricKey;
  target: number;
  trainingAllowed?: boolean;
};

type DefinitionOptions = { trainingAllowed?: boolean };

const definition = (
  id: string,
  name: string,
  description: string,
  category: AchievementCategory,
  metric: AchievementMetricKey,
  target: number,
  options: DefinitionOptions = {},
): AchievementDefinition => ({ id, name, description, category, metric, target, ...options });

/**
 * Stable IDs are intentionally reused where practical so existing reward
 * assignments and profile showcases migrate onto the redesigned catalogue.
 * Obsolete participation/grind rows are omitted entirely.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  // Arsenal — build and understand decks.
  definition("first-deck", "Battle Ready", "Build your first legal Standard deck.", "Arsenal", "standardDecks", 1),
  definition("deck-builder", "Arsenal Architect", "Build three distinct legal Standard decks.", "Arsenal", "standardDecks", 3),
  definition("singleton-start", "One of a Kind", "Build your first legal Singleton deck.", "Arsenal", "singletonDecks", 1),
  definition("complete-five", "Competitive Edge", "Build your first legal Competitive deck.", "Arsenal", "competitiveDecks", 1),
  definition("characters-twelve", "Bakugan Specialist", "Use nine different Character Cards across legal Standard decks.", "Arsenal", "characterCards", 9),
  definition("cores-twelve", "Core Specialist", "Use all five BakuCore types across legal Standard decks.", "Arsenal", "coreTypes", 5),

  // Brawler Network — publish and connect.
  definition("publisher", "Share the Strategy", "Publish one distinct legal Standard deck to the Public Deck Library.", "Brawler Network", "publishedDecks", 1),
  definition("decks-five", "Strategy Contributor", "Publish three distinct legal Standard decks.", "Brawler Network", "publishedDecks", 3),
  definition("public-five", "Community Architect", "Publish six distinct legal Standard decks.", "Brawler Network", "publishedDecks", 6),
  definition("decks-ten", "Planetwide Publisher", "Publish nine distinct legal Standard decks.", "Brawler Network", "publishedDecks", 9),
  definition("online", "Connected Brawler", "Complete your first online game.", "Brawler Network", "onlineGames", 1),
  definition("opponents-five", "Expanding Rivals", "Face five different online opponents.", "Brawler Network", "onlineOpponents", 5),
  definition("opponents-ten", "Known Across the Planet", "Face ten different online opponents.", "Brawler Network", "onlineOpponents", 10),

  // Arena — one introductory completion, then victories and mastery.
  definition("first-brawl", "Enter the Brawl", "Finish your first game.", "Arena", "matches", 1, { trainingAllowed: true }),
  definition("first-win", "Winning Start", "Win three games.", "Arena", "wins", 3, { trainingAllowed: true }),
  definition("wins-five", "Winning Form", "Win five games.", "Arena", "wins", 5, { trainingAllowed: true }),
  definition("veteran", "Seasoned Brawler", "Win ten games.", "Arena", "wins", 10, { trainingAllowed: true }),
  definition("wins-twenty-five", "Dominant Record", "Win twenty-five games.", "Arena", "wins", 25, { trainingAllowed: true }),
  definition("wins-fifty", "Battle Master", "Win fifty games.", "Arena", "wins", 50, { trainingAllowed: true }),
  definition("first-series", "Best of Three", "Win a best-of-three match.", "Arena", "bo3Wins", 1, { trainingAllowed: true }),
  definition("bo1-ten", "Quick Brawl Expert", "Win ten best-of-one games.", "Arena", "bo1Wins", 10, { trainingAllowed: true }),

  // Ranked victories remain Arena achievements, but Training can never satisfy them.
  definition("online-five", "Ranked Debut", "Win your first Ranked game.", "Arena", "rankedWins", 1, { trainingAllowed: false }),
  definition("online-ten", "Ranked Contender", "Win five Ranked games.", "Arena", "rankedWins", 5, { trainingAllowed: false }),
  definition("online-twenty-five", "Ranked Veteran", "Win ten Ranked games.", "Arena", "rankedWins", 10, { trainingAllowed: false }),
  definition("online-fifty", "Ranked Elite", "Win twenty-five Ranked games.", "Arena", "rankedWins", 25, { trainingAllowed: false }),
  definition("online-wins-five", "Ranked Master", "Win fifty Ranked games.", "Arena", "rankedWins", 50, { trainingAllowed: false }),

  // Faction mastery.
  definition("all-factions", "Battle Planet Coalition", "Win games while collectively representing all six factions across your winning Standard decks.", "Arena", "winningFactions", 6, { trainingAllowed: true }),
  definition("games-five", "Pyrus Mastery", "Win ten games with legal mono-Pyrus Standard decks.", "Arena", "monoPyrusWins", 10, { trainingAllowed: true }),
  definition("games-ten", "Aquos Mastery", "Win ten games with legal mono-Aquos Standard decks.", "Arena", "monoAquosWins", 10, { trainingAllowed: true }),
  definition("games-twenty-five", "Ventus Mastery", "Win ten games with legal mono-Ventus Standard decks.", "Arena", "monoVentusWins", 10, { trainingAllowed: true }),
  definition("games-fifty", "Haos Mastery", "Win ten games with legal mono-Haos Standard decks.", "Arena", "monoHaosWins", 10, { trainingAllowed: true }),
  definition("games-one-hundred", "Darkus Mastery", "Win ten games with legal mono-Darkus Standard decks.", "Arena", "monoDarkusWins", 10, { trainingAllowed: true }),
  definition("complete-ten", "Elemental Mastery", "Complete Battle Planet Coalition and all five mono-faction Mastery achievements.", "Arena", "elementalMastery", 1),

  // Compendium — cards become discovered through completed games with legal Standard decks.
  definition("cards-twenty-five", "Card Researcher", "Discover twenty-five different Main Deck cards.", "Compendium", "discoveredMainCards", 25),
  definition("cards-fifty", "Compendium Student", "Discover fifty different Main Deck cards.", "Compendium", "discoveredMainCards", 50),
  definition("cards-one-hundred", "Compendium Scholar", "Discover one hundred different Main Deck cards.", "Compendium", "discoveredMainCards", 100),
  definition("cards-two-hundred", "Living Catalogue", "Discover two hundred different Main Deck cards.", "Compendium", "discoveredMainCards", 200),
];

const TRAINING_CONFIGURABLE_METRICS = new Set<AchievementMetricKey>([
  "matches",
  "wins",
  "bo1Wins",
  "bo3Wins",
  "winningFactions",
  "monoPyrusWins",
  "monoAquosWins",
  "monoVentusWins",
  "monoHaosWins",
  "monoDarkusWins",
]);

export function achievementTrainingConfigurable(definition: AchievementDefinition) {
  return definition.category === "Arena" && TRAINING_CONFIGURABLE_METRICS.has(definition.metric);
}

export function achievementTrainingRule(definition: AchievementDefinition): AchievementTrainingRule {
  if (definition.category !== "Arena") return null;
  if (definition.metric === "rankedWins") return "ranked";
  if (definition.metric === "elementalMastery") return "derived";
  if (!achievementTrainingConfigurable(definition)) return "blocked";
  return definition.trainingAllowed ? "allowed" : "blocked";
}

type LegacyBundledDefinition = {
  name?: string;
  description?: string;
  category?: string;
  metric?: string;
  target?: number;
};

/**
 * D1 stores complete definition rows. Two bundled catalogue generations can be
 * present in existing accounts: the original five-category catalogue and the
 * intermediate four-path catalogue. Migration is deliberately whole-row based.
 * A row is upgraded only when every bundled field still matches a known default;
 * otherwise it is treated as an Administrator edit and its valid values survive.
 */
const PREVIOUS_BUNDLED_DEFINITION_FIELDS: Record<string, LegacyBundledDefinition> = {
  "first-deck": { description: "Build your first legal deck.", category: "Arsenal", metric: "completeDecks", target: 1 },
  "deck-builder": { description: "Build three distinct legal decks.", category: "Arsenal", metric: "completeDecks", target: 3 },
  "first-brawl": { description: "Finish your first non-Training game.", category: "Arena", metric: "matches", target: 1 },
  "first-win": { name: "First Victory", description: "Win your first non-Training game.", category: "Arena", metric: "wins", target: 1 },
  veteran: { description: "Win ten non-Training games.", category: "Arena", metric: "wins", target: 10 },
  publisher: { description: "Publish one distinct legal deck to the Public Deck Library.", category: "Arsenal", metric: "publicDecks", target: 1 },
  online: { description: "Complete an online game.", category: "Brawler Network", metric: "onlineGames", target: 1 },
  "first-series": { description: "Win a best-of-three match.", category: "Arena", metric: "bo3Wins", target: 1 },
  "singleton-start": { description: "Build a legal Singleton-format deck.", category: "Arsenal", metric: "singletonDecks", target: 1 },
  "decks-five": { name: "Strategy Contributor", description: "Publish three distinct legal decks.", category: "Arsenal", metric: "publicDecks", target: 3 },
  "public-five": { description: "Publish six distinct legal decks.", category: "Arsenal", metric: "publicDecks", target: 6 },
  "decks-ten": { name: "Planetwide Publisher", description: "Publish nine distinct legal decks.", category: "Arsenal", metric: "publicDecks", target: 9 },
  "complete-five": { name: "Loadout Specialist", description: "Build five distinct legal decks.", category: "Arsenal", metric: "completeDecks", target: 5 },
  "complete-ten": { name: "Master Architect", description: "Build ten distinct legal decks.", category: "Arsenal", metric: "completeDecks", target: 10 },
  "all-factions": { description: "Represent all six factions across your legal saved decks.", category: "Arsenal", metric: "deckFactions", target: 6 },
  "games-five": { name: "Finding Your Feet", description: "Finish five non-Training games.", category: "Arena", metric: "matches", target: 5 },
  "games-ten": { name: "Regular Brawler", description: "Finish ten non-Training games.", category: "Arena", metric: "matches", target: 10 },
  "games-twenty-five": { name: "Battle Tested", description: "Finish twenty-five non-Training games.", category: "Arena", metric: "matches", target: 25 },
  "games-fifty": { name: "Arena Veteran", description: "Finish fifty non-Training games.", category: "Arena", metric: "matches", target: 50 },
  "games-one-hundred": { name: "Century of Brawls", description: "Finish one hundred non-Training games.", category: "Arena", metric: "matches", target: 100 },
  "wins-five": { description: "Win five non-Training games.", category: "Arena", metric: "wins", target: 5 },
  "wins-twenty-five": { description: "Win twenty-five non-Training games.", category: "Arena", metric: "wins", target: 25 },
  "wins-fifty": { description: "Win fifty non-Training games.", category: "Arena", metric: "wins", target: 50 },
  "bo1-ten": { description: "Win ten best-of-one games.", category: "Arena", metric: "bo1Wins", target: 10 },
  "online-five": { name: "Network Regular", description: "Complete five online games.", category: "Brawler Network", metric: "onlineGames", target: 5 },
  "online-ten": { name: "Connected Competitor", description: "Complete ten online games.", category: "Brawler Network", metric: "onlineGames", target: 10 },
  "online-twenty-five": { name: "Online Veteran", description: "Complete twenty-five online games.", category: "Brawler Network", metric: "onlineGames", target: 25 },
  "online-fifty": { name: "Global Brawler", description: "Complete fifty online games.", category: "Brawler Network", metric: "onlineGames", target: 50 },
  "online-wins-five": { name: "Network Victor", description: "Win five online games.", category: "Brawler Network", metric: "onlineWins", target: 5 },
  "opponents-five": { category: "Brawler Network", metric: "onlineOpponents", target: 5 },
  "opponents-ten": { category: "Brawler Network", metric: "onlineOpponents", target: 10 },
  "cards-twenty-five": { description: "Use twenty-five different Main Deck cards across legal saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 25 },
  "cards-fifty": { description: "Use fifty different Main Deck cards across legal saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 50 },
  "cards-one-hundred": { description: "Use one hundred different Main Deck cards across legal saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 100 },
  "cards-two-hundred": { description: "Use two hundred different Main Deck cards across legal saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 200 },
  "characters-twelve": { description: "Use twelve different Character Cards across legal saved decks.", category: "Compendium", metric: "uniqueCharacters", target: 12 },
  "cores-twelve": { name: "Core Catalogue", description: "Use twelve different BakuCores across legal saved decks.", category: "Compendium", metric: "uniqueCores", target: 12 },
};

const ORIGINAL_BUNDLED_DEFINITION_FIELDS: Record<string, LegacyBundledDefinition> = {
  "first-deck": { name: "Battle Ready", description: "Complete your first 40-card, three-Character, six-Core deck.", category: "Deck Building", metric: "completeDecks", target: 1 },
  "deck-builder": { name: "Arsenal Architect", description: "Complete three decks.", category: "Deck Building", metric: "completeDecks", target: 3 },
  "first-brawl": { name: "Enter the Brawl", description: "Finish your first game.", category: "Getting Started", metric: "matches", target: 1 },
  "first-win": { name: "First Victory", description: "Win your first game.", category: "Battle", metric: "wins", target: 1 },
  veteran: { name: "Seasoned Brawler", description: "Win ten games.", category: "Battle", metric: "wins", target: 10 },
  publisher: { name: "Share the Strategy", description: "Publish a deck to the Public Deck Library.", category: "Deck Building", metric: "publicDecks", target: 1 },
  online: { name: "Connected Brawler", description: "Complete an online game.", category: "Online Play", metric: "onlineGames", target: 1 },
  "first-series": { name: "Best of Three", description: "Complete a best-of-three match.", category: "Getting Started", metric: "bo3Games", target: 1 },
  "singleton-start": { name: "One of a Kind", description: "Save a Singleton-format deck.", category: "Getting Started", metric: "singletonDecks", target: 1 },
  "decks-five": { name: "Prepared for Anything", description: "Save five decks.", category: "Deck Building", metric: "decks", target: 5 },
  "decks-ten": { name: "Vault Keeper", description: "Save ten decks.", category: "Deck Building", metric: "decks", target: 10 },
  "complete-five": { name: "Loadout Specialist", description: "Complete five legal-sized decks.", category: "Deck Building", metric: "completeDecks", target: 5 },
  "complete-ten": { name: "Master Architect", description: "Complete ten legal-sized decks.", category: "Deck Building", metric: "completeDecks", target: 10 },
  "public-five": { name: "Community Architect", description: "Publish five decks.", category: "Deck Building", metric: "publicDecks", target: 5 },
  "all-factions": { name: "Battle Planet Coalition", description: "Use all six factions across your saved decks.", category: "Deck Building", metric: "deckFactions", target: 6 },
  "games-five": { name: "Finding Your Feet", description: "Finish five games.", category: "Battle", metric: "matches", target: 5 },
  "games-ten": { name: "Regular Brawler", description: "Finish ten games.", category: "Battle", metric: "matches", target: 10 },
  "games-twenty-five": { name: "Battle Tested", description: "Finish twenty-five games.", category: "Battle", metric: "matches", target: 25 },
  "games-fifty": { name: "Arena Veteran", description: "Finish fifty games.", category: "Battle", metric: "matches", target: 50 },
  "games-one-hundred": { name: "Century of Brawls", description: "Finish one hundred games.", category: "Battle", metric: "matches", target: 100 },
  "wins-five": { name: "Winning Form", description: "Win five games.", category: "Battle", metric: "wins", target: 5 },
  "wins-twenty-five": { name: "Dominant Record", description: "Win twenty-five games.", category: "Battle", metric: "wins", target: 25 },
  "wins-fifty": { name: "Battle Master", description: "Win fifty games.", category: "Battle", metric: "wins", target: 50 },
  "bo1-ten": { name: "Quick Brawl Expert", description: "Complete ten best-of-one games.", category: "Battle", metric: "bo1Games", target: 10 },
  "online-five": { name: "Network Regular", description: "Complete five online games.", category: "Online Play", metric: "onlineGames", target: 5 },
  "online-ten": { name: "Connected Competitor", description: "Complete ten online games.", category: "Online Play", metric: "onlineGames", target: 10 },
  "online-twenty-five": { name: "Online Veteran", description: "Complete twenty-five online games.", category: "Online Play", metric: "onlineGames", target: 25 },
  "online-fifty": { name: "Global Brawler", description: "Complete fifty online games.", category: "Online Play", metric: "onlineGames", target: 50 },
  "online-wins-five": { name: "Network Victor", description: "Win five online games.", category: "Online Play", metric: "onlineWins", target: 5 },
  "opponents-five": { name: "Expanding Rivals", description: "Face five different online opponents.", category: "Online Play", metric: "onlineOpponents", target: 5 },
  "opponents-ten": { name: "Known Across the Planet", description: "Face ten different online opponents.", category: "Online Play", metric: "onlineOpponents", target: 10 },
  "cards-twenty-five": { name: "Card Researcher", description: "Use twenty-five different Main Deck cards across saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 25 },
  "cards-fifty": { name: "Compendium Student", description: "Use fifty different Main Deck cards across saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 50 },
  "cards-one-hundred": { name: "Compendium Scholar", description: "Use one hundred different Main Deck cards across saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 100 },
  "cards-two-hundred": { name: "Living Catalogue", description: "Use two hundred different Main Deck cards across saved decks.", category: "Compendium", metric: "uniqueMainCards", target: 200 },
  "characters-twelve": { name: "Bakugan Specialist", description: "Use twelve different Character Cards across saved decks.", category: "Compendium", metric: "uniqueCharacters", target: 12 },
  "cores-twelve": { name: "Core Catalogue", description: "Use twelve different BakuCores across saved decks.", category: "Compendium", metric: "uniqueCores", target: 12 },
};

const achievementCategorySet = new Set<string>(ACHIEVEMENT_CATEGORIES);
const achievementMetricSet = new Set<string>(ACHIEVEMENT_METRICS);
let runtimeAchievementDefinitions: readonly AchievementDefinition[] | null = null;

const rawText = (value: unknown) => typeof value === "string" ? value.trim() : "";

function matchesLegacyBundledDefinition(
  item: Record<string, unknown>,
  base: AchievementDefinition,
  legacy: LegacyBundledDefinition,
) {
  const expectedName = legacy.name ?? base.name;
  const expectedDescription = legacy.description ?? base.description;
  const expectedCategory = legacy.category ?? base.category;
  const expectedMetric = legacy.metric ?? base.metric;
  const expectedTarget = legacy.target ?? base.target;
  return rawText(item.name) === expectedName
    && rawText(item.description) === expectedDescription
    && rawText(item.category) === expectedCategory
    && rawText(item.metric) === expectedMetric
    && Number(item.target) === expectedTarget;
}

export function normalizeAchievementDefinitions(value: unknown): AchievementDefinition[] {
  if (!Array.isArray(value)) return ACHIEVEMENT_DEFINITIONS.map((item) => ({ ...item }));
  const candidates = new Map<string, Record<string, unknown>>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id === "string" && !candidates.has(item.id)) candidates.set(item.id, item);
  }

  return ACHIEVEMENT_DEFINITIONS.flatMap((base) => {
    const item = candidates.get(base.id);
    if (!item) return [];
    const legacyRows = [
      PREVIOUS_BUNDLED_DEFINITION_FIELDS[base.id],
      ORIGINAL_BUNDLED_DEFINITION_FIELDS[base.id],
    ].filter((row): row is LegacyBundledDefinition => Boolean(row));
    const untouchedBundledRow = legacyRows.some((legacy) =>
      matchesLegacyBundledDefinition(item, base, legacy),
    );

    if (untouchedBundledRow) {
      const trainingAllowed = achievementTrainingConfigurable(base)
        && typeof item.trainingAllowed === "boolean"
        ? item.trainingAllowed
        : base.trainingAllowed;
      return [{
        ...base,
        ...(trainingAllowed !== undefined ? { trainingAllowed } : {}),
      }];
    }

    const name = typeof item.name === "string" && item.name.trim()
      ? item.name.trim().slice(0, 80)
      : base.name;
    const description = typeof item.description === "string" && item.description.trim()
      ? item.description.trim().slice(0, 300)
      : base.description;
    const category = typeof item.category === "string" && achievementCategorySet.has(item.category)
      ? item.category as AchievementCategory
      : base.category;
    const metric = typeof item.metric === "string" && achievementMetricSet.has(item.metric)
      ? item.metric as AchievementMetricKey
      : base.metric;
    const requestedTarget = Number(item.target);
    const target = Number.isInteger(requestedTarget) && requestedTarget > 0
      ? Math.min(requestedTarget, 1_000_000)
      : base.target;
    const draft = { id: base.id, name, description, category, metric, target, trainingAllowed: base.trainingAllowed };
    const trainingAllowed = achievementTrainingConfigurable(draft)
      ? (typeof item.trainingAllowed === "boolean" ? item.trainingAllowed : base.trainingAllowed ?? false)
      : base.trainingAllowed;

    return [{ id: base.id, name, description, category, metric, target, ...(trainingAllowed !== undefined ? { trainingAllowed } : {}) }];
  });
}

export function setAchievementDefinitionRuntime(value: unknown) {
  runtimeAchievementDefinitions = normalizeAchievementDefinitions(value);
  return runtimeAchievementDefinitions;
}

export function resetAchievementDefinitionRuntime() {
  runtimeAchievementDefinitions = null;
}

type Metric = {
  value: number;
  completedAt: (target: number) => string | null;
};

const validDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

const countMetric = <T>(items: T[], dateFor: (item: T) => unknown): Metric => {
  const orderedDates = items
    .map(dateFor)
    .map(validDate)
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    value: items.length,
    completedAt: (target) => orderedDates[target - 1] ?? null,
  };
};

const valueMetric = (value: number): Metric => ({ value, completedAt: () => null });

const uniqueMetric = <T>(items: T[], valuesFor: (item: T) => string[], dateFor: (item: T) => unknown): Metric => {
  const ordered = [...items].sort(
    (left, right) => Date.parse(validDate(dateFor(left)) ?? "1970-01-01") - Date.parse(validDate(dateFor(right)) ?? "1970-01-01"),
  );
  const unique = new Set<string>();
  const milestones = new Map<number, string>();
  for (const item of ordered) {
    const date = validDate(dateFor(item));
    for (const raw of valuesFor(item)) {
      if (typeof raw !== "string") continue;
      const normalized = raw.trim().toLowerCase();
      if (!normalized || unique.has(normalized)) continue;
      unique.add(normalized);
      if (date) milestones.set(unique.size, date);
    }
  }
  return { value: unique.size, completedAt: (target) => milestones.get(target) ?? null };
};

const trainingCredit = (progress: AchievementProgress, achievementId: string) =>
  progress.trainingCredits[achievementId] ?? { matchIds: [], values: [] };

const factionEvidenceCount = (progress: AchievementProgress, achievementId: string) =>
  new Set([
    ...progress.winningFactions.nonTraining,
    ...trainingCredit(progress, achievementId).values,
  ]).size;

const monoFactionEvidenceCount = (
  progress: AchievementProgress,
  faction: MonoMasteryFaction,
  achievementId: string,
) => progress.monoFactionWinIds[faction].nonTraining.length + trainingCredit(progress, achievementId).matchIds.length;

export function achievementStatus(current: number, target: number): AchievementStatus {
  if (current >= target) return "completed";
  return current > 0 ? "in-progress" : "locked";
}

// These stable IDs previously represented materially different requirements.
// Their old completion timestamps are retained in storage for audit/history, but
// cannot unlock the redesigned achievement until new-system evidence satisfies
// the current requirement. This prevents, for example, the former "play five
// games" milestone from silently granting Pyrus Mastery.
const COMPLETION_REQUIRES_CURRENT_PROGRESS = new Set<string>([
  "first-deck",
  "deck-builder",
  "singleton-start",
  "complete-five",
  "characters-twelve",
  "cores-twelve",
  "publisher",
  "decks-five",
  "public-five",
  "decks-ten",
  "first-win",
  "first-series",
  "bo1-ten",
  "online-five",
  "online-ten",
  "online-twenty-five",
  "online-fifty",
  "online-wins-five",
  "all-factions",
  "games-five",
  "games-ten",
  "games-twenty-five",
  "games-fifty",
  "games-one-hundred",
  "complete-ten",
  "cards-twenty-five",
  "cards-fifty",
  "cards-one-hundred",
  "cards-two-hundred",
]);

export function applyAchievementCompletions(
  achievements: Achievement[],
  completions: AchievementCompletionMap | null | undefined,
): Achievement[] {
  if (!completions) return achievements;
  return achievements.map((achievement) => {
    const completedAt = validDate(completions[achievement.id]);
    if (!completedAt) return achievement;
    if (COMPLETION_REQUIRES_CURRENT_PROGRESS.has(achievement.id) && !achievement.unlocked) {
      return achievement;
    }
    return {
      ...achievement,
      current: achievement.target,
      unlocked: true,
      status: "completed",
      completedAt,
    };
  });
}

export function achievementsFor(
  decks: DeckRecord[],
  history: Array<Partial<MatchResultRecord>>,
  lifetimeStats?: LifetimeMatchStats,
  definitions: readonly AchievementDefinition[] = runtimeAchievementDefinitions ?? ACHIEVEMENT_DEFINITIONS,
  storedProgress?: AchievementProgress | null,
): Achievement[] {
  const matches = history.filter((record) => !/disconnect|abandon/i.test(record.reason ?? ""));
  const nonTrainingMatches = accountStatMatches(matches);
  const trainingMatches = matches.filter((record) => record.mode === "training");
  const nonTrainingWins = nonTrainingMatches.filter((record) => record.result === "Victor");
  const onlineGames = matches.filter((record) =>
    record.mode === "online" || record.mode === "casual" || record.mode === "ranked",
  );
  const recentRankedWins = matches.filter((record) => record.mode === "ranked" && record.result === "Victor");

  const progress = observeAchievementDecks(normalizeAchievementProgress(storedProgress), decks);
  const legalDecks = decks.filter(deckIsLegal);
  const legalStandardDecks = legalDecks.filter((deck) => (deck.format ?? "standard") === "standard");
  const legalSingletonDecks = legalDecks.filter((deck) => deck.format === "singleton");
  const legalCompetitiveDecks = legalDecks.filter((deck) => deck.format === "competitive");
  const legalPublicStandardDecks = legalStandardDecks.filter((deck) => deck.visibility === "Public");

  const currentDistinctDecks = (items: readonly DeckRecord[]) =>
    new Set(items.map(achievementDeckSignature)).size;
  const currentStandardDecks = currentDistinctDecks(legalStandardDecks);
  const currentSingletonDecks = currentDistinctDecks(legalSingletonDecks);
  const currentCompetitiveDecks = currentDistinctDecks(legalCompetitiveDecks);
  const currentPublishedDecks = currentDistinctDecks(legalPublicStandardDecks);

  const standardDecks = Math.max(
    distinctDeckEvidence(progress.standardDeckIds, progress.standardDeckSignatures),
    currentStandardDecks,
  );
  const singletonDecks = Math.max(
    distinctDeckEvidence(progress.singletonDeckIds, progress.singletonDeckSignatures),
    currentSingletonDecks,
  );
  const competitiveDecks = Math.max(
    distinctDeckEvidence(progress.competitiveDeckIds, progress.competitiveDeckSignatures),
    currentCompetitiveDecks,
  );
  const publishedDecks = Math.max(
    distinctDeckEvidence(progress.publishedDeckIds, progress.publishedDeckSignatures),
    currentPublishedDecks,
  );

  const recentNonTrainingMatches = countMetric(nonTrainingMatches, (record) => record.at);
  const recentNonTrainingWins = countMetric(nonTrainingWins, (record) => record.at);
  const nonTrainingMatchTotal = lifetimeStats
    ? Math.max(0, lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches)
    : recentNonTrainingMatches.value;
  // Before per-achievement Training eligibility existed, lifetime win totals
  // could include Training. Grandfather those historical wins into the generic
  // Arena win ladder; future Training credit is controlled per achievement.
  const nonTrainingWinTotal = Math.max(
    progress.arenaWinIds.nonTraining.length,
    recentNonTrainingWins.value,
    lifetimeStats?.wins ?? 0,
  );

  const recentBo1NonTrainingWins = nonTrainingWins.filter((record) => (record.format ?? "bo1") === "bo1");
  const recentBo3NonTrainingWins = nonTrainingWins.filter((record) => record.format === "bo3");

  const onlineOpponentKeys = new Set(progress.onlineOpponentKeys);
  for (const record of onlineGames) {
    const key = typeof record.opponentUserId === "string" && record.opponentUserId
      ? record.opponentUserId
      : typeof record.opponent === "string"
        ? record.opponent.trim().toLowerCase()
        : "";
    if (key) onlineOpponentKeys.add(key);
  }

  const coreTypeById = new Map(CORES.map((core) => [core.id, core.type]));
  const currentCharacterIds = new Set(legalStandardDecks.flatMap((deck) => deck.bakuganIds));
  const currentCoreTypes = new Set(
    legalStandardDecks.flatMap((deck) => deck.coreIds.flatMap((id) => coreTypeById.get(id) ?? [])),
  );

  const metrics: Record<AchievementMetricKey, Metric> = {
    standardDecks: valueMetric(standardDecks),
    singletonDecks: valueMetric(singletonDecks),
    competitiveDecks: valueMetric(competitiveDecks),
    publishedDecks: valueMetric(publishedDecks),
    characterCards: valueMetric(Math.max(progress.characterCardIds.length, currentCharacterIds.size)),
    coreTypes: valueMetric(Math.max(progress.coreTypes.length, currentCoreTypes.size)),
    matches: valueMetric(nonTrainingMatchTotal),
    wins: valueMetric(nonTrainingWinTotal),
    bo1Wins: valueMetric(Math.max(progress.bo1WinIds.nonTraining.length, recentBo1NonTrainingWins.length)),
    bo3Wins: valueMetric(Math.max(progress.bo3WinIds.nonTraining.length, recentBo3NonTrainingWins.length)),
    rankedWins: valueMetric(Math.max(progress.rankedWinIds.length, recentRankedWins.length)),
    onlineGames: valueMetric(Math.max(lifetimeStats ? lifetimeStats.casualMatches + lifetimeStats.rankedMatches : 0, onlineGames.length)),
    onlineOpponents: valueMetric(onlineOpponentKeys.size),
    discoveredMainCards: valueMetric(progress.discoveredMainCardIds.length),
    winningFactions: valueMetric(progress.winningFactions.nonTraining.length),
    monoPyrusWins: valueMetric(progress.monoFactionWinIds.Pyrus.nonTraining.length),
    monoAquosWins: valueMetric(progress.monoFactionWinIds.Aquos.nonTraining.length),
    monoVentusWins: valueMetric(progress.monoFactionWinIds.Ventus.nonTraining.length),
    monoHaosWins: valueMetric(progress.monoFactionWinIds.Haos.nonTraining.length),
    monoDarkusWins: valueMetric(progress.monoFactionWinIds.Darkus.nonTraining.length),
    elementalMastery: valueMetric(0),

    decks: countMetric(decks, (deck) => deck.updatedAt),
    completeDecks: valueMetric(standardDecks + singletonDecks + competitiveDecks),
    publicDecks: valueMetric(publishedDecks),
    privateDecks: countMetric(decks.filter((deck) => deck.visibility === "Private"), (deck) => deck.updatedAt),
    favouriteDecks: countMetric(decks.filter((deck) => deck.favourite), (deck) => deck.updatedAt),
    describedDecks: countMetric(decks.filter((deck) => Boolean(deck.description?.trim())), (deck) => deck.updatedAt),
    deckFactions: uniqueMetric(legalDecks, (deck) => deck.factions, (deck) => deck.updatedAt),
    trainingGames: valueMetric(Math.max(lifetimeStats?.trainingMatches ?? 0, trainingMatches.length)),
    bo1Games: countMetric(nonTrainingMatches.filter((record) => (record.format ?? "bo1") === "bo1"), (record) => record.at),
    bo3Games: countMetric(nonTrainingMatches.filter((record) => record.format === "bo3"), (record) => record.at),
    onlineWins: countMetric(onlineGames.filter((record) => record.result === "Victor"), (record) => record.at),
    uniqueMainCards: uniqueMetric(legalDecks, (deck) => deck.cardIds, (deck) => deck.updatedAt),
    uniqueCharacters: valueMetric(Math.max(progress.characterCardIds.length, currentCharacterIds.size)),
    uniqueCores: uniqueMetric(legalDecks, (deck) => deck.coreIds, (deck) => deck.updatedAt),
  };

  const metricFor = (item: AchievementDefinition): Metric => {
    const credit = trainingCredit(progress, item.id);
    if (item.metric === "matches") return valueMetric(nonTrainingMatchTotal + credit.matchIds.length);
    if (item.metric === "wins") return valueMetric(nonTrainingWinTotal + credit.matchIds.length);
    if (item.metric === "bo1Wins") {
      return valueMetric(Math.max(progress.bo1WinIds.nonTraining.length, recentBo1NonTrainingWins.length) + credit.matchIds.length);
    }
    if (item.metric === "bo3Wins") {
      return valueMetric(Math.max(progress.bo3WinIds.nonTraining.length, recentBo3NonTrainingWins.length) + credit.matchIds.length);
    }
    if (item.metric === "winningFactions") return valueMetric(factionEvidenceCount(progress, item.id));
    if (item.metric === "monoPyrusWins") return valueMetric(monoFactionEvidenceCount(progress, "Pyrus", item.id));
    if (item.metric === "monoAquosWins") return valueMetric(monoFactionEvidenceCount(progress, "Aquos", item.id));
    if (item.metric === "monoVentusWins") return valueMetric(monoFactionEvidenceCount(progress, "Ventus", item.id));
    if (item.metric === "monoHaosWins") return valueMetric(monoFactionEvidenceCount(progress, "Haos", item.id));
    if (item.metric === "monoDarkusWins") return valueMetric(monoFactionEvidenceCount(progress, "Darkus", item.id));
    if (item.metric === "elementalMastery") {
      const prerequisiteIds = [
        "all-factions",
        "games-five",
        "games-ten",
        "games-twenty-five",
        "games-fifty",
        "games-one-hundred",
      ];
      const complete = prerequisiteIds.every((id) => {
        const prerequisite = definitions.find((definition) => definition.id === id);
        return prerequisite ? metricFor(prerequisite).value >= prerequisite.target : false;
      });
      return valueMetric(complete ? 1 : 0);
    }
    return metrics[item.metric];
  };

  return definitions.map((item) => {
    const metric = metricFor(item);
    const status = achievementStatus(metric.value, item.target);
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      current: Math.min(metric.value, item.target),
      target: item.target,
      unlocked: status === "completed",
      status,
      completedAt: status === "completed" ? metric.completedAt(item.target) : null,
      trainingRule: achievementTrainingRule(item),
    };
  });
}

export function sortAchievements(achievements: Achievement[], status: AchievementStatus) {
  return [...achievements]
    .filter((achievement) => achievement.status === status)
    .sort((left, right) => {
      if (status === "completed") {
        const dateDifference = Date.parse(right.completedAt ?? "1970-01-01") - Date.parse(left.completedAt ?? "1970-01-01");
        if (dateDifference) return dateDifference;
      }
      if (status === "in-progress") {
        const progressDifference = right.current / right.target - left.current / left.target;
        if (progressDifference) return progressDifference;
      }
      return left.name.localeCompare(right.name);
    });
}
