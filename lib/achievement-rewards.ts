import { ACHIEVEMENT_DEFINITIONS } from "./achievements";
import {
  PROFILE_AVATARS,
  PROFILE_COVERS,
  PROFILE_TITLES,
} from "./profile-customization";
import { PROFILE_REWARD_UNAVAILABLE } from "./profile-reward-runtime";

export { PROFILE_REWARD_UNAVAILABLE } from "./profile-reward-runtime";

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

type RewardGroupConfig = {
  key: keyof AchievementRewardAssignments;
  ids: readonly string[];
  fallback: Record<string, string | null>;
  alwaysAvailable: ReadonlySet<string>;
};

const REWARD_GROUPS: readonly RewardGroupConfig[] = [
  {
    key: "titles",
    ids: PROFILE_TITLES.map((item) => item.id),
    fallback: DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.titles,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.titles,
  },
  {
    key: "covers",
    ids: PROFILE_COVERS.map((item) => item.id),
    fallback: DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.covers,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.covers,
  },
  {
    key: "avatars",
    ids: PROFILE_AVATARS.map((item) => item.id),
    fallback: DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS.avatars,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.avatars,
  },
];

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeAchievementRewardAssignments(
  value: unknown,
  allowedAchievementIds: ReadonlySet<string> = achievementIds,
): AchievementRewardAssignments {
  const input = recordValue(value);
  const result: AchievementRewardAssignments = {
    titles: {},
    covers: {},
    avatars: {},
  };
  const claimedAchievementIds = new Set<string>();
  const fallbackQueue: Array<{ group: RewardGroupConfig; id: string }> = [];

  // Explicit administrator choices win before bundled defaults are considered.
  // This also makes uniqueness deterministic when an old payload contains a
  // duplicate assignment: the first explicit reward in catalogue order wins.
  for (const group of REWARD_GROUPS) {
    const groupInput = recordValue(input[group.key]);
    for (const id of group.ids) {
      if (group.alwaysAvailable.has(id)) {
        result[group.key][id] = null;
        continue;
      }
      const candidate = groupInput[id];
      if (candidate === PROFILE_REWARD_UNAVAILABLE) {
        result[group.key][id] = PROFILE_REWARD_UNAVAILABLE;
        continue;
      }
      if (candidate === null || candidate === "") {
        result[group.key][id] = null;
        continue;
      }
      if (typeof candidate === "string" && allowedAchievementIds.has(candidate)) {
        if (!claimedAchievementIds.has(candidate)) {
          claimedAchievementIds.add(candidate);
          result[group.key][id] = candidate;
        } else {
          result[group.key][id] = null;
        }
        continue;
      }
      result[group.key][id] = null;
      fallbackQueue.push({ group, id });
    }
  }

  // Fill omitted or invalid entries from the bundled catalogue only after all
  // explicit choices have claimed their achievements.
  for (const { group, id } of fallbackQueue) {
    const fallbackCandidate = group.fallback[id] ?? null;
    if (
      fallbackCandidate &&
      allowedAchievementIds.has(fallbackCandidate) &&
      !claimedAchievementIds.has(fallbackCandidate)
    ) {
      claimedAchievementIds.add(fallbackCandidate);
      result[group.key][id] = fallbackCandidate;
    }
  }

  return result;
}

export function rewardAssignmentIsAchievement(value: string | null | undefined) {
  return Boolean(value && value !== PROFILE_REWARD_UNAVAILABLE);
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
