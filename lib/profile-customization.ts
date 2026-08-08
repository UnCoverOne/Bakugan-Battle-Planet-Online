export const PROFILE_SHOWCASE_LIMIT = 3;

export type ProfileReward = {
  id: string;
  label: string;
  achievementId: string | null;
};

export type ProfileAvatarPreset = {
  id: string;
  label: string;
  src: string;
};

export type ProfileCoverReward = ProfileReward & {
  faction: string | null;
  src: string;
};

export const PROFILE_AVATARS: readonly ProfileAvatarPreset[] = [
  { id: "veronica-venegas", label: "Veronica Venegas", src: "/assets/profile/icons/veronica-venegas.png" },
  { id: "strata", label: "Strata", src: "/assets/profile/icons/strata.png" },
  { id: "shun-kazami", label: "Shun Kazami", src: "/assets/profile/icons/shun-kazami.png" },
  { id: "philomena-dusk", label: "Philomena Dusk", src: "/assets/profile/icons/philomena-dusk.png" },
  { id: "olivia-styles", label: "Olivia Styles", src: "/assets/profile/icons/olivia-styles.png" },
  { id: "max", label: "Max", src: "/assets/profile/icons/max.png" },
  { id: "masato-kazami", label: "Masato Kazami", src: "/assets/profile/icons/masato-kazami.png" },
  { id: "marco", label: "Marco", src: "/assets/profile/icons/marco.png" },
  { id: "maggie", label: "Maggie", src: "/assets/profile/icons/maggie.png" },
  { id: "mac", label: "Mac", src: "/assets/profile/icons/mac.png" },
  { id: "lightning", label: "Lightning", src: "/assets/profile/icons/lightning.png" },
  { id: "kurin", label: "Kurin", src: "/assets/profile/icons/kurin.png" },
  { id: "everett-ray", label: "Everett Ray", src: "/assets/profile/icons/everett-ray.png" },
  { id: "e", label: "E", src: "/assets/profile/icons/e.png" },
  { id: "duran-dane", label: "Duran Dane", src: "/assets/profile/icons/duran-dane.png" },
  { id: "dee", label: "DEE", src: "/assets/profile/icons/dee.png" },
  { id: "col-armstrong-tripp", label: "Col. Armstrong Tripp", src: "/assets/profile/icons/col-armstrong-tripp.png" },
  { id: "china-riot", label: "China Riot", src: "/assets/profile/icons/china-riot.png" },
  { id: "cee", label: "CEE", src: "/assets/profile/icons/cee.png" },
  { id: "bill-kouzo", label: "Bill Kouzo", src: "/assets/profile/icons/bill-kouzo.png" },
  { id: "benton-dusk", label: "Benton Dusk", src: "/assets/profile/icons/benton-dusk.png" },
  { id: "bee", label: "BEE", src: "/assets/profile/icons/bee.png" },
  { id: "aay", label: "AAY", src: "/assets/profile/icons/aay.png" },
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
    src: "/assets/profile/covers/battle-planet.png",
  },
  {
    id: "ventus-maximus-gorthion-ultra",
    label: "Ventus Maximus Gorthion Ultra",
    achievementId: null,
    faction: "Ventus",
    src: "/assets/profile/covers/ventus-maximus-gorthion-ultra.png",
  },
  {
    id: "aquos-hyper-trox-ultra",
    label: "Aquos Hyper Trox Ultra",
    achievementId: null,
    faction: "Aquos",
    src: "/assets/profile/covers/aquos-hyper-trox-ultra.png",
  },
  {
    id: "darkus-hyper-serpenteze-ultra",
    label: "Darkus Hyper Serpenteze Ultra",
    achievementId: null,
    faction: "Darkus",
    src: "/assets/profile/covers/darkus-hyper-serpenteze-ultra.png",
  },
  {
    id: "darkus-turtonium",
    label: "Darkus Turtonium",
    achievementId: null,
    faction: "Darkus",
    src: "/assets/profile/covers/darkus-turtonium.png",
  },
  {
    id: "haos-hyper-turtonium-ultra",
    label: "Haos Hyper Turtonium Ultra",
    achievementId: null,
    faction: "Haos",
    src: "/assets/profile/covers/haos-hyper-turtonium-ultra.png",
  },
  {
    id: "haos-hyper-turtonium",
    label: "Haos Hyper Turtonium",
    achievementId: null,
    faction: "Haos",
    src: "/assets/profile/covers/haos-hyper-turtonium.png",
  },
  {
    id: "haos-turtonium-ultra",
    label: "Haos Turtonium Ultra",
    achievementId: null,
    faction: "Haos",
    src: "/assets/profile/covers/haos-turtonium-ultra.png",
  },
  {
    id: "pyrus-hyper-trox-ultra",
    label: "Pyrus Hyper Trox Ultra",
    achievementId: null,
    faction: "Pyrus",
    src: "/assets/profile/covers/pyrus-hyper-trox-ultra.png",
  },
  {
    id: "pyrus-webam-ultra",
    label: "Pyrus Webam Ultra",
    achievementId: null,
    faction: "Pyrus",
    src: "/assets/profile/covers/pyrus-webam-ultra.png",
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
