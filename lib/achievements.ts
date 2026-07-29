import type { DeckRecord } from "./data";
import type { MatchResultRecord } from "./persistence";

export const ACHIEVEMENT_CATEGORIES = [
  "Getting Started",
  "Deck Building",
  "Battle",
  "Compendium",
  "Online Play",
] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];
export type AchievementStatus = "completed" | "in-progress" | "locked";

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

type MetricKey =
  | "decks"
  | "completeDecks"
  | "publicDecks"
  | "privateDecks"
  | "favouriteDecks"
  | "describedDecks"
  | "singletonDecks"
  | "deckFactions"
  | "matches"
  | "wins"
  | "trainingGames"
  | "bo1Games"
  | "bo3Games"
  | "onlineGames"
  | "onlineWins"
  | "onlineOpponents"
  | "uniqueMainCards"
  | "uniqueCharacters"
  | "uniqueCores";

type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  metric: MetricKey;
  target: number;
};

const definition = (
  id: string,
  name: string,
  description: string,
  category: AchievementCategory,
  metric: MetricKey,
  target: number,
): AchievementDefinition => ({ id, name, description, category, metric, target });

/**
 * The first seven IDs are the original catalogue. The remaining 50 entries
 * extend it without invalidating existing completion expectations.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  definition("first-deck", "Battle Ready", "Complete your first 40-card, three-Character, six-Core deck.", "Deck Building", "completeDecks", 1),
  definition("deck-builder", "Arsenal Architect", "Complete three decks.", "Deck Building", "completeDecks", 3),
  definition("first-brawl", "Enter the Brawl", "Finish your first game.", "Getting Started", "matches", 1),
  definition("first-win", "First Victory", "Win your first game.", "Battle", "wins", 1),
  definition("veteran", "Seasoned Brawler", "Win ten games.", "Battle", "wins", 10),
  definition("publisher", "Share the Strategy", "Publish a deck to the Public Deck Library.", "Deck Building", "publicDecks", 1),
  definition("online", "Connected Brawler", "Complete an online game.", "Online Play", "onlineGames", 1),

  // 50 additional achievements, grouped by shared method and theme.
  definition("private-plan", "Private Plans", "Save a deck with Private visibility.", "Getting Started", "privateDecks", 1),
  definition("favourite-plan", "Trusted Arsenal", "Mark a deck as a favourite.", "Getting Started", "favouriteDecks", 1),
  definition("first-series", "Best of Three", "Complete a best-of-three match.", "Getting Started", "bo3Games", 1),
  definition("training-day", "Training Day", "Complete a Training AI match.", "Getting Started", "trainingGames", 1),
  definition("singleton-start", "One of a Kind", "Save a Singleton-format deck.", "Getting Started", "singletonDecks", 1),

  definition("decks-five", "Prepared for Anything", "Save five decks.", "Deck Building", "decks", 5),
  definition("decks-ten", "Vault Keeper", "Save ten decks.", "Deck Building", "decks", 10),
  definition("complete-five", "Loadout Specialist", "Complete five legal-sized decks.", "Deck Building", "completeDecks", 5),
  definition("complete-ten", "Master Architect", "Complete ten legal-sized decks.", "Deck Building", "completeDecks", 10),
  definition("public-three", "Strategy Contributor", "Publish three decks.", "Deck Building", "publicDecks", 3),
  definition("public-five", "Community Architect", "Publish five decks.", "Deck Building", "publicDecks", 5),
  definition("private-three", "Hidden Laboratory", "Save three Private decks.", "Deck Building", "privateDecks", 3),
  definition("private-five", "Secret Arsenal", "Save five Private decks.", "Deck Building", "privateDecks", 5),
  definition("favourite-three", "Go-To Lineups", "Mark three decks as favourites.", "Deck Building", "favouriteDecks", 3),
  definition("favourite-five", "Curated Arsenal", "Mark five decks as favourites.", "Deck Building", "favouriteDecks", 5),
  definition("described-one", "Deck Identity", "Add a description to a saved deck.", "Deck Building", "describedDecks", 1),
  definition("described-three", "Field Notes", "Add descriptions to three saved decks.", "Deck Building", "describedDecks", 3),
  definition("singleton-three", "Singleton Specialist", "Save three Singleton-format decks.", "Deck Building", "singletonDecks", 3),
  definition("all-factions", "Battle Planet Coalition", "Use all six factions across your saved decks.", "Deck Building", "deckFactions", 6),

  definition("games-five", "Finding Your Feet", "Finish five games.", "Battle", "matches", 5),
  definition("games-ten", "Regular Brawler", "Finish ten games.", "Battle", "matches", 10),
  definition("games-twenty-five", "Battle Tested", "Finish twenty-five games.", "Battle", "matches", 25),
  definition("games-fifty", "Arena Veteran", "Finish fifty games.", "Battle", "matches", 50),
  definition("games-one-hundred", "Century of Brawls", "Finish one hundred games.", "Battle", "matches", 100),
  definition("wins-five", "Winning Form", "Win five games.", "Battle", "wins", 5),
  definition("wins-twenty-five", "Dominant Record", "Win twenty-five games.", "Battle", "wins", 25),
  definition("wins-fifty", "Battle Master", "Win fifty games.", "Battle", "wins", 50),
  definition("training-five", "Sparring Partner", "Complete five Training AI games.", "Battle", "trainingGames", 5),
  definition("training-ten", "Simulation Regular", "Complete ten Training AI games.", "Battle", "trainingGames", 10),
  definition("training-twenty-five", "AI Analyst", "Complete twenty-five Training AI games.", "Battle", "trainingGames", 25),
  definition("bo1-ten", "Quick Brawl Expert", "Complete ten best-of-one games.", "Battle", "bo1Games", 10),

  definition("online-five", "Network Regular", "Complete five online games.", "Online Play", "onlineGames", 5),
  definition("online-ten", "Connected Competitor", "Complete ten online games.", "Online Play", "onlineGames", 10),
  definition("online-twenty-five", "Online Veteran", "Complete twenty-five online games.", "Online Play", "onlineGames", 25),
  definition("online-fifty", "Global Brawler", "Complete fifty online games.", "Online Play", "onlineGames", 50),
  definition("online-wins-five", "Network Victor", "Win five online games.", "Online Play", "onlineWins", 5),
  definition("online-wins-ten", "Online Contender", "Win ten online games.", "Online Play", "onlineWins", 10),
  definition("opponents-five", "Expanding Rivals", "Face five different online opponents.", "Online Play", "onlineOpponents", 5),
  definition("opponents-ten", "Known Across the Planet", "Face ten different online opponents.", "Online Play", "onlineOpponents", 10),

  definition("cards-ten", "Catalogue Primer", "Use ten different Main Deck cards across saved decks.", "Compendium", "uniqueMainCards", 10),
  definition("cards-twenty-five", "Card Researcher", "Use twenty-five different Main Deck cards across saved decks.", "Compendium", "uniqueMainCards", 25),
  definition("cards-fifty", "Compendium Student", "Use fifty different Main Deck cards across saved decks.", "Compendium", "uniqueMainCards", 50),
  definition("cards-one-hundred", "Compendium Scholar", "Use one hundred different Main Deck cards across saved decks.", "Compendium", "uniqueMainCards", 100),
  definition("cards-two-hundred", "Living Catalogue", "Use two hundred different Main Deck cards across saved decks.", "Compendium", "uniqueMainCards", 200),
  definition("characters-three", "Bakugan Research", "Use three different Character Cards across saved decks.", "Compendium", "uniqueCharacters", 3),
  definition("characters-six", "Expanded Team Data", "Use six different Character Cards across saved decks.", "Compendium", "uniqueCharacters", 6),
  definition("characters-twelve", "Bakugan Specialist", "Use twelve different Character Cards across saved decks.", "Compendium", "uniqueCharacters", 12),
  definition("cores-six", "Core Sample", "Use six different BakuCores across saved decks.", "Compendium", "uniqueCores", 6),
  definition("cores-twelve", "Core Catalogue", "Use twelve different BakuCores across saved decks.", "Compendium", "uniqueCores", 12),
  definition("faction-catalogue", "Faction Field Guide", "Represent all six factions across saved decks.", "Compendium", "deckFactions", 6),
];

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

const legalSized = (deck: DeckRecord) =>
  deck.cardIds.length === 40 &&
  deck.bakuganIds.length === 3 &&
  deck.coreIds.length === 6;

export function achievementStatus(current: number, target: number): AchievementStatus {
  if (current >= target) return "completed";
  return current > 0 ? "in-progress" : "locked";
}

export function achievementsFor(
  decks: DeckRecord[],
  history: MatchResultRecord[],
): Achievement[] {
  const matches = history.filter(
    (record) => !/disconnect|abandon/i.test(record.reason ?? ""),
  );
  const wins = matches.filter((record) => record.result === "Victor");
  const onlineGames = matches.filter((record) => record.mode === "online");
  const metrics: Record<MetricKey, Metric> = {
    decks: countMetric(decks, (deck) => deck.updatedAt),
    completeDecks: countMetric(decks.filter(legalSized), (deck) => deck.updatedAt),
    publicDecks: countMetric(decks.filter((deck) => deck.visibility === "Public"), (deck) => deck.publishedAt ?? deck.updatedAt),
    privateDecks: countMetric(decks.filter((deck) => deck.visibility === "Private"), (deck) => deck.updatedAt),
    favouriteDecks: countMetric(decks.filter((deck) => deck.favourite), (deck) => deck.updatedAt),
    describedDecks: countMetric(decks.filter((deck) => Boolean(deck.description?.trim())), (deck) => deck.updatedAt),
    singletonDecks: countMetric(decks.filter((deck) => deck.format === "singleton"), (deck) => deck.updatedAt),
    deckFactions: uniqueMetric(decks, (deck) => deck.factions, (deck) => deck.updatedAt),
    matches: countMetric(matches, (record) => record.at),
    wins: countMetric(wins, (record) => record.at),
    trainingGames: countMetric(matches.filter((record) => record.mode === "training"), (record) => record.at),
    bo1Games: countMetric(matches.filter((record) => (record.format ?? "bo1") === "bo1"), (record) => record.at),
    bo3Games: countMetric(matches.filter((record) => record.format === "bo3"), (record) => record.at),
    onlineGames: countMetric(onlineGames, (record) => record.at),
    onlineWins: countMetric(onlineGames.filter((record) => record.result === "Victor"), (record) => record.at),
    onlineOpponents: uniqueMetric(onlineGames, (record) => [record.opponent], (record) => record.at),
    uniqueMainCards: uniqueMetric(decks, (deck) => deck.cardIds, (deck) => deck.updatedAt),
    uniqueCharacters: uniqueMetric(decks, (deck) => deck.bakuganIds, (deck) => deck.updatedAt),
    uniqueCores: uniqueMetric(decks, (deck) => deck.coreIds, (deck) => deck.updatedAt),
  };

  return ACHIEVEMENT_DEFINITIONS.map((item) => {
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
      completedAt:
        status === "completed" ? metric.completedAt(item.target) : null,
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
