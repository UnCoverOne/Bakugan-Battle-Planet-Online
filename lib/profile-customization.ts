import {
  profileRewardRequirement,
  runtimeProfileRewardAvailable,
} from "./profile-reward-runtime";

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

const titleReward = (
  id: string,
  label: string,
  achievementId: string | null,
): ProfileReward => ({
  id,
  label,
  get achievementId() {
    return profileRewardRequirement("titles", id, achievementId);
  },
});

export const PROFILE_TITLE_CATALOGUE: readonly ProfileReward[] = [
  titleReward("battle-planet-brawler", "Battle Planet Brawler", null),
  titleReward("battle-ready", "Battle Ready", "first-deck"),
  titleReward("arsenal-architect", "Arsenal Architect", "deck-builder"),
  titleReward("winning-start", "Winning Start", "first-win"),
  titleReward("seasoned-brawler", "Seasoned Brawler", "veteran"),
  titleReward("strategy-publisher", "Strategy Publisher", "publisher"),
  titleReward("connected-brawler", "Connected Brawler", "opponents-ten"),
  titleReward("master-of-the-elements", "Master of the Elements", "complete-ten"),
];

const coverReward = (
  id: string,
  label: string,
  faction: string | null,
  src: string,
  achievementId: string | null = null,
): ProfileCoverReward => ({
  id,
  label,
  get achievementId() {
    return profileRewardRequirement("covers", id, achievementId);
  },
  faction,
  src,
});

export const PROFILE_COVER_CATALOGUE: readonly ProfileCoverReward[] = [
  coverReward("battle-planet", "Ventus Hyper Turtonium Ultra", "Ventus", "/assets/profile/covers/battle-planet.png"),
  coverReward("ventus-maximus-gorthion-ultra", "Ventus Maximus Gorthion Ultra", "Ventus", "/assets/profile/covers/ventus-maximus-gorthion-ultra.png"),
  coverReward("aquos-hyper-trox-ultra", "Aquos Hyper Trox Ultra", "Aquos", "/assets/profile/covers/aquos-hyper-trox-ultra.png"),
  coverReward("darkus-hyper-serpenteze-ultra", "Darkus Hyper Serpenteze Ultra", "Darkus", "/assets/profile/covers/darkus-hyper-serpenteze-ultra.png"),
  coverReward("darkus-turtonium", "Darkus Turtonium", "Darkus", "/assets/profile/covers/darkus-turtonium.png"),
  coverReward("haos-hyper-turtonium-ultra", "Haos Hyper Turtonium Ultra", "Haos", "/assets/profile/covers/haos-hyper-turtonium-ultra.png"),
  coverReward("haos-hyper-turtonium", "Haos Hyper Turtonium", "Haos", "/assets/profile/covers/haos-hyper-turtonium.png"),
  coverReward("haos-turtonium-ultra", "Haos Turtonium Ultra", "Haos", "/assets/profile/covers/haos-turtonium-ultra.png"),
  coverReward("pyrus-hyper-trox-ultra", "Pyrus Hyper Trox Ultra", "Pyrus", "/assets/profile/covers/pyrus-hyper-trox-ultra.png"),
  coverReward("pyrus-webam-ultra", "Pyrus Webam Ultra", "Pyrus", "/assets/profile/covers/pyrus-webam-ultra.png"),
];

function availableCatalogue<T extends ProfileReward>(
  group: "titles" | "covers",
  catalogue: readonly T[],
): readonly T[] {
  return new Proxy(catalogue, {
    get(target, property, receiver) {
      if (property === "map") {
        return <R>(
          callback: (item: T, index: number, items: T[]) => R,
          thisArg?: unknown,
        ) => {
          const available = target.filter((item) =>
            runtimeProfileRewardAvailable(group, item.id, item.achievementId),
          );
          return available.map(callback, thisArg);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export const PROFILE_TITLES = availableCatalogue("titles", PROFILE_TITLE_CATALOGUE);
export const PROFILE_COVERS = availableCatalogue("covers", PROFILE_COVER_CATALOGUE);

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
    PROFILE_TITLE_CATALOGUE.find((item) => item.id === value)?.id ??
    PROFILE_TITLE_CATALOGUE[0].id
  );
}

export function normalizeProfileCover(value: unknown) {
  return (
    PROFILE_COVER_CATALOGUE.find((item) => item.id === value)?.id ??
    PROFILE_COVER_CATALOGUE[0].id
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
