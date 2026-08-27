import { achievementsFor, applyAchievementCompletions } from "./achievements";
import { loadAchievementDefinitions } from "./achievement-configuration-server";
import { loadAchievementRewardAssignments } from "./achievement-rewards-server";
import { loadAccountDataPayload } from "./account-data-server";
import type { AccountDatabase } from "./account-server";
import { accountStatMatches } from "./match-statistics";
import {
  normalizeAchievementCompletions,
  normalizeLifetimeMatchStats,
  type BrawlerProfile,
} from "./persistence";
import {
  PROFILE_COVERS,
  PROFILE_TITLES,
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
    achievementCompletions: normalizeAchievementCompletions(
      profile.achievementCompletions,
    ),
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
        ranked_ratings.losses AS ranked_losses
      FROM users
      LEFT JOIN ranked_ratings ON ranked_ratings.user_id = users.id
      LEFT JOIN account_bans ON account_bans.user_id = users.id
      WHERE users.id = ? AND account_bans.user_id IS NULL`,
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const snapshot = (await loadAccountDataPayload(db, userId)).data;
  const decks = snapshot?.decks ?? [];
  const history = snapshot?.history ?? [];
  const lifetimeStats = normalizeLifetimeMatchStats(snapshot?.lifetimeStats);
  const profile = snapshotProfile(snapshot?.profile, {
    displayName: String(row.display_name),
    faction: String(row.faction),
  });
  const achievementDefinitions = await loadAchievementDefinitions(db);
  const activeAchievementIds = new Set(achievementDefinitions.map((item) => item.id));
  const assignments = await loadAchievementRewardAssignments(db, activeAchievementIds);
  const achievements = applyAchievementCompletions(
    achievementsFor(decks, history, lifetimeStats, achievementDefinitions),
    profile.achievementCompletions,
  );
  const completedAchievementIds = new Set(
    achievements.filter((item) => item.unlocked).map((item) => item.id),
  );
  const titleRequirement = assignments.titles[profile.titleId] ?? null;
  if (titleRequirement && !completedAchievementIds.has(titleRequirement)) {
    profile.titleId = PROFILE_TITLES[0].id;
  }
  const coverRequirement = assignments.covers[profile.coverId] ?? null;
  if (coverRequirement && !completedAchievementIds.has(coverRequirement)) {
    profile.coverId = PROFILE_COVERS[0].id;
  }
  const avatarMatch = /^preset:([a-z0-9-]{1,120})$/i.exec(profile.avatar ?? "");
  if (avatarMatch) {
    const avatarRequirement = assignments.avatars[avatarMatch[1]] ?? null;
    if (avatarRequirement && !completedAchievementIds.has(avatarMatch[1])) {
      profile.avatar = "";
    }
  }
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
