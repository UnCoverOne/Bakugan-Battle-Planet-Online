export type RuntimeRewardGroup = "titles" | "covers" | "avatars";
export type RuntimeRewardAssignments = Record<
  RuntimeRewardGroup,
  Record<string, string | null>
>;

export const PROFILE_REWARD_UNAVAILABLE = "__unavailable__";

let activeAssignments: RuntimeRewardAssignments | null = null;
let activeCompletedAchievementIds: ReadonlySet<string> = new Set();

export function setProfileRewardRuntime(
  assignments: RuntimeRewardAssignments,
  completedAchievementIds: ReadonlySet<string>,
) {
  activeAssignments = assignments;
  activeCompletedAchievementIds = completedAchievementIds;
}

export function resetProfileRewardRuntime() {
  activeAssignments = null;
  activeCompletedAchievementIds = new Set();
}

export function profileRewardRequirement(
  group: RuntimeRewardGroup,
  rewardId: string,
  fallback: string | null,
) {
  const configured = activeAssignments?.[group]?.[rewardId];
  return configured === undefined ? fallback : configured;
}

export function runtimeProfileRewardAvailable(
  group: RuntimeRewardGroup,
  rewardId: string,
  fallback: string | null = null,
) {
  return profileRewardRequirement(group, rewardId, fallback) !== PROFILE_REWARD_UNAVAILABLE;
}

export function runtimeProfileRewardUnlocked(
  group: RuntimeRewardGroup,
  rewardId: string,
  fallback: string | null = null,
) {
  const achievementId = profileRewardRequirement(group, rewardId, fallback);
  return achievementId === null ||
    (achievementId !== PROFILE_REWARD_UNAVAILABLE && activeCompletedAchievementIds.has(achievementId));
}
