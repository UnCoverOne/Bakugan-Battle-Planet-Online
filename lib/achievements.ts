import { CORES, deckIsLegal, type DeckRecord } from "./data";
import {
  ACHIEVEMENT_FACTIONS,
  MONO_MASTERY_FACTIONS,
  distinctDeckEvidence,
  normalizeAchievementProgress,
  observeAchievementDecks,
  type AchievementProgress,
  type MatchEvidenceBucket,
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
  // Current catalogue metrics.
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

type LegacyBundledDefinition = Partial<Pick<
  AchievementDefinition,
  "name" | "description" | "category" | "metric" | "target"
>>;

/**
 * D1 stores complete definition rows. When a field still matches the previous
 * bundled default, migrate it to the new bundled value. Deliberate Administrator
 * edits survive because values that differ from those defaults are preserved.
 */
const LEGACY_BUNDLED_DEFINITION_FIELDS: Record<string, LegacyBundledDefinition> = {
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

const achievementCategorySet = new Set<string>(ACHIEVEMENT_CATEGORIES);
const achievementMetricSet = new Set<string>(ACHIEVEMENT_METRICS);
let runtimeAchievementDefinitions: readonly AchievementDefinition[] | null = null;

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
    const legacy = LEGACY_BUNDLED_DEFINITION_FIELDS[base.id];

    const requestedName = typeof item.name === "string" && item.name.trim()
      ? item.name.trim().slice(0, 80)
      : base.name;
    const name = legacy?.name && requestedName === legacy.name ? base.name : requestedName;

    const requestedDescription = typeof item.description === "string" && item.description.trim()
      ? item.description.trim().slice(0, 300)
      : base.description;
    const description = legacy?.description && requestedDescription === legacy.description
      ? base.description
      : requestedDescription;

    const requestedCategory = typeof item.category === "string" && achievementCategorySet.has(item.category)
      ? item.category as AchievementCategory
      : base.category;
    const category = legacy?.category === requestedCategory ? base.category : requestedCategory;

    const requestedMetric = typeof item.metric === "string" && achievementMetricSet.has(item.metric)
      ? item.metric as AchievementMetricKey
      : base.metric;
    const metric = legacy?.metric === requestedMetric ? base.metric : requestedMetric;

    const requestedTarget = Number(item.target);
    const normalizedTarget = Number.isInteger(requestedTarget) && requestedTarget > 0
      ? Math.min(requestedTarget, 1_000_000)
      : base.target;
    const target = legacy?.target === normalizedTarget ? base.target : normalizedTarget;

    const trainingAllowed = achievementTrainingConfigurable({
      id: base.id,
      name,
      description,
      category,
      metric,
      target,
      trainingAllowed: base.trainingAllowed,
    })
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

const evidenceCount = (bucket: MatchEvidenceBucket, trainingAllowed: boolean) =>
  bucket.nonTraining.length + (trainingAllowed ? bucket.training.length : 0);

const factionEvidenceCount = (
  progress: AchievementProgress,
  trainingAllowed: boolean,
) => new Set([
  ...progress.winningFactions.nonTraining,
  ...(trainingAllowed ? progress.winningFactions.training : []),
]).size;

const monoFactionEvidenceCount = (
  progress: AchievementProgress,
  faction: MonoMasteryFaction,
  trainingAllowed: boolean,
) => evidenceCount(progress.monoFactionWinIds[faction], trainingAllowed);

export function achievementStatus(current: number, target: number): AchievementStatus {
  if (current >= target) return "completed";
  return current > 0 ? "in-progress" : "locked";
}

export function applyAchievementCompletions(
  achievements: Achievement[],
  completions: AchievementCompletionMap | null | undefined,
): Achievement[] {
  if (!completions) return achievements;
  return achievements.map((achievement) => {
    const completedAt = validDate(completions[achievement.id]);
    if (!completedAt) return achievement;
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
  const trainingWins = trainingMatches.filter((record) => record.result === "Victor");
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

  const currentStandardIds = new Set(legalStandardDecks.map((deck) => deck.id)).size;
  const currentSingletonIds = new Set(legalSingletonDecks.map((deck) => deck.id)).size;
  const currentCompetitiveIds = new Set(legalCompetitiveDecks.map((deck) => deck.id)).size;
  const currentPublishedIds = new Set(legalPublicStandardDecks.map((deck) => deck.id)).size;

  const standardDecks = Math.max(
    distinctDeckEvidence(progress.standardDeckIds, progress.standardDeckSignatures),
    currentStandardIds,
  );
  const singletonDecks = Math.max(
    distinctDeckEvidence(progress.singletonDeckIds, progress.singletonDeckSignatures),
    currentSingletonIds,
  );
  const competitiveDecks = Math.max(
    distinctDeckEvidence(progress.competitiveDeckIds, progress.competitiveDeckSignatures),
    currentCompetitiveIds,
  );
  const publishedDecks = Math.max(
    distinctDeckEvidence(progress.publishedDeckIds, progress.publishedDeckSignatures),
    currentPublishedIds,
  );

  const recentNonTrainingMatches = countMetric(nonTrainingMatches, (record) => record.at);
  const recentAllMatches = countMetric(matches, (record) => record.at);
  const recentNonTrainingWins = countMetric(nonTrainingWins, (record) => record.at);
  const recentAllWins = countMetric([...nonTrainingWins, ...trainingWins], (record) => record.at);
  const nonTrainingMatchTotal = lifetimeStats
    ? Math.max(0, lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches)
    : recentNonTrainingMatches.value;
  const allMatchTotal = lifetimeStats ? lifetimeStats.matchesPlayed : recentAllMatches.value;
  const legacyNonTrainingWins = lifetimeStats
    ? Math.max(0, lifetimeStats.wins - lifetimeStats.trainingMatches)
    : 0;
  const nonTrainingWinTotal = Math.max(
    legacyNonTrainingWins,
    progress.arenaWinIds.nonTraining.length,
    recentNonTrainingWins.value,
  );
  const allWinTotal = Math.max(
    lifetimeStats?.wins ?? 0,
    evidenceCount(progress.arenaWinIds, true),
    recentAllWins.value,
  );

  const recentBo1NonTrainingWins = nonTrainingWins.filter((record) => (record.format ?? "bo1") === "bo1");
  const recentBo1TrainingWins = trainingWins.filter((record) => (record.format ?? "bo1") === "bo1");
  const recentBo3NonTrainingWins = nonTrainingWins.filter((record) => record.format === "bo3");
  const recentBo3TrainingWins = trainingWins.filter((record) => record.format === "bo3");

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

  const legacyMetrics: Record<AchievementMetricKey, Metric> = {
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
    winningFactions: valueMetric(factionEvidenceCount(progress, false)),
    monoPyrusWins: valueMetric(monoFactionEvidenceCount(progress, "Pyrus", false)),
    monoAquosWins: valueMetric(monoFactionEvidenceCount(progress, "Aquos", false)),
    monoVentusWins: valueMetric(monoFactionEvidenceCount(progress, "Ventus", false)),
    monoHaosWins: valueMetric(monoFactionEvidenceCount(progress, "Haos", false)),
    monoDarkusWins: valueMetric(monoFactionEvidenceCount(progress, "Darkus", false)),
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
    const trainingAllowed = item.category === "Arena" && achievementTrainingRule(item) === "allowed";
    if (item.metric === "matches") return valueMetric(trainingAllowed ? allMatchTotal : nonTrainingMatchTotal);
    if (item.metric === "wins") return valueMetric(trainingAllowed ? allWinTotal : nonTrainingWinTotal);
    if (item.metric === "bo1Wins") {
      return valueMetric(Math.max(
        evidenceCount(progress.bo1WinIds, trainingAllowed),
        recentBo1NonTrainingWins.length + (trainingAllowed ? recentBo1TrainingWins.length : 0),
      ));
    }
    if (item.metric === "bo3Wins") {
      return valueMetric(Math.max(
        evidenceCount(progress.bo3WinIds, trainingAllowed),
        recentBo3NonTrainingWins.length + (trainingAllowed ? recentBo3TrainingWins.length : 0),
      ));
    }
    if (item.metric === "winningFactions") return valueMetric(factionEvidenceCount(progress, trainingAllowed));
    if (item.metric === "monoPyrusWins") return valueMetric(monoFactionEvidenceCount(progress, "Pyrus", trainingAllowed));
    if (item.metric === "monoAquosWins") return valueMetric(monoFactionEvidenceCount(progress, "Aquos", trainingAllowed));
    if (item.metric === "monoVentusWins") return valueMetric(monoFactionEvidenceCount(progress, "Ventus", trainingAllowed));
    if (item.metric === "monoHaosWins") return valueMetric(monoFactionEvidenceCount(progress, "Haos", trainingAllowed));
    if (item.metric === "monoDarkusWins") return valueMetric(monoFactionEvidenceCount(progress, "Darkus", trainingAllowed));
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
    return legacyMetrics[item.metric];
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
