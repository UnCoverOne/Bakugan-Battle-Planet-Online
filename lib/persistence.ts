import type { DeckRecord } from "./data";
import type { MatchState } from "./game";

export type AppRoute = "entry" | "dashboard" | "decks" | "builder" | "compendium" | "play" | "lobby" | "placement" | "match" | "result" | "history" | "profile" | "settings";
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
};
export type MatchResultRecord = { id: string; result: string; opponent: string; score: string; reason: string; at: string; log: MatchState["log"] };

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

const validRoutes = new Set<AppRoute>(["entry", "dashboard", "decks", "builder", "compendium", "play", "lobby", "placement", "match", "result", "history", "profile", "settings"]);
const validFactions = new Set(["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);

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
    decks: Array.isArray(candidate.decks) ? candidate.decks : fallback.decks,
    history: Array.isArray(candidate.history) ? candidate.history.slice(0, 200) : fallback.history,
    settings: { ...fallback.settings, ...(candidate.settings ?? {}) },
    route: validRoutes.has(candidate.route as AppRoute) ? candidate.route as AppRoute : fallback.route,
    selectedDeckId: typeof candidate.selectedDeckId === "string" ? candidate.selectedDeckId : fallback.selectedDeckId,
    builderDeck: candidate.builderDeck && typeof candidate.builderDeck === "object" ? candidate.builderDeck : null,
    deckQuery: typeof candidate.deckQuery === "string" ? candidate.deckQuery : "",
    compendiumQuery: typeof candidate.compendiumQuery === "string" ? candidate.compendiumQuery : "",
    compendiumTab: ["cards", "rules", "rulings"].includes(candidate.compendiumTab ?? "") ? candidate.compendiumTab! : fallback.compendiumTab,
    format: candidate.format === "bo3" ? "bo3" : "bo1",
    matchMode: ["solo", "online", "join"].includes(candidate.matchMode ?? "") ? candidate.matchMode! : "solo",
    joinCode: typeof candidate.joinCode === "string" ? candidate.joinCode.slice(0, 6) : "",
    match: candidate.match && typeof candidate.match === "object" ? candidate.match : null,
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
  for (const deck of primary.decks) decks.set(deck.id, deck);
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
