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
] as const;

export type AchievementStatus = "completed" | "in-progress" | "locked";
export type AchievementMetricKey = (typeof ACHIEVEMENT_METRICS)[number];
export type AchievementCompletionMap = Record<string, string>;
export type AchievementTrainingRule = "allowed" | "blocked" | "ranked" | "derived" | null;

export const ACHIEVEMENT_COMPLETION_NAMESPACE = "achievement:v1:";
export const achievementCompletionKey = (achievementId: string) =>
  `${ACHIEVEMENT_COMPLETION_NAMESPACE}${achievementId}`;

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
  definition("online", "First Connection", "Complete your first online game.", "Brawler Network", "onlineGames", 1),
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

  // Ranked victories remain Arena achievements, and Training can never satisfy them.
  definition("online-five", "Ranked Debut", "Win your first Ranked game.", "Arena", "rankedWins", 1),
  definition("online-ten", "Ranked Contender", "Win five Ranked games.", "Arena", "rankedWins", 5),
  definition("online-twenty-five", "Ranked Veteran", "Win ten Ranked games.", "Arena", "rankedWins", 10),
  definition("online-fifty", "Ranked Elite", "Win twenty-five Ranked games.", "Arena", "rankedWins", 25),
  definition("online-wins-five", "Ranked Master", "Win fifty Ranked games.", "Arena", "rankedWins", 50),

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

const achievementCategorySet = new Set<string>(ACHIEVEMENT_CATEGORIES);
const achievementMetricSet = new Set<string>(ACHIEVEMENT_METRICS);
const bundledDefinitionById = new Map(ACHIEVEMENT_DEFINITIONS.map((item) => [item.id, item]));
let runtimeAchievementDefinitions: readonly AchievementDefinition[] | null = null;

export function normalizeAchievementDefinitions(value: unknown): AchievementDefinition[] {
  if (!Array.isArray(value)) return ACHIEVEMENT_DEFINITIONS.map((item) => ({ ...item }));

  const result: AchievementDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    const base = bundledDefinitionById.get(id);
    if (!base || seen.has(id)) continue;
    seen.add(id);

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
    const draft: AchievementDefinition = { id, name, description, category, metric, target };
    if (achievementTrainingConfigurable(draft)) {
      draft.trainingAllowed = typeof item.trainingAllowed === "boolean"
        ? item.trainingAllowed
        : base.trainingAllowed ?? false;
    }
    result.push(draft);
  }
  return result;
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

export function applyAchievementCompletions(
  achievements: Achievement[],
  completions: AchievementCompletionMap | null | undefined,
): Achievement[] {
  if (!completions) return achievements;
  return achievements.map((achievement) => {
    const completedAt = validDate(completions[achievementCompletionKey(achievement.id)]);
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
  const nonTrainingWinTotal = Math.max(
    progress.arenaWinIds.nonTraining.length,
    recentNonTrainingWins.value,
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
    onlineGames: valueMetric(Math.max(
      lifetimeStats ? lifetimeStats.casualMatches + lifetimeStats.rankedMatches : 0,
      onlineGames.length,
    )),
    onlineOpponents: valueMetric(onlineOpponentKeys.size),
    discoveredMainCards: valueMetric(progress.discoveredMainCardIds.length),
    winningFactions: valueMetric(progress.winningFactions.nonTraining.length),
    monoPyrusWins: valueMetric(progress.monoFactionWinIds.Pyrus.nonTraining.length),
    monoAquosWins: valueMetric(progress.monoFactionWinIds.Aquos.nonTraining.length),
    monoVentusWins: valueMetric(progress.monoFactionWinIds.Ventus.nonTraining.length),
    monoHaosWins: valueMetric(progress.monoFactionWinIds.Haos.nonTraining.length),
    monoDarkusWins: valueMetric(progress.monoFactionWinIds.Darkus.nonTraining.length),
    elementalMastery: valueMetric(0),
  };

  const metricFor = (item: AchievementDefinition): Metric => {
    const credit = trainingCredit(progress, item.id);
    if (item.metric === "matches") return valueMetric(nonTrainingMatchTotal + credit.matchIds.length);
    if (item.metric === "wins") return valueMetric(nonTrainingWinTotal + credit.matchIds.length);
    if (item.metric === "bo1Wins") {
      return valueMetric(
        Math.max(progress.bo1WinIds.nonTraining.length, recentBo1NonTrainingWins.length) + credit.matchIds.length,
      );
    }
    if (item.metric === "bo3Wins") {
      return valueMetric(
        Math.max(progress.bo3WinIds.nonTraining.length, recentBo3NonTrainingWins.length) + credit.matchIds.length,
      );
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
