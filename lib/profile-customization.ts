export const PROFILE_SHOWCASE_LIMIT = 3;

export type ProfileReward = {
  id: string;
  label: string;
  achievementId: string | null;
};

export type ProfileCoverReward = ProfileReward & {
  faction: string | null;
};

export const PROFILE_TITLES: readonly ProfileReward[] = [
  {
    id: "battle-planet-brawler",
    label: "Battle Planet Brawler",
    achievementId: null,
  },
  { id: "battle-ready", label: "Battle Ready", achievementId: "first-deck" },
  {
    id: "arsenal-architect",
    label: "Arsenal Architect",
    achievementId: "deck-builder",
  },
  { id: "first-victor", label: "First Victor", achievementId: "first-win" },
  {
    id: "seasoned-brawler",
    label: "Seasoned Brawler",
    achievementId: "veteran",
  },
  {
    id: "strategy-publisher",
    label: "Strategy Publisher",
    achievementId: "publisher",
  },
  {
    id: "connected-brawler",
    label: "Connected Brawler",
    achievementId: "online",
  },
];

export const PROFILE_COVERS: readonly ProfileCoverReward[] = [
  {
    id: "battle-planet",
    label: "Battle Planet",
    achievementId: null,
    faction: null,
  },
  {
    id: "pyrus-first-brawl",
    label: "Pyrus First Brawl",
    achievementId: "first-brawl",
    faction: "Pyrus",
  },
  {
    id: "aquos-architect",
    label: "Aquos Architect",
    achievementId: "deck-builder",
    faction: "Aquos",
  },
  {
    id: "darkus-victory",
    label: "Darkus Victory",
    achievementId: "first-win",
    faction: "Darkus",
  },
  {
    id: "ventus-veteran",
    label: "Ventus Veteran",
    achievementId: "veteran",
    faction: "Ventus",
  },
  {
    id: "aurelus-network",
    label: "Aurelus Network",
    achievementId: "online",
    faction: "Aurelus",
  },
];

const uniqueIds = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, 120))
            .filter(Boolean),
        ),
      ].slice(0, PROFILE_SHOWCASE_LIMIT)
    : [];

export function normalizeShowcaseIds(value: unknown) {
  return uniqueIds(value);
}

export function normalizeProfileAvatar(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  if (/^preset:[a-z0-9-]{1,120}$/i.test(value)) return value;
  if (
    value.length <= 700_000 &&
    /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
  ) {
    return value;
  }
  return "";
}

export function normalizeProfileTitle(value: unknown) {
  return (
    PROFILE_TITLES.find((item) => item.id === value)?.id ??
    PROFILE_TITLES[0].id
  );
}

export function normalizeProfileCover(value: unknown) {
  return (
    PROFILE_COVERS.find((item) => item.id === value)?.id ??
    PROFILE_COVERS[0].id
  );
}

export function profileRewardUnlocked(
  reward: ProfileReward,
  completedAchievementIds: ReadonlySet<string>,
) {
  return (
    reward.achievementId === null ||
    completedAchievementIds.has(reward.achievementId)
  );
}

export function toggleShowcaseId(
  current: readonly string[] | undefined,
  id: string,
) {
  const normalized = normalizeShowcaseIds(current);
  if (normalized.includes(id)) {
    return {
      ids: normalized.filter((item) => item !== id),
      reachedLimit: false,
    };
  }
  if (normalized.length >= PROFILE_SHOWCASE_LIMIT) {
    return { ids: normalized, reachedLimit: true };
  }
  return { ids: [...normalized, id], reachedLimit: false };
}
