import type { UserSnapshot } from "./persistence";
import {hasCustomPreferences} from "./settings-preferences";

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
  const settingsCustomized = hasCustomPreferences(snapshot.settings);
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
