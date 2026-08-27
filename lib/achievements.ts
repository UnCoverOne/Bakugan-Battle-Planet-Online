import { deckIsLegal, type DeckRecord } from "./data";
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
  { glyph: string; color: string }
> = {
  Arsenal: { glyph: "▤", color: "#f3b44f" },
  Arena: { glyph: "⚔", color: "#ef6f61" },
  "Brawler Network": { glyph: "◎", color: "#5bd7ee" },
  Compendium: { glyph: "◇", color: "#a88cf2" },
};

export const ACHIEVEMENT_METRICS = [
  // Legacy metric keys remain valid so Administrator configurations do not
  // become unreadable while the bundled catalogue moves away from them.
  "decks",
  "completeDecks",
  "publicDecks",
  "privateDecks",
  "favouriteDecks",
  "describedDecks",
  "singletonDecks",
  "deckFactions",
  "matches",
  "wins",
  "trainingGames",
  "bo1Games",
  "bo3Games",
  "bo1Wins",
  "bo3Wins",
  "onlineGames",
  "onlineWins",
  "onlineOpponents",
  "uniqueMainCards",
  "uniqueCharacters",
  "uniqueCores",
] as const;

export type AchievementStatus = "completed" | "in-progress" | "locked";
export type AchievementMetricKey = (typeof ACHIEVEMENT_METRICS)[number];
export type AchievementCompletionMap = Record<string, string>;

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
};

export type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  metric: AchievementMetricKey;
  target: number;
};

const definition = (
  id: string,
  name: string,
  description: string,
  category: AchievementCategory,
  metric: AchievementMetricKey,
  target: number,
): AchievementDefinition => ({ id, name, description, category, metric, target });

/**
 * Stable IDs are intentionally retained so existing reward assignments,
 * showcases, and Administrator configuration rows continue to refer to the
 * same records while the catalogue is reorganized around four clearer paths.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  definition("first-deck", "Battle Ready", "Build your first legal deck.", "Arsenal", "completeDecks", 1),
  definition("deck-builder", "Arsenal Architect", "Build three distinct legal decks.", "Arsenal", "completeDecks", 3),
  definition("first-brawl", "Enter the Brawl", "Finish your first non-Training game.", "Arena", "matches", 1),
  definition("first-win", "First Victory", "Win your first non-Training game.", "Arena", "wins", 1),
  definition("veteran", "Seasoned Brawler", "Win ten non-Training games.", "Arena", "wins", 10),
  definition("publisher", "Share the Strategy", "Publish one distinct legal deck to the Public Deck Library.", "Arsenal", "publicDecks", 1),
  definition("online", "Connected Brawler", "Complete an online game.", "Brawler Network", "onlineGames", 1),

  definition("first-series", "Best of Three", "Win a best-of-three match.", "Arena", "bo3Wins", 1),
  definition("training-day", "Training Day", "Complete a Training AI match.", "Arena", "trainingGames", 1),
  definition("singleton-start", "One of a Kind", "Build a legal Singleton-format deck.", "Arsenal", "singletonDecks", 1),

  // Repurpose the former saved-deck quantity milestones into a publishing path.
  definition("decks-five", "Strategy Contributor", "Publish three distinct legal decks.", "Arsenal", "publicDecks", 3),
  definition("public-five", "Community Architect", "Publish six distinct legal decks.", "Arsenal", "publicDecks", 6),
  definition("decks-ten", "Planetwide Publisher", "Publish nine distinct legal decks.", "Arsenal", "publicDecks", 9),
  definition("complete-five", "Loadout Specialist", "Build five distinct legal decks.", "Arsenal", "completeDecks", 5),
  definition("complete-ten", "Master Architect", "Build ten distinct legal decks.", "Arsenal", "completeDecks", 10),
  definition("singleton-three", "Singleton Specialist", "Build three distinct legal Singleton-format decks.", "Arsenal", "singletonDecks", 3),
  definition("all-factions", "Battle Planet Coalition", "Represent all six factions across your legal saved decks.", "Arsenal", "deckFactions", 6),

  definition("games-five", "Finding Your Feet", "Finish five non-Training games.", "Arena", "matches", 5),
  definition("games-ten", "Regular Brawler", "Finish ten non-Training games.", "Arena", "matches", 10),
  definition("games-twenty-five", "Battle Tested", "Finish twenty-five non-Training games.", "Arena", "matches", 25),
  definition("games-fifty", "Arena Veteran", "Finish fifty non-Training games.", "Arena", "matches", 50),
  definition("games-one-hundred", "Century of Brawls", "Finish one hundred non-Training games.", "Arena", "matches", 100),
  definition("wins-five", "Winning Form", "Win five non-Training games.", "Arena", "wins", 5),
  definition("wins-twenty-five", "Dominant Record", "Win twenty-five non-Training games.", "Arena", "wins", 25),
  definition("wins-fifty", "Battle Master", "Win fifty non-Training games.", "Arena", "wins", 50),
  definition("training-five", "Sparring Partner", "Complete five Training AI games.", "Arena", "trainingGames", 5),
  definition("training-twenty-five", "AI Analyst", "Complete twenty-five Training AI games.", "Arena", "trainingGames", 25),
  definition("bo1-ten", "Quick Brawl Expert", "Win ten best-of-one games.", "Arena", "bo1Wins", 10),

  definition("online-five", "Network Regular", "Complete five online games.", "Brawler Network", "onlineGames", 5),
  definition("online-ten", "Connected Competitor", "Complete ten online games.", "Brawler Network", "onlineGames", 10),
  definition("online-twenty-five", "Online Veteran", "Complete twenty-five online games.", "Brawler Network", "onlineGames", 25),
  definition("online-fifty", "Global Brawler", "Complete fifty online games.", "Brawler Network", "onlineGames", 50),
  definition("online-wins-five", "Network Victor", "Win five online games.", "Brawler Network", "onlineWins", 5),
  definition("online-wins-ten", "Online Contender", "Win ten online games.", "Brawler Network", "onlineWins", 10),
  definition("opponents-five", "Expanding Rivals", "Face five different online opponents.", "Brawler Network", "onlineOpponents", 5),
  definition("opponents-ten", "Known Across the Planet", "Face ten different online opponents.", "Brawler Network", "onlineOpponents", 10),

  definition("cards-twenty-five", "Card Researcher", "Use twenty-five different Main Deck cards across legal saved decks.", "Compendium", "uniqueMainCards", 25),
  definition("cards-fifty", "Compendium Student", "Use fifty different Main Deck cards across legal saved decks.", "Compendium", "uniqueMainCards", 50),
  definition("cards-one-hundred", "Compendium Scholar", "Use one hundred different Main Deck cards across legal saved decks.", "Compendium", "uniqueMainCards", 100),
  definition("cards-two-hundred", "Living Catalogue", "Use two hundred different Main Deck cards across legal saved decks.", "Compendium", "uniqueMainCards", 200),
  definition("characters-three", "Bakugan Research", "Use three different Character Cards across legal saved decks.", "Compendium", "uniqueCharacters", 3),
  definition("characters-six", "Expanded Team Data", "Use six different Character Cards across legal saved decks.", "Compendium", "uniqueCharacters", 6),
  definition("characters-twelve", "Bakugan Specialist", "Use twelve different Character Cards across legal saved decks.", "Compendium", "uniqueCharacters", 12),
  definition("cores-six", "Core Sample", "Use six different BakuCores across legal saved decks.", "Compendium", "uniqueCores", 6),
  definition("cores-twelve", "Core Catalogue", "Use twelve different BakuCores across legal saved decks.", "Compendium", "uniqueCores", 12),
];

type LegacyBundledDefinition = Partial<Pick<
  AchievementDefinition,
  "name" | "description" | "metric" | "target"
>>;

/**
 * Administrator/D1 catalogues persist complete definition rows. Upgrade only
 * fields that still equal the old bundled defaults; deliberate Administrator
 * edits survive while untouched old rows inherit the redesigned semantics.
 */
const LEGACY_BUNDLED_DEFINITION_FIELDS: Record<string, LegacyBundledDefinition> = {
  "first-deck": { description: "Complete your first 40-card, three-Character, six-Core deck." },
  "deck-builder": { description: "Complete three decks." },
  "first-brawl": { description: "Finish your first game." },
  "first-win": { description: "Win your first game." },
  veteran: { description: "Win ten games." },
  publisher: { description: "Publish a deck to the Public Deck Library." },
  "first-series": { description: "Complete a best-of-three match.", metric: "bo3Games" },
  "singleton-start": { description: "Save a Singleton-format deck." },
  "decks-five": { name: "Prepared for Anything", description: "Save five decks.", metric: "decks", target: 5 },
  "decks-ten": { name: "Vault Keeper", description: "Save ten decks.", metric: "decks", target: 10 },
  "complete-five": { description: "Complete five legal-sized decks." },
  "complete-ten": { description: "Complete ten legal-sized decks." },
  "public-five": { description: "Publish five decks.", target: 5 },
  "singleton-three": { description: "Save three Singleton-format decks." },
  "all-factions": { description: "Use all six factions across your saved decks." },
  "games-five": { description: "Finish five games." },
  "games-ten": { description: "Finish ten games." },
  "games-twenty-five": { description: "Finish twenty-five games." },
  "games-fifty": { description: "Finish fifty games." },
  "games-one-hundred": { description: "Finish one hundred games." },
  "wins-five": { description: "Win five games." },
  "wins-twenty-five": { description: "Win twenty-five games." },
  "wins-fifty": { description: "Win fifty games." },
  "bo1-ten": { description: "Complete ten best-of-one games.", metric: "bo1Games" },
  "cards-twenty-five": { description: "Use twenty-five different Main Deck cards across saved decks." },
  "cards-fifty": { description: "Use fifty different Main Deck cards across saved decks." },
  "cards-one-hundred": { description: "Use one hundred different Main Deck cards across saved decks." },
  "cards-two-hundred": { description: "Use two hundred different Main Deck cards across saved decks." },
  "characters-three": { description: "Use three different Character Cards across saved decks." },
  "characters-six": { description: "Use six different Character Cards across saved decks." },
  "characters-twelve": { description: "Use twelve different Character Cards across saved decks." },
  "cores-six": { description: "Use six different BakuCores across saved decks." },
  "cores-twelve": { description: "Use twelve different BakuCores across saved decks." },
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

    const category = typeof item.category === "string" && achievementCategorySet.has(item.category)
      ? item.category as AchievementCategory
      : base.category;

    const requestedMetric = typeof item.metric === "string" && achievementMetricSet.has(item.metric)
      ? item.metric as AchievementMetricKey
      : base.metric;
    const metric = legacy?.metric && requestedMetric === legacy.metric
      ? base.metric
      : requestedMetric;

    const requestedTarget = Number(item.target);
    const normalizedTarget = Number.isInteger(requestedTarget) && requestedTarget > 0
      ? Math.min(requestedTarget, 1_000_000)
      : base.target;
    const target = legacy?.target === normalizedTarget ? base.target : normalizedTarget;

    return [{ id: base.id, name, description, category, metric, target }];
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

const countMetric = <T>(
  items: T[],
  dateFor: (item: T) => unknown,
): Metric => {
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

const uniqueMetric = <T>(
  items: T[],
  valuesFor: (item: T) => string[],
  dateFor: (item: T) => unknown,
): Metric => {
  const ordered = [...items].sort(
    (left, right) =>
      Date.parse(validDate(dateFor(left)) ?? "1970-01-01") -
      Date.parse(validDate(dateFor(right)) ?? "1970-01-01"),
  );
  const unique = new Set<string>();
  const milestones = new Map<number, string>();
  for (const item of ordered) {
    const date = validDate(dateFor(item));
    for (const raw of valuesFor(item)) {
      if (typeof raw !== "string") continue;
      const value = raw.trim().toLowerCase();
      if (!value || unique.has(value)) continue;
      unique.add(value);
      if (date) milestones.set(unique.size, date);
    }
  }
  return {
    value: unique.size,
    completedAt: (target) => milestones.get(target) ?? null,
  };
};

const deckSignature = (deck: DeckRecord) => [
  deck.format ?? "standard",
  [...deck.bakuganIds].sort().join(","),
  [...deck.coreIds].sort().join(","),
  [...deck.cardIds].sort().join(","),
].join("|").toLowerCase();

const distinctDecks = (decks: DeckRecord[]) => {
  const bySignature = new Map<string, DeckRecord>();
  const ordered = [...decks].sort(
    (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
  );
  for (const deck of ordered) {
    const signature = deckSignature(deck);
    if (!bySignature.has(signature)) bySignature.set(signature, deck);
  }
  return [...bySignature.values()];
};

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
): Achievement[] {
  const matches = history.filter(
    (record) => !/disconnect|abandon/i.test(record.reason ?? ""),
  );
  const competitiveMatches = accountStatMatches(matches);
  const wins = competitiveMatches.filter((record) => record.result === "Victor");
  const onlineGames = matches.filter((record) =>
    record.mode === "online" || record.mode === "casual" || record.mode === "ranked",
  );
  const legalDecks = decks.filter(deckIsLegal);
  const legalDistinctDecks = distinctDecks(legalDecks);
  const legalPublicDecks = distinctDecks(
    legalDecks.filter((deck) => deck.visibility === "Public"),
  );
  const legalSingletonDecks = distinctDecks(
    legalDecks.filter((deck) => deck.format === "singleton"),
  );
  const lifetimeMetric = (value: number, fallback: Metric): Metric => ({
    value: Math.max(value, fallback.value),
    completedAt: fallback.completedAt,
  });
  const recentMatches = countMetric(competitiveMatches, (record) => record.at);
  const recentWins = countMetric(wins, (record) => record.at);
  const recentTraining = countMetric(
    matches.filter((record) => record.mode === "training"),
    (record) => record.at,
  );
  const recentOnline = countMetric(onlineGames, (record) => record.at);
  const bo1Games = competitiveMatches.filter((record) => (record.format ?? "bo1") === "bo1");
  const bo3Games = competitiveMatches.filter((record) => record.format === "bo3");
  const metrics: Record<AchievementMetricKey, Metric> = {
    decks: countMetric(decks, (deck) => deck.updatedAt),
    completeDecks: countMetric(legalDistinctDecks, (deck) => deck.updatedAt),
    publicDecks: countMetric(legalPublicDecks, (deck) => deck.publishedAt ?? deck.updatedAt),
    privateDecks: countMetric(decks.filter((deck) => deck.visibility === "Private"), (deck) => deck.updatedAt),
    favouriteDecks: countMetric(decks.filter((deck) => deck.favourite), (deck) => deck.updatedAt),
    describedDecks: countMetric(decks.filter((deck) => Boolean(deck.description?.trim())), (deck) => deck.updatedAt),
    singletonDecks: countMetric(legalSingletonDecks, (deck) => deck.updatedAt),
    deckFactions: uniqueMetric(legalDecks, (deck) => deck.factions, (deck) => deck.updatedAt),
    matches: lifetimeStats
      ? lifetimeMetric(Math.max(0, lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches), recentMatches)
      : recentMatches,
    wins: lifetimeStats ? lifetimeMetric(lifetimeStats.wins, recentWins) : recentWins,
    trainingGames: lifetimeStats
      ? lifetimeMetric(lifetimeStats.trainingMatches, recentTraining)
      : recentTraining,
    bo1Games: countMetric(bo1Games, (record) => record.at),
    bo3Games: countMetric(bo3Games, (record) => record.at),
    bo1Wins: countMetric(bo1Games.filter((record) => record.result === "Victor"), (record) => record.at),
    bo3Wins: countMetric(bo3Games.filter((record) => record.result === "Victor"), (record) => record.at),
    onlineGames: lifetimeStats
      ? lifetimeMetric(lifetimeStats.casualMatches + lifetimeStats.rankedMatches, recentOnline)
      : recentOnline,
    onlineWins: countMetric(
      onlineGames.filter((record) => record.result === "Victor"),
      (record) => record.at,
    ),
    onlineOpponents: uniqueMetric(
      onlineGames,
      (record) => (typeof record.opponent === "string" ? [record.opponent] : []),
      (record) => record.at,
    ),
    uniqueMainCards: uniqueMetric(legalDecks, (deck) => deck.cardIds, (deck) => deck.updatedAt),
    uniqueCharacters: uniqueMetric(legalDecks, (deck) => deck.bakuganIds, (deck) => deck.updatedAt),
    uniqueCores: uniqueMetric(legalDecks, (deck) => deck.coreIds, (deck) => deck.updatedAt),
  };

  return definitions.map((item) => {
    const metric = metrics[item.metric];
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
    };
  });
}

export function sortAchievements(
  achievements: Achievement[],
  status: AchievementStatus,
) {
  return [...achievements]
    .filter((achievement) => achievement.status === status)
    .sort((left, right) => {
      if (status === "completed") {
        const dateDifference =
          Date.parse(right.completedAt ?? "1970-01-01") -
          Date.parse(left.completedAt ?? "1970-01-01");
        if (dateDifference) return dateDifference;
      }
      if (status === "in-progress") {
        const progressDifference =
          right.current / right.target - left.current / left.target;
        if (progressDifference) return progressDifference;
      }
      return left.name.localeCompare(right.name);
    });
}
