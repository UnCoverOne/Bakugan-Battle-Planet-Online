import type { DeckRecord } from "./data";
import { normalizeMatchState, type MatchState } from "./game";

export type AppRoute = "entry" | "dashboard" | "decks" | "deck-detail" | "builder" | "compendium" | "play" | "lobby" | "placement" | "match" | "result" | "history" | "profile" | "settings";
export type BrawlerProfile = { name: string; faction: string; signedIn: boolean };
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

export type UserSnapshot = {
  schemaVersion: 1;
  updatedAt: number;
  profile: BrawlerProfile;
  decks: DeckRecord[];
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

const validRoutes = new Set<AppRoute>(["entry", "dashboard", "decks", "deck-detail", "builder", "compendium", "play", "lobby", "placement", "match", "result", "history", "profile", "settings"]);
const validFactions = new Set(["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);

function normalizeDeck(value: unknown): DeckRecord | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<DeckRecord>;
  if (typeof deck.id !== "string" || !deck.id || typeof deck.name !== "string" || !deck.name.trim()) return null;
  if (!Array.isArray(deck.bakuganIds) || !Array.isArray(deck.coreIds) || !Array.isArray(deck.cardIds)) return null;
  const updatedAt = typeof deck.updatedAt === "string" && Number.isFinite(Date.parse(deck.updatedAt))
    ? new Date(deck.updatedAt).toISOString()
    : new Date(0).toISOString();
  return {
    id: deck.id.slice(0, 120),
    name: deck.name.trim().slice(0, 60),
    factions: Array.isArray(deck.factions) ? deck.factions.filter((faction): faction is string => typeof faction === "string").slice(0, 6) : [],
    bakuganIds: deck.bakuganIds.filter((id): id is string => typeof id === "string").slice(0, 3),
    coreIds: deck.coreIds.filter((id): id is string => typeof id === "string").slice(0, 6),
    cardIds: deck.cardIds.filter((id): id is string => typeof id === "string").slice(0, 40),
    updatedAt,
    visibility: deck.visibility === "Public" ? "Public" : "Private",
    format: deck.format === "singleton" ? "singleton" : "standard",
    revision: Number.isSafeInteger(deck.revision) ? Math.max(1, Number(deck.revision)) : 1,
    favourite: Boolean(deck.favourite),
    tags: Array.isArray(deck.tags) ? deck.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 12) : [],
    notes: typeof deck.notes === "string" ? deck.notes.slice(0, 2_000) : "",
    conflictOf: typeof deck.conflictOf === "string" ? deck.conflictOf.slice(0, 120) : undefined,
  };
}

export function normalizeSnapshot(value: unknown, fallback: UserSnapshot): UserSnapshot {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<UserSnapshot>;
  return {
    ...fallback,
    ...candidate,
    schemaVersion: 1,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : fallback.updatedAt,
    profile: {
      name: typeof candidate.profile?.name === "string" && candidate.profile.name.trim() ? candidate.profile.name.slice(0, 20) : fallback.profile.name,
      faction: validFactions.has(candidate.profile?.faction ?? "") ? candidate.profile!.faction : fallback.profile.faction,
      signedIn: Boolean(candidate.profile?.signedIn),
    },
    decks: Array.isArray(candidate.decks)
      ? candidate.decks.map(normalizeDeck).filter((deck): deck is DeckRecord => Boolean(deck)).slice(0, 50)
      : fallback.decks,
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
    match: candidate.match && typeof candidate.match === "object"
      ? normalizeMatchState(candidate.match)
      : null,
    online: Boolean(candidate.online),
    selectedCore: typeof candidate.selectedCore === "string" ? candidate.selectedCore : "",
    logFilter: typeof candidate.logFilter === "string" ? candidate.logFilter : "all",
    replay: candidate.replay && typeof candidate.replay === "object" ? candidate.replay : null,
    replayIndex: Number.isFinite(candidate.replayIndex) ? Math.max(0, Number(candidate.replayIndex)) : 0,
    playerId: typeof candidate.playerId === "string" && candidate.playerId ? candidate.playerId : fallback.playerId,
  };
}

export function mergeSnapshots(local: UserSnapshot, cloud: UserSnapshot): UserSnapshot {
  const localIsNewer = local.updatedAt > cloud.updatedAt;
  const primary = localIsNewer ? local : cloud;
  const secondary = localIsNewer ? cloud : local;
  const decks = new Map<string, DeckRecord>();
  for (const deck of secondary.decks) decks.set(deck.id, deck);
  for (const deck of primary.decks) {
    const other = decks.get(deck.id);
    if (other && JSON.stringify({ ...other, updatedAt: "" }) !== JSON.stringify({ ...deck, updatedAt: "" })) {
      const older = Date.parse(other.updatedAt) > Date.parse(deck.updatedAt) ? deck : other;
      const conflictId = `${deck.id}-conflict-${Math.max(0, Date.parse(older.updatedAt)).toString(36)}`;
      if (!decks.has(conflictId)) {
        decks.set(conflictId, {
          ...older,
          id: conflictId,
          name: `${older.name} (conflict copy)`,
          conflictOf: deck.id,
          visibility: "Private",
        });
      }
    }
    decks.set(deck.id, other && Date.parse(other.updatedAt) > Date.parse(deck.updatedAt) ? other : deck);
  }
  const history = new Map<string, MatchResultRecord>();
  for (const result of secondary.history) history.set(result.id, result);
  for (const result of primary.history) history.set(result.id, result);
  return {
    ...primary,
    schemaVersion: 1,
    updatedAt: Math.max(local.updatedAt, cloud.updatedAt),
    decks: [...decks.values()].slice(0, 50),
    history: [...history.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 200),
  };
}
