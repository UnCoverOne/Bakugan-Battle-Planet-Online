import {
  ACHIEVEMENT_CATEGORIES,
  type Achievement,
  type AchievementCategory,
} from "./achievements";
import { validateDeck, type DeckRecord } from "./data";
import { deckSetName } from "./deck-set";
import type { BrawlerProfile } from "./persistence";
import {
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  PROFILE_TITLES,
  normalizeProfileAvatar,
  normalizeProfileCover,
  normalizeProfileTitle,
  normalizeShowcaseIds,
} from "./profile-customization";

export type PublicProfileAchievement = Pick<
  Achievement,
  "id" | "name" | "description" | "category"
>;

export type PublicProfileDeck = {
  id: string;
  name: string;
  factions: string[];
  bakuganIds: string[];
  setName: string;
  isLegal: boolean;
};

export type PublicRankedProfile = {
  rank: string;
  bp: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type PublicProfileStats = {
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
};

export type PublicBrawlerProfile = {
  userId: string;
  displayName: string;
  faction: string;
  joinedAt: number | null;
  avatar: string;
  titleId: string;
  coverId: string;
  stats: PublicProfileStats;
  ranked: PublicRankedProfile | null;
  showcaseAchievements: PublicProfileAchievement[];
  showcaseDecks: PublicProfileDeck[];
};

const VALID_FACTIONS = new Set([
  "Pyrus",
  "Aquos",
  "Darkus",
  "Haos",
  "Ventus",
  "Aurelus",
]);
const VALID_ACHIEVEMENT_CATEGORIES = new Set<string>(ACHIEVEMENT_CATEGORIES);
const LEGACY_ACHIEVEMENT_CATEGORIES: Record<string, AchievementCategory> = {
  Battle: "Arena",
  "Getting Started": "Arena",
  "Deck Building": "Arsenal",
  "Online Play": "Brawler Network",
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const percent = (value: unknown) => Math.min(100, count(value));

const strings = (value: unknown, limit: number, itemLimit = 120) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, itemLimit))
        .filter(Boolean)
        .slice(0, limit)
    : [];

const achievementCategory = (value: unknown): AchievementCategory => {
  const candidate = text(value, 80);
  if (VALID_ACHIEVEMENT_CATEGORIES.has(candidate)) return candidate as AchievementCategory;
  return LEGACY_ACHIEVEMENT_CATEGORIES[candidate] ?? "Arena";
};

export function publicDeckSummary(deck: DeckRecord): PublicProfileDeck {
  return {
    id: deck.id,
    name: deck.name,
    factions: deck.factions.slice(0, 6),
    bakuganIds: deck.bakuganIds.slice(0, 3),
    setName: deckSetName(deck),
    isLegal: validateDeck(deck).isLegal,
  };
}

export function buildPublicBrawlerProfile(input: {
  userId: string;
  joinedAt?: number | null;
  profile: BrawlerProfile;
  decks: DeckRecord[];
  achievements: Achievement[];
  stats: PublicProfileStats;
  ranked?: PublicRankedProfile | null;
}): PublicBrawlerProfile {
  const publicDecks = input.decks.filter((deck) => deck.visibility === "Public");
  const selectedAchievements = normalizeShowcaseIds(
    input.profile.showcaseAchievementIds,
  )
    .map((id) => input.achievements.find((achievement) => achievement.id === id))
    .filter(
      (achievement): achievement is Achievement =>
        Boolean(achievement?.unlocked),
    )
    .slice(0, PROFILE_SHOWCASE_LIMIT)
    .map(({ id, name, description, category }) => ({
      id,
      name,
      description,
      category,
    }));
  const selectedDecks = normalizeShowcaseIds(input.profile.showcaseDeckIds)
    .map((id) => publicDecks.find((deck) => deck.id === id))
    .filter((deck): deck is DeckRecord => Boolean(deck))
    .slice(0, PROFILE_SHOWCASE_LIMIT)
    .map(publicDeckSummary);

  return normalizePublicBrawlerProfile({
    userId: input.userId,
    displayName: input.profile.name,
    faction: input.profile.faction,
    joinedAt: input.joinedAt ?? null,
    avatar: input.profile.avatar,
    titleId: input.profile.titleId,
    coverId: input.profile.coverId,
    stats: input.stats,
    ranked: input.ranked ?? null,
    showcaseAchievements: selectedAchievements,
    showcaseDecks: selectedDecks,
  })!;
}

export function normalizePublicBrawlerProfile(
  value: unknown,
): PublicBrawlerProfile | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const userId = text(input.userId, 100);
  const displayName = text(input.displayName, 20);
  if (!userId || !displayName) return null;

  const factionInput = text(input.faction, 20);
  const faction = VALID_FACTIONS.has(factionInput) ? factionInput : "Pyrus";
  const joined = Number(input.joinedAt);
  const joinedAt = Number.isFinite(joined) && joined > 0 ? Math.floor(joined) : null;
  const statsInput =
    input.stats && typeof input.stats === "object"
      ? (input.stats as Record<string, unknown>)
      : {};
  const rankedInput =
    input.ranked && typeof input.ranked === "object"
      ? (input.ranked as Record<string, unknown>)
      : null;

  const showcaseAchievements = Array.isArray(input.showcaseAchievements)
    ? input.showcaseAchievements
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .map((item) => ({
          id: text(item.id, 120),
          name: text(item.name, 120),
          description: text(item.description, 500),
          category: achievementCategory(item.category),
        }))
        .filter((item) => item.id && item.name)
        .slice(0, PROFILE_SHOWCASE_LIMIT)
    : [];

  const showcaseDecks = Array.isArray(input.showcaseDecks)
    ? input.showcaseDecks
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .map((item) => ({
          id: text(item.id, 120),
          name: text(item.name, 60),
          factions: strings(item.factions, 6, 20),
          bakuganIds: strings(item.bakuganIds, 3, 120),
          setName: text(item.setName, 80),
          isLegal: Boolean(item.isLegal),
        }))
        .filter((item) => item.id && item.name)
        .slice(0, PROFILE_SHOWCASE_LIMIT)
    : [];

  return {
    userId,
    displayName,
    faction,
    joinedAt,
    avatar: normalizeProfileAvatar(input.avatar),
    titleId: normalizeProfileTitle(input.titleId ?? PROFILE_TITLES[0].id),
    coverId: normalizeProfileCover(input.coverId ?? PROFILE_COVERS[0].id),
    stats: {
      gamesPlayed: count(statsInput.gamesPlayed),
      gamesWon: count(statsInput.gamesWon),
      winRate: percent(statsInput.winRate),
    },
    ranked: rankedInput
      ? {
          rank: text(rankedInput.rank, 80) || "Unranked",
          bp: count(rankedInput.bp),
          wins: count(rankedInput.wins),
          losses: count(rankedInput.losses),
          winRate: percent(rankedInput.winRate),
        }
      : null,
    showcaseAchievements,
    showcaseDecks,
  };
}
