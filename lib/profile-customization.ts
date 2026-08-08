export const PROFILE_SHOWCASE_LIMIT = 3;

export const PROFILE_AVATAR_SPRITE =
  "/assets/profile/brawler-profile-icons.svg";

export type ProfileReward = {
  id: string;
  label: string;
  achievementId: string | null;
};

export type ProfileAvatarPreset = {
  id: string;
  label: string;
  position: string;
};

export type ProfileCoverReward = ProfileReward & {
  faction: string | null;
  position: string;
};

export const PROFILE_AVATARS: readonly ProfileAvatarPreset[] = [
  { id: "veronica-venegas", label: "Veronica Venegas", position: "0% 0%" },
  { id: "strata", label: "Strata", position: "25% 0%" },
  { id: "shun-kazami", label: "Shun Kazami", position: "50% 0%" },
  { id: "philomena-dusk", label: "Philomena Dusk", position: "75% 0%" },
  { id: "olivia-styles", label: "Olivia Styles", position: "100% 0%" },
  { id: "max", label: "Max", position: "0% 25%" },
  { id: "masato-kazami", label: "Masato Kazami", position: "25% 25%" },
  { id: "marco", label: "Marco", position: "50% 25%" },
  { id: "maggie", label: "Maggie", position: "75% 25%" },
  { id: "mac", label: "Mac", position: "100% 25%" },
  { id: "lightning", label: "Lightning", position: "0% 50%" },
  { id: "kurin", label: "Kurin", position: "25% 50%" },
  { id: "everett-ray", label: "Everett Ray", position: "50% 50%" },
  { id: "e", label: "E", position: "75% 50%" },
  { id: "duran-dane", label: "Duran Dane", position: "100% 50%" },
  { id: "dee", label: "DEE", position: "0% 75%" },
  {
    id: "col-armstrong-tripp",
    label: "Col. Armstrong Tripp",
    position: "25% 75%",
  },
  { id: "china-riot", label: "China Riot", position: "50% 75%" },
  { id: "cee", label: "CEE", position: "75% 75%" },
  { id: "bill-kouzo", label: "Bill Kouzo", position: "100% 75%" },
  { id: "benton-dusk", label: "Benton Dusk", position: "0% 100%" },
  { id: "bee", label: "BEE", position: "25% 100%" },
  { id: "aay", label: "AAY", position: "50% 100%" },
];

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
    // Preserve the historical default id so existing profiles migrate cleanly.
    id: "battle-planet",
    label: "Ventus Hyper Turtonium Ultra",
    achievementId: null,
    faction: "Ventus",
    position: "50% 0%",
  },
  {
    id: "ventus-maximus-gorthion-ultra",
    label: "Ventus Maximus Gorthion Ultra",
    achievementId: null,
    faction: "Ventus",
    position: "50% 11.1111%",
  },
  {
    id: "aquos-hyper-trox-ultra",
    label: "Aquos Hyper Trox Ultra",
    achievementId: null,
    faction: "Aquos",
    position: "50% 22.2222%",
  },
  {
    id: "darkus-hyper-serpenteze-ultra",
    label: "Darkus Hyper Serpenteze Ultra",
    achievementId: null,
    faction: "Darkus",
    position: "50% 33.3333%",
  },
  {
    id: "darkus-turtonium",
    label: "Darkus Turtonium",
    achievementId: null,
    faction: "Darkus",
    position: "50% 44.4444%",
  },
  {
    id: "haos-hyper-turtonium-ultra",
    label: "Haos Hyper Turtonium Ultra",
    achievementId: null,
    faction: "Haos",
    position: "50% 55.5556%",
  },
  {
    id: "haos-hyper-turtonium",
    label: "Haos Hyper Turtonium",
    achievementId: null,
    faction: "Haos",
    position: "50% 66.6667%",
  },
  {
    id: "haos-turtonium-ultra",
    label: "Haos Turtonium Ultra",
    achievementId: null,
    faction: "Haos",
    position: "50% 77.7778%",
  },
  {
    id: "pyrus-hyper-trox-ultra",
    label: "Pyrus Hyper Trox Ultra",
    achievementId: null,
    faction: "Pyrus",
    position: "50% 88.8889%",
  },
  {
    id: "pyrus-webam-ultra",
    label: "Pyrus Webam Ultra",
    achievementId: null,
    faction: "Pyrus",
    position: "50% 100%",
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
  const match = /^preset:([a-z0-9-]{1,120})$/i.exec(value);
  if (!match) return "";
  return PROFILE_AVATARS.some((item) => item.id === match[1]) ? value : "";
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
