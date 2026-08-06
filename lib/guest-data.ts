import type { UserSnapshot } from "./persistence";

export type GuestDataSummary = {
  hasMeaningfulData: boolean;
  deckCount: number;
  matchCount: number;
  hasDraft: boolean;
  hasActiveMatch: boolean;
  profileCustomized: boolean;
  settingsCustomized: boolean;
  labels: string[];
};

type GuestSnapshot = Pick<
  UserSnapshot,
  "profile" | "decks" | "history" | "settings" | "builderDeck" | "match"
>;

const DEFAULT_PROFILE_NAMES = new Set(["Guest Brawler", "DanBrawler"]);
const DEFAULT_PROFILE_FACTION = "Pyrus";
const DEFAULT_SETTINGS = {
  reducedMotion: false,
  highContrast: false,
  sound: true,
  cardScale: 100,
  logDetail: "All events",
  challenges: "Everyone",
  replayLinks: true,
};

export function summarizeGuestData(snapshot: GuestSnapshot): GuestDataSummary {
  const profileCustomized =
    !DEFAULT_PROFILE_NAMES.has(snapshot.profile.name.trim()) ||
    snapshot.profile.faction !== DEFAULT_PROFILE_FACTION ||
    Boolean(snapshot.profile.avatar) ||
    (snapshot.profile.titleId !== undefined &&
      snapshot.profile.titleId !== "battle-planet-brawler") ||
    (snapshot.profile.coverId !== undefined &&
      snapshot.profile.coverId !== "battle-planet") ||
    Boolean(snapshot.profile.showcaseAchievementIds?.length) ||
    Boolean(snapshot.profile.showcaseDeckIds?.length);
  const settingsCustomized =
    snapshot.settings.reducedMotion !== DEFAULT_SETTINGS.reducedMotion ||
    snapshot.settings.highContrast !== DEFAULT_SETTINGS.highContrast ||
    snapshot.settings.sound !== DEFAULT_SETTINGS.sound ||
    snapshot.settings.cardScale !== DEFAULT_SETTINGS.cardScale ||
    snapshot.settings.logDetail !== DEFAULT_SETTINGS.logDetail ||
    snapshot.settings.challenges !== DEFAULT_SETTINGS.challenges ||
    snapshot.settings.replayLinks === false ||
    snapshot.settings.automaticDraw !== undefined ||
    snapshot.settings.automaticPass !== undefined ||
    snapshot.settings.soundEnabled !== undefined ||
    snapshot.settings.soundVolume !== undefined;
  const deckCount = snapshot.decks.length;
  const matchCount = snapshot.history.length;
  const hasDraft = Boolean(snapshot.builderDeck);
  const hasActiveMatch = Boolean(snapshot.match && snapshot.match.phase !== "result");
  const labels = [
    deckCount ? `${deckCount} saved deck${deckCount === 1 ? "" : "s"}` : "",
    matchCount ? `${matchCount} match record${matchCount === 1 ? "" : "s"}` : "",
    hasDraft ? "1 deck draft" : "",
    hasActiveMatch ? "1 active match" : "",
    profileCustomized ? "custom Brawler profile" : "",
    settingsCustomized ? "custom settings" : "",
  ].filter(Boolean);

  return {
    hasMeaningfulData: labels.length > 0,
    deckCount,
    matchCount,
    hasDraft,
    hasActiveMatch,
    profileCustomized,
    settingsCustomized,
    labels,
  };
}
