import type { DeckRecord } from "./data";
import type { MatchState } from "./game";
import { isCompletedSeriesResult } from "./match-result-navigation";
import {
  EMPTY_ACHIEVEMENT_PROGRESS,
  mergeAchievementProgress,
  normalizeAchievementProgress,
  type AchievementProgress,
} from "./achievement-progress";
import {
  normalizeProfileAvatar,
  normalizeProfileCover,
  normalizeProfileTitle,
  normalizeShowcaseIds,
} from "./profile-customization";

export type AppRoute = "entry" | "dashboard" | "decks" | "deck-detail" | "builder" | "compendium" | "play" | "lobby" | "placement" | "match" | "result" | "history" | "profile" | "settings";
export type BrawlerProfile = {
  name: string;
  faction: string;
  signedIn: boolean;
  avatar?: string;
  titleId?: string;
  coverId?: string;
  showcaseAchievementIds?: string[];
  showcaseDeckIds?: string[];
  achievementCompletions?: Record<string, string>;
  achievementProgress?: AchievementProgress;
};
export type AppSettings = {
  reducedMotion: boolean;
  highContrast: boolean;
  sound: boolean;
  cardScale: number;
  logDetail: string;
  challenges: string;
  automaticDraw?: boolean;
  automaticPass?: boolean;
  soundEnabled?: boolean;
  soundVolume?: number;
  replayLinks?: boolean;
};
export const MAX_MATCH_RECORDS = 10;
export type LifetimeMatchStats = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  trainingMatches: number;
  casualMatches: number;
  rankedMatches: number;
};
export const EMPTY_LIFETIME_MATCH_STATS: LifetimeMatchStats = {
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  trainingMatches: 0,
  casualMatches: 0,
  rankedMatches: 0,
};
export type MatchResultRecord = {
  id: string;
  result: string;
  opponent: string;
  opponentUserId?: string;
  score: string;
  reason: string;
  at: string;
  startedAt?: string;
  format?: "bo1" | "bo3";
  mode?: "training" | "online" | "casual" | "ranked";
  schemaVersion?: 1 | 2 | 3;
  replayId?: string;
  replayStorage?: "local" | "server" | "legacy";
  replayAvailable?: boolean;
  log?: MatchState["log"];
};

export type DeletedDeckRecord = {
  id: string;
  deletedAt: string;
};

export type UserSnapshot = {
  schemaVersion: 1;
  updatedAt: number;
  profile: BrawlerProfile;
  decks: DeckRecord[];
  deletedDecks?: DeletedDeckRecord[];
  history: MatchResultRecord[];
  lifetimeStats?: LifetimeMatchStats;
  settings: AppSettings;
  route: AppRoute;
  selectedDeckId: string;
  builderDeck: DeckRecord | null;
  deckQuery: string;
  compendiumQuery: string;
  compendiumTab: "cards" | "cores" | "rules" | "rulings";
  format: "bo1" | "bo3";
  matchMode: "solo" | "online" | "join";
  joinCode: string;
  match: MatchState | null;
  online: boolean;
  selectedCore: string;
  logFilter: string;
  replay: MatchResultRecord | null;
  replayIndex: number;
  playerId: string;
};

export type SnapshotPreference = "merge" | "local" | "cloud";
export type AccountIdentity = { displayName: string; faction: string };

export const DEFAULT_BRAWLER_PROFILE: BrawlerProfile = {
  name: "DanBrawler",
  faction: "Pyrus",
  signedIn: false,
  avatar: "",
  titleId: "battle-planet-brawler",
  coverId: "battle-planet",
  showcaseAchievementIds: [],
  showcaseDeckIds: [],
  achievementCompletions: {},
  achievementProgress: EMPTY_ACHIEVEMENT_PROGRESS,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  reducedMotion: false,
  highContrast: false,
  sound: true,
  cardScale: 100,
  logDetail: "All events",
  challenges: "Everyone",
  replayLinks: true,
};

export function normalizeLifetimeMatchStats(value: unknown): LifetimeMatchStats {
  const candidate = value && typeof value === "object" ? value as Partial<LifetimeMatchStats> : {};
  const count = (key: keyof LifetimeMatchStats) => Number.isSafeInteger(candidate[key])
    ? Math.max(0, Number(candidate[key]))
    : 0;
  return {
    matchesPlayed: count("matchesPlayed"),
    wins: count("wins"),
    losses: count("losses"),
    draws: count("draws"),
    trainingMatches: count("trainingMatches"),
    casualMatches: count("casualMatches"),
    rankedMatches: count("rankedMatches"),
  };
}

export function normalizeAchievementCompletions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [rawId, rawDate] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    const id = rawId.trim().slice(0, 120);
    if (!id || typeof rawDate !== "string") continue;
    const timestamp = Date.parse(rawDate);
    if (!Number.isFinite(timestamp)) continue;
    normalized[id] = new Date(timestamp).toISOString();
  }
  return normalized;
}

export function mergeAchievementCompletions(
  ...values: Array<Record<string, string> | null | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const value of values) {
    const normalized = normalizeAchievementCompletions(value);
    for (const [id, completedAt] of Object.entries(normalized)) {
      const current = merged[id];
      if (!current || Date.parse(completedAt) < Date.parse(current)) merged[id] = completedAt;
    }
  }
  return merged;
}

const validRoutes = new Set<AppRoute>(["entry", "dashboard", "decks", "deck-detail", "builder", "compendium", "play", "lobby", "placement", "match", "result", "history", "profile", "settings"]);
const validFactions = new Set(["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);

function normalizeDeck(value: unknown): DeckRecord | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<DeckRecord>;
  if (typeof deck.id !== "string" || !deck.id || typeof deck.name !== "string" || !deck.name.trim()) return null;
  if (!Array.isArray(deck.bakuganIds) || !Array.isArray(deck.coreIds) || !Array.isArray(deck.cardIds)) return null;
  const updatedAt = typeof deck.updatedAt === "string" && Number.isFinite(Date.parse(deck.updatedAt)) ? new Date(deck.updatedAt).toISOString() : new Date(0).toISOString();
  const format = deck.format === "singleton" || deck.format === "competitive" ? deck.format : "standard";
  const cardLimit = format === "competitive" ? 50 : 40;
  return {
    id: deck.id.slice(0, 120),
    name: deck.name.trim().slice(0, 60),
    factions: Array.isArray(deck.factions) ? deck.factions.filter((faction): faction is string => typeof faction === "string").slice(0, 6) : [],
    bakuganIds: deck.bakuganIds.filter((id): id is string => typeof id === "string").slice(0, 3),
    coreIds: deck.coreIds.filter((id): id is string => typeof id === "string").slice(0, 6),
    cardIds: deck.cardIds.filter((id): id is string => typeof id === "string").slice(0, cardLimit),
    updatedAt,
    visibility: deck.visibility === "Public" ? "Public" : deck.visibility === "Draft" ? "Draft" : "Private",
    format,
    revision: Number.isSafeInteger(deck.revision) ? Math.max(1, Number(deck.revision)) : 1,
    favourite: Boolean(deck.favourite),
    tags: Array.isArray(deck.tags) ? deck.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 12) : [],
    notes: typeof deck.notes === "string" ? deck.notes.slice(0, 2_000) : "",
    conflictOf: typeof deck.conflictOf === "string" ? deck.conflictOf.slice(0, 120) : undefined,
    leadCardId: typeof deck.leadCardId === "string" && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId.slice(0, 120) : deck.cardIds[0],
    creator: typeof deck.creator === "string" ? deck.creator.trim().slice(0, 40) : undefined,
    description: typeof deck.description === "string" ? deck.description.trim().slice(0, 500) : undefined,
    publishedAt: typeof deck.publishedAt === "string" && Number.isFinite(Date.parse(deck.publishedAt)) ? new Date(deck.publishedAt).toISOString() : undefined,
    sourceDeckId: typeof deck.sourceDeckId === "string" ? deck.sourceDeckId.slice(0, 120) : undefined,
    sourceCreator: typeof deck.sourceCreator === "string" ? deck.sourceCreator.trim().slice(0, 40) : undefined,
  };
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDeletedDecks(value: unknown): DeletedDeckRecord[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, DeletedDeckRecord>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const deletion = candidate as Partial<DeletedDeckRecord>;
    if (typeof deletion.id !== "string" || !deletion.id || typeof deletion.deletedAt !== "string") continue;
    const deletedAt = timestamp(deletion.deletedAt);
    if (!deletedAt) continue;
    const normalized = { id: deletion.id.slice(0, 120), deletedAt: new Date(deletedAt).toISOString() };
    const current = byId.get(normalized.id);
    if (!current || timestamp(normalized.deletedAt) > timestamp(current.deletedAt)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt))
    .slice(0, 200);
}

function reconcileDeckState(decks: DeckRecord[], deletedDecks: DeletedDeckRecord[]) {
  const byId = new Map<string, DeckRecord>();
  for (const deck of decks) {
    const current = byId.get(deck.id);
    if (!current || timestamp(deck.updatedAt) > timestamp(current.updatedAt)) byId.set(deck.id, deck);
  }
  const deletions = new Map(normalizeDeletedDecks(deletedDecks).map((deletion) => [deletion.id, deletion]));
  for (const [id, deletion] of deletions) {
    const deck = byId.get(id);
    if (deck && timestamp(deck.updatedAt) > timestamp(deletion.deletedAt)) {
      deletions.delete(id);
    } else {
      byId.delete(id);
    }
  }
  return {
    decks: [...byId.values()].slice(0, 50),
    deletedDecks: [...deletions.values()]
      .sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt))
      .slice(0, 200),
  };
}

export function normalizeSnapshot(value: unknown, fallback: UserSnapshot): UserSnapshot {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<UserSnapshot>;
  const deletedDecks = normalizeDeletedDecks(candidate.deletedDecks);
  const normalizedDecks = Array.isArray(candidate.decks)
    ? candidate.decks.map(normalizeDeck).filter((deck): deck is DeckRecord => Boolean(deck))
    : fallback.decks;
  const deckState = reconcileDeckState(normalizedDecks, deletedDecks);
  return {
    ...fallback,
    ...candidate,
    schemaVersion: 1,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : fallback.updatedAt,
    profile: {
      name: typeof candidate.profile?.name === "string" && candidate.profile.name.trim() ? candidate.profile.name.slice(0, 20) : fallback.profile.name,
      faction: validFactions.has(candidate.profile?.faction ?? "") ? candidate.profile!.faction : fallback.profile.faction,
      signedIn: Boolean(candidate.profile?.signedIn),
      avatar: normalizeProfileAvatar(candidate.profile?.avatar),
      titleId: normalizeProfileTitle(candidate.profile?.titleId),
      coverId: normalizeProfileCover(candidate.profile?.coverId),
      showcaseAchievementIds: normalizeShowcaseIds(candidate.profile?.showcaseAchievementIds),
      showcaseDeckIds: normalizeShowcaseIds(candidate.profile?.showcaseDeckIds),
      achievementCompletions: normalizeAchievementCompletions(
        candidate.profile?.achievementCompletions ?? fallback.profile.achievementCompletions,
      ),
      achievementProgress: normalizeAchievementProgress(
        candidate.profile?.achievementProgress ?? fallback.profile.achievementProgress,
      ),
    },
    decks: deckState.decks,
    deletedDecks: deckState.deletedDecks,
    history: Array.isArray(candidate.history) ? candidate.history.slice(0, MAX_MATCH_RECORDS) : fallback.history,
    lifetimeStats: normalizeLifetimeMatchStats(candidate.lifetimeStats ?? fallback.lifetimeStats),
    settings: { ...fallback.settings, ...(candidate.settings ?? {}) },
    route: validRoutes.has(candidate.route as AppRoute) ? candidate.route as AppRoute : fallback.route,
    selectedDeckId: typeof candidate.selectedDeckId === "string" ? candidate.selectedDeckId : fallback.selectedDeckId,
    builderDeck: normalizeDeck(candidate.builderDeck),
    deckQuery: typeof candidate.deckQuery === "string" ? candidate.deckQuery : "",
    compendiumQuery: typeof candidate.compendiumQuery === "string" ? candidate.compendiumQuery : "",
    compendiumTab: ["cards", "cores", "rules", "rulings"].includes(candidate.compendiumTab ?? "") ? candidate.compendiumTab! : fallback.compendiumTab,
    format: candidate.format === "bo3" ? "bo3" : "bo1",
    matchMode: ["solo", "online", "join"].includes(candidate.matchMode ?? "") ? candidate.matchMode! : "solo",
    joinCode: typeof candidate.joinCode === "string" ? candidate.joinCode.slice(0, 6) : "",
    match: candidate.match && typeof candidate.match === "object" ? candidate.match as MatchState : null,
    online: Boolean(candidate.online),
    selectedCore: typeof candidate.selectedCore === "string" ? candidate.selectedCore : "",
    logFilter: typeof candidate.logFilter === "string" ? candidate.logFilter : "all",
    replay: candidate.replay && typeof candidate.replay === "object" ? candidate.replay : null,
    replayIndex: Number.isFinite(candidate.replayIndex) ? Math.max(0, Number(candidate.replayIndex)) : 0,
    playerId: typeof candidate.playerId === "string" && candidate.playerId ? candidate.playerId : fallback.playerId,
  };
}

function retainDeviceState(snapshot: UserSnapshot, device: UserSnapshot): UserSnapshot {
  const cloudTrainingMatch = recoverableTrainingMatch(snapshot.match, snapshot.online);
  const deviceTrainingMatch = recoverableTrainingMatch(device.match, device.online);
  const cloudTrainingIsNewer = Boolean(
    cloudTrainingMatch
    && deviceTrainingMatch
    && (
      cloudTrainingMatch.id === deviceTrainingMatch.id
        ? cloudTrainingMatch.version > deviceTrainingMatch.version
        : snapshot.updatedAt > device.updatedAt
    )
  );
  const useCloudTrainingSession = Boolean(cloudTrainingMatch && (!device.match || cloudTrainingIsNewer));
  const session = useCloudTrainingSession ? snapshot : device;
  return {
    ...snapshot,
    profile: { ...snapshot.profile, signedIn: device.profile.signedIn },
    route: device.route,
    deckQuery: device.deckQuery,
    compendiumQuery: device.compendiumQuery,
    compendiumTab: device.compendiumTab,
    joinCode: device.joinCode,
    match: session.match,
    online: session.online,
    selectedCore: device.selectedCore,
    logFilter: device.logFilter,
    replay: device.replay,
    replayIndex: device.replayIndex,
    playerId: session.playerId,
  };
}

export function recoverableTrainingMatch(match: MatchState | null, online: boolean): MatchState | null {
  if (
    !match
    || online
    || isCompletedSeriesResult(match)
    || (!match.trainingAiDeck && !match.players?.some((player) => player.id === "training-bot"))
  ) return null;
  return match;
}

export function toCloudSnapshot(snapshot: UserSnapshot): UserSnapshot {
  const trainingMatch = recoverableTrainingMatch(snapshot.match, snapshot.online);
  return {
    ...snapshot,
    profile: { ...snapshot.profile, signedIn: false },
    route: "dashboard",
    deckQuery: "",
    compendiumQuery: "",
    compendiumTab: "cards",
    joinCode: "",
    match: trainingMatch,
    online: false,
    selectedCore: "",
    logFilter: "all",
    replay: null,
    replayIndex: 0,
    playerId: trainingMatch ? snapshot.playerId : "",
  };
}

export function createEmptyAccountSnapshot(
  device: UserSnapshot,
  identity: AccountIdentity,
  updatedAt = Date.now(),
): UserSnapshot {
  return {
    ...toCloudSnapshot(device),
    match: null,
    online: false,
    playerId: "",
    updatedAt,
    profile: {
      ...DEFAULT_BRAWLER_PROFILE,
      name: identity.displayName.trim().slice(0, 20) || DEFAULT_BRAWLER_PROFILE.name,
      faction: validFactions.has(identity.faction) ? identity.faction : DEFAULT_BRAWLER_PROFILE.faction,
    },
    decks: [],
    deletedDecks: [],
    history: [],
    settings: { ...DEFAULT_APP_SETTINGS },
    selectedDeckId: "",
    builderDeck: null,
    format: "bo1",
    matchMode: "solo",
  };
}

export function createRegistrationSnapshot(
  local: UserSnapshot,
  identity: AccountIdentity,
  importLocalData: boolean,
  updatedAt = Date.now(),
): UserSnapshot {
  if (!importLocalData) return createEmptyAccountSnapshot(local, identity, updatedAt);
  return toCloudSnapshot({
    ...local,
    updatedAt,
    profile: {
      ...local.profile,
      name: identity.displayName.trim().slice(0, 20) || DEFAULT_BRAWLER_PROFILE.name,
      faction: validFactions.has(identity.faction) ? identity.faction : DEFAULT_BRAWLER_PROFILE.faction,
      signedIn: false,
    },
  });
}

export function selectSnapshot(local: UserSnapshot, cloud: UserSnapshot, preference: SnapshotPreference = "merge"): UserSnapshot {
  if (preference === "local") return retainDeviceState(local, local);
  if (preference === "cloud") return retainDeviceState(cloud, local);
  return mergeSnapshots(local, cloud);
}

export function mergeSnapshots(local: UserSnapshot, cloud: UserSnapshot): UserSnapshot {
  const localIsNewer = local.updatedAt > cloud.updatedAt;
  const primary = localIsNewer ? local : cloud;
  const secondary = localIsNewer ? cloud : local;
  const deckState = reconcileDeckState(
    [...primary.decks, ...secondary.decks],
    [...(primary.deletedDecks ?? []), ...(secondary.deletedDecks ?? [])],
  );
  const history = new Map<string, MatchResultRecord>();
  for (const result of secondary.history) history.set(result.id, result);
  for (const result of primary.history) history.set(result.id, result);
  const merged = {
    ...primary,
    schemaVersion: 1 as const,
    updatedAt: Math.max(local.updatedAt, cloud.updatedAt),
    profile: {
      ...primary.profile,
      achievementCompletions: mergeAchievementCompletions(
        primary.profile.achievementCompletions,
        secondary.profile.achievementCompletions,
      ),
      achievementProgress: mergeAchievementProgress(
        primary.profile.achievementProgress,
        secondary.profile.achievementProgress,
      ),
    },
    decks: deckState.decks,
    deletedDecks: deckState.deletedDecks,
    history: [...history.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_MATCH_RECORDS),
    lifetimeStats: normalizeLifetimeMatchStats(primary.lifetimeStats),
  };
  return retainDeviceState(merged, local);
}
