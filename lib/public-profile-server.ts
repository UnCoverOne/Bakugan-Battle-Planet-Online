import { achievementsFor } from "./achievements";
import type { AccountDatabase } from "./account-server";
import { accountStatMatches } from "./match-statistics";
import type { DeckRecord } from "./data";
import {
  normalizeLifetimeMatchStats,
  type BrawlerProfile,
  type MatchResultRecord,
} from "./persistence";
import {
  normalizeProfileAvatar,
  normalizeProfileCover,
  normalizeProfileTitle,
  normalizeShowcaseIds,
} from "./profile-customization";
import {
  buildPublicBrawlerProfile,
  type PublicBrawlerProfile,
} from "./public-profile";
import { rankForBp } from "./ranked";
import { ensureRankedSchema } from "./ranked-server";

const VALID_FACTIONS = new Set([
  "Pyrus",
  "Aquos",
  "Darkus",
  "Haos",
  "Ventus",
  "Aurelus",
]);

function readSnapshot(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function storedDecks(value: unknown): DeckRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is DeckRecord => {
    if (!candidate || typeof candidate !== "object") return false;
    const deck = candidate as Partial<DeckRecord>;
    return Boolean(
      typeof deck.id === "string" &&
        typeof deck.name === "string" &&
        Array.isArray(deck.factions) &&
        Array.isArray(deck.bakuganIds) &&
        Array.isArray(deck.coreIds) &&
        Array.isArray(deck.cardIds),
    );
  });
}

function storedHistory(value: unknown): Array<Partial<MatchResultRecord>> {
  return Array.isArray(value)
    ? value.filter(
        (candidate): candidate is Partial<MatchResultRecord> =>
          Boolean(candidate && typeof candidate === "object"),
      )
    : [];
}

function snapshotProfile(
  value: unknown,
  fallback: { displayName: string; faction: string },
): BrawlerProfile {
  const profile =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const name =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim().slice(0, 20)
      : fallback.displayName;
  const requestedFaction =
    typeof profile.faction === "string" ? profile.faction : fallback.faction;
  return {
    name,
    faction: VALID_FACTIONS.has(requestedFaction)
      ? requestedFaction
      : fallback.faction,
    signedIn: false,
    avatar: normalizeProfileAvatar(profile.avatar),
    titleId: normalizeProfileTitle(profile.titleId),
    coverId: normalizeProfileCover(profile.coverId),
    showcaseAchievementIds: normalizeShowcaseIds(
      profile.showcaseAchievementIds,
    ),
    showcaseDeckIds: normalizeShowcaseIds(profile.showcaseDeckIds),
  };
}

export async function publicBrawlerProfile(
  db: AccountDatabase,
  userId: string,
): Promise<PublicBrawlerProfile | null> {
  await ensureRankedSchema(db);
  const row = await db
    .prepare(
      `SELECT users.id, users.display_name, users.faction, users.created_at,
        ranked_ratings.user_id AS ranked_user_id,
        ranked_ratings.bp, ranked_ratings.wins AS ranked_wins,
        ranked_ratings.losses AS ranked_losses,
        user_data.data_json
      FROM users
      LEFT JOIN ranked_ratings ON ranked_ratings.user_id = users.id
      LEFT JOIN user_data ON user_data.user_id = users.id
      LEFT JOIN account_bans ON account_bans.user_id = users.id
      WHERE users.id = ? AND account_bans.user_id IS NULL`,
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const snapshot = readSnapshot(row.data_json);
  const decks = storedDecks(snapshot.decks);
  const history = storedHistory(snapshot.history);
  const lifetimeStats = normalizeLifetimeMatchStats(snapshot.lifetimeStats);
  const profile = snapshotProfile(snapshot.profile, {
    displayName: String(row.display_name),
    faction: String(row.faction),
  });
  const achievements = achievementsFor(decks, history, lifetimeStats);
  const completedGames = accountStatMatches(history);
  const gamesPlayed = Math.max(
    completedGames.length,
    lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches,
  );
  const gamesWon = Math.max(
    completedGames.filter((record) => record.result === "Victor").length,
    lifetimeStats.wins,
  );
  const rankedWins = Number(row.ranked_wins ?? 0);
  const rankedLosses = Number(row.ranked_losses ?? 0);
  const bp = Number(row.bp ?? 0);

  return buildPublicBrawlerProfile({
    userId: String(row.id),
    joinedAt: Number(row.created_at),
    profile,
    decks,
    achievements,
    stats: {
      gamesPlayed,
      gamesWon,
      winRate: gamesPlayed ? Math.round((gamesWon / gamesPlayed) * 100) : 0,
    },
    ranked: row.ranked_user_id
      ? {
          bp,
          rank: rankForBp(bp),
          wins: rankedWins,
          losses: rankedLosses,
          winRate:
            rankedWins + rankedLosses
              ? Math.round((rankedWins / (rankedWins + rankedLosses)) * 100)
              : 0,
        }
      : null,
  });
}
