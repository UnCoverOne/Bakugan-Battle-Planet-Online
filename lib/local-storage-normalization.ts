import type { MatchState, Phase } from "./game";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BRAWLER_PROFILE,
  normalizeSnapshot,
  type AppSettings,
  type BrawlerProfile,
  type DeletedDeckRecord,
  type MatchResultRecord,
  type UserSnapshot,
} from "./persistence";
import type { DeckRecord } from "./data";

const FALLBACK: UserSnapshot = {
  schemaVersion: 1,
  updatedAt: 0,
  profile: DEFAULT_BRAWLER_PROFILE,
  decks: [],
  deletedDecks: [],
  history: [],
  settings: DEFAULT_APP_SETTINGS,
  route: "dashboard",
  selectedDeckId: "",
  builderDeck: null,
  deckQuery: "",
  compendiumQuery: "",
  compendiumTab: "cards",
  format: "bo1",
  matchMode: "solo",
  joinCode: "",
  match: null,
  online: false,
  selectedCore: "",
  logFilter: "all",
  replay: null,
  replayIndex: 0,
  playerId: "player",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

export const identityStoredValue = <T>(value: T) => value;

export function normalizeStoredProfile(value: unknown): BrawlerProfile {
  return normalizeSnapshot(
    { ...FALLBACK, profile: isRecord(value) ? value as BrawlerProfile : FALLBACK.profile },
    FALLBACK,
  ).profile;
}

export function normalizeStoredDecks(value: unknown): DeckRecord[] {
  return normalizeSnapshot({ ...FALLBACK, decks: value }, FALLBACK).decks;
}

export function normalizeStoredDeletedDecks(value: unknown): DeletedDeckRecord[] {
  return normalizeSnapshot({ ...FALLBACK, deletedDecks: value }, FALLBACK).deletedDecks ?? [];
}

export function normalizeStoredBuilderDeck(value: unknown): DeckRecord | null {
  return normalizeSnapshot({ ...FALLBACK, builderDeck: value }, FALLBACK).builderDeck;
}

export function normalizeStoredHistory(value: unknown): MatchResultRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 160) : "";
    if (!id) return [];
    const at = validDate(item.at) ?? new Date(0).toISOString();
    const startedAt = validDate(item.startedAt) ?? undefined;
    const log = Array.isArray(item.log)
      ? item.log.flatMap((entry, index) => {
          if (!isRecord(entry)) return [];
          return [{
            ...entry,
            id: typeof entry.id === "string" && entry.id ? entry.id : `${id}-log-${index}`,
            at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
            kind: ["game", "random", "system", "connection"].includes(String(entry.kind))
              ? entry.kind
              : "system",
            message: typeof entry.message === "string" ? entry.message : "",
          }];
        })
      : [];
    return [{
      id,
      result: typeof item.result === "string" ? item.result.slice(0, 40) : "",
      opponent: typeof item.opponent === "string" ? item.opponent.slice(0, 80) : "Opponent",
      score: typeof item.score === "string" ? item.score.slice(0, 40) : "",
      reason: typeof item.reason === "string" ? item.reason.slice(0, 240) : "",
      at,
      startedAt,
      format: item.format === "bo3" ? "bo3" : item.format === "bo1" ? "bo1" : undefined,
      mode: item.mode === "online" ? "online" : item.mode === "training" ? "training" : undefined,
      schemaVersion: 1,
      log,
    } as MatchResultRecord];
  }).slice(0, 200);
}

const PHASES = new Set<Phase>([
  "lobby", "startingPlayer", "placement", "draw", "energize", "selection", "preRoll", "target", "reroll",
  "power", "victor", "damage", "postDamage", "retract", "endPlay", "charge", "reset", "handLimit", "result",
]);

export function normalizeStoredMatch(value: unknown): MatchState | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.code !== "string") return null;
  if (value.format !== "bo1" && value.format !== "bo3") return null;
  if (typeof value.phase !== "string" || !PHASES.has(value.phase as Phase)) return null;
  if (!Array.isArray(value.players) || !value.players.length) return null;
  if (!value.players.every((player) => {
    if (!isRecord(player) || typeof player.id !== "string" || typeof player.name !== "string") return false;
    return ["bakugan", "cores", "deckCards", "hand", "discard", "energyZone", "heroes"].every(
      (field) => Array.isArray(player[field]),
    );
  })) return null;
  if (!Array.isArray(value.log)) return null;
  if (!isRecord(value.series) || !isRecord(value.selected) || !isRecord(value.targets) || !isRecord(value.rolls)) return null;
  if (typeof value.stepLabel !== "string") return null;
  return value as unknown as MatchState;
}

export function normalizeStoredReplay(value: unknown): MatchResultRecord | null {
  return normalizeStoredHistory(value == null ? [] : [value])[0] ?? null;
}

export function normalizeStoredSettings(value: unknown): AppSettings {
  const candidate = isRecord(value) ? value : {};
  const boolean = (key: keyof AppSettings, fallback: boolean) =>
    typeof candidate[key] === "boolean" ? candidate[key] as boolean : fallback;
  const text = (key: keyof AppSettings, fallback: string) =>
    typeof candidate[key] === "string" ? candidate[key] as string : fallback;
  const number = (key: keyof AppSettings, fallback: number) =>
    Number.isFinite(candidate[key]) ? Number(candidate[key]) : fallback;
  return {
    ...DEFAULT_APP_SETTINGS,
    reducedMotion: boolean("reducedMotion", DEFAULT_APP_SETTINGS.reducedMotion),
    highContrast: boolean("highContrast", DEFAULT_APP_SETTINGS.highContrast),
    sound: boolean("sound", DEFAULT_APP_SETTINGS.sound),
    cardScale: number("cardScale", DEFAULT_APP_SETTINGS.cardScale),
    logDetail: text("logDetail", DEFAULT_APP_SETTINGS.logDetail),
    challenges: text("challenges", DEFAULT_APP_SETTINGS.challenges),
    replayLinks: boolean("replayLinks", DEFAULT_APP_SETTINGS.replayLinks ?? true),
    ...(typeof candidate.automaticDraw === "boolean" ? { automaticDraw: candidate.automaticDraw } : {}),
    ...(typeof candidate.automaticPass === "boolean" ? { automaticPass: candidate.automaticPass } : {}),
    ...(typeof candidate.soundEnabled === "boolean" ? { soundEnabled: candidate.soundEnabled } : {}),
    ...(Number.isFinite(candidate.soundVolume) ? { soundVolume: Number(candidate.soundVolume) } : {}),
  };
}

export const normalizeStoredText = (value: unknown) => typeof value === "string" ? value : "";
export const normalizeStoredBoolean = (value: unknown) => value === true;
export const normalizeStoredNumber = (value: unknown) => Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
export const normalizeStoredFormat = (value: unknown) => value === "bo3" ? "bo3" : "bo1";
export const normalizeStoredMatchMode = (value: unknown) => ["solo", "online", "join"].includes(String(value)) ? value as "solo" | "online" | "join" : "solo";
export const normalizeStoredCompendiumTab = (value: unknown) => ["cards", "rules", "rulings"].includes(String(value)) ? value as "cards" | "rules" | "rulings" : "cards";
export const normalizeStoredJoinCode = (value: unknown) => typeof value === "string" ? value.slice(0, 6) : "";
export const normalizeStoredPlayerId = (value: unknown) => typeof value === "string" && value ? value : "player";
