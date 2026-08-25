import { ACHIEVEMENT_DEFINITIONS } from "./achievements";
import {
  PROFILE_AVATARS,
  PROFILE_COVERS,
  PROFILE_TITLES,
} from "./profile-customization";

export type AchievementRewardKind = "title" | "cover" | "avatar";
export type AchievementRewardAssignments = {
  titles: Record<string, string | null>;
  covers: Record<string, string | null>;
  avatars: Record<string, string | null>;
};

const achievementIds = new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id));

export const ALWAYS_AVAILABLE_PROFILE_REWARDS = {
  titles: new Set(["battle-planet-brawler"]),
  covers: new Set(["battle-planet"]),
  avatars: new Set<string>(),
} as const;

export const DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS: AchievementRewardAssignments = {
  titles: Object.fromEntries(
    PROFILE_TITLES.map((item) => [item.id, item.achievementId]),
  ),
  covers: Object.fromEntries(
    PROFILE_COVERS.map((item) => [item.id, item.achievementId]),
  ),
  avatars: Object.fromEntries(PROFILE_AVATARS.map((item) => [item.id, null])),
};

function normalizeGroup(
  value: unknown,
  ids: readonly string[],
  fallback: Record<string, string | null>,
  alwaysAvailable: ReadonlySet<string>,
) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(ids.map((id) => {
    if (alwaysAvailable.has(id)) return [id, null];
    const candidate = input[id];
    if (candidate === null || candidate === "") return [id, null];
    if (typeof candidate === "string" && achievementIds.has(candidate)) {
      return [id, candidate];
    }
    return [id, fallback[id] ?? null];
  }));
}

export function normalizeAchievementRewardAssignments(
  value: unknown,
): AchievementRewardAssignments {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    titles: normalizeGroup(
      input.titles,
      PROFILE_TITLES.map((item) => item.id),
      DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.titles,
      ALWAYS_AVAILABLE_PROFILE_REWARDS.titles,
    ),
    covers: normalizeGroup(
      input.covers,
      PROFILE_COVERS.map((item) => item.id),
      DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.covers,
      ALWAYS_AVAILABLE_PROFILE_REWARDS.covers,
    ),
    avatars: normalizeGroup(
      input.avatars,
      PROFILE_AVATARS.map((item) => item.id),
      DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.avatars,
      ALWAYS_AVAILABLE_PROFILE_REWARDS.avatars,
    ),
  };
}

export function configuredProfileRewardCatalogues(value: unknown) {
  const assignments = normalizeAchievementRewardAssignments(value);
  return {
    titles: PROFILE_TITLES.map((item) => ({
      ...item,
      achievementId: assignments.titles[item.id] ?? null,
    })),
    covers: PROFILE_COVERS.map((item) => ({
      ...item,
      achievementId: assignments.covers[item.id] ?? null,
    })),
    avatars: PROFILE_AVATARS.map((item) => ({
      ...item,
      achievementId: assignments.avatars[item.id] ?? null,
    })),
  };
}
