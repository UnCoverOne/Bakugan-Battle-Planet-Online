import type { DeckRecord } from "./data";
import type { MatchState } from "./game";
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
export type MatchResultRecord = {
  id: string;
  result: string;
  opponent: string;
  score: string;
  reason: string;
  at: string;
  startedAt?: string;
  format?: "bo1" | "bo3";
  mode?: "training" | "online";
  schemaVersion?: 1;
  log: MatchState["log"];
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
  settings: AppSettings;
  route: AppRoute;
  selectedDeckId: string;
  builderDeck: DeckRecord | null;
  deckQuery: string;
  compendiumQuery: string;
  compendiumTab: "cards" | "rules" | "rulings";
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

const validRoutes = new Set<AppRoute>(["entry", "dashboard", "decks", "deck-detail", "builder", "compendium", "play", "lobby", "placement", "match", "result", "history", "profile", "settings"]);
const validFactions = new Set(["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);

function normalizeDeck(value: unknown): DeckRecord | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<DeckRecord>;
  if (typeof deck.id !== "string" || !deck.id || typeof deck.name !== "string" || !deck.name.trim()) return null;
  if (!Array.isArray(deck.bakuganIds) || !Array.isArray(deck.coreIds) || !Array.isArray(deck.cardIds)) return null;
  const updatedAt = typeof deck.updatedAt === "string" && Number.isFinite(Date.parse(deck.updatedAt)) ? new Date(deck.updatedAt).toISOString() : new Date(0).toISOString();
  return {
    id: deck.id.slice(0, 120),
    name: deck.name.trim().slice(0, 60),
    factions: Array.isArray(deck.factions) ? deck.factions.filter((faction): faction is string => typeof faction === "string").slice(0, 6) : [],
    bakuganIds: deck.bakuganIds.filter((id): id is string => typeof id === "string").slice(0, 3),
    coreIds: deck.coreIds.filter((id): id is string => typeof id === "string").slice(0, 6),
    cardIds: deck.cardIds.filter((id): id is string => typeof id === "string").slice(0, 40),
    updatedAt,
    visibility: deck.visibility === "Public" ? "Public" : deck.visibility === "Draft" ? "Draft" : "Private",
    format: deck.format === "singleton" ? "singleton" : "standard",
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
      showcaseAchievementIds: normalizeShowcaseIds(
        candidate.profile?.showcaseAchievementIds,
      ),
      showcaseDeckIds: normalizeShowcaseIds(candidate.profile?.showcaseDeckIds),
    },
    decks: deckState.decks,
    deletedDecks: deckState.deletedDecks,
    history: Array.isArray(candidate.history) ? candidate.history.slice(0, 200) : fallback.history,
    settings: { ...fallback.settings, ...(candidate.settings ?? {}) },
    route: validRoutes.has(candidate.route as AppRoute) ? candidate.route as AppRoute : fallback.route,
    selectedDeckId: typeof candidate.selectedDeckId === "string" ? candidate.selectedDeckId : fallback.selectedDeckId,
    builderDeck: normalizeDeck(candidate.builderDeck),
    deckQuery: typeof candidate.deckQuery === "string" ? candidate.deckQuery : "",
    compendiumQuery: typeof candidate.compendiumQuery === "string" ? candidate.compendiumQuery : "",
    compendiumTab: ["cards", "rules", "rulings"].includes(candidate.compendiumTab ?? "") ? candidate.compendiumTab! : fallback.compendiumTab,
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
  return {
    ...snapshot,
    profile: { ...snapshot.profile, signedIn: device.profile.signedIn },
    route: device.route,
    deckQuery: device.deckQuery,
    compendiumQuery: device.compendiumQuery,
    compendiumTab: device.compendiumTab,
    joinCode: device.joinCode,
    match: device.match,
    online: device.online,
    selectedCore: device.selectedCore,
    logFilter: device.logFilter,
    replay: device.replay,
    replayIndex: device.replayIndex,
    playerId: device.playerId,
  };
}

export function toCloudSnapshot(snapshot: UserSnapshot): UserSnapshot {
  return {
    ...snapshot,
    profile: { ...snapshot.profile, signedIn: false },
    route: "dashboard",
    deckQuery: "",
    compendiumQuery: "",
    compendiumTab: "cards",
    joinCode: "",
    match: null,
    online: false,
    selectedCore: "",
    logFilter: "all",
    replay: null,
    replayIndex: 0,
    playerId: "",
  };
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
    decks: deckState.decks,
    deletedDecks: deckState.deletedDecks,
    history: [...history.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 200),
  };
  return retainDeviceState(merged, local);
}

