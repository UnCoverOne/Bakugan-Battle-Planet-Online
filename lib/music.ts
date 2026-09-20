import type { MatchState, PlayerState } from "./game";

export const MUSIC_CATEGORIES = [
  "menu",
  "deck-builder",
  "battle",
  "battle-intense",
  "victory",
  "defeat",
] as const;

export type MusicCategory = typeof MUSIC_CATEGORIES[number];

export const MUSIC_CATEGORY_LABELS: Record<MusicCategory, string> = {
  menu: "Menu",
  "deck-builder": "Deck Builder",
  battle: "Battle",
  "battle-intense": "Battle — Intense",
  victory: "Victory",
  defeat: "Defeat",
};

export const MUSIC_LOW_LIFE_CARDS = 8;
export const MUSIC_NEAR_LETHAL_CARDS = 3;
export const DEFAULT_INTENSE_LEAD_IN_MS = 4_000;
export const BATTLE_TO_INTENSE_CROSSFADE_MS = 6_000;
export const INTENSE_TO_BATTLE_CROSSFADE_MS = 3_500;
export const STANDARD_MUSIC_CROSSFADE_MS = 2_500;
export const MUSIC_GAIN_MIN_DB = -30;
export const MUSIC_GAIN_MAX_DB = 12;
export const MUSIC_LIBRARY_UPDATED_EVENT = "bbp-music-library-updated";

export type MusicTrack = {
  id: string;
  name: string;
  artist: string;
  sourceName: string;
  mimeType: "audio/ogg";
  bytes: number;
  durationMs: number;
  bitrate: number;
  intenseLeadInMs: number;
  enabled: boolean;
  categories: MusicCategory[];
  weight: number;
  loop: boolean;
  gainDb: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  url: string;
};

export type MusicManifest = {
  revision: number;
  tracks: MusicTrack[];
};

export type MusicTrackMetadata = Pick<
  MusicTrack,
  "name" | "artist" | "enabled" | "categories" | "weight" | "loop" | "gainDb" | "durationMs" | "bitrate" | "intenseLeadInMs"
>;

export function normalizeMusicCategories(value: unknown): MusicCategory[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<MusicCategory>();
  for (const rawCandidate of value) {
    // Training used to be a separate category. Preserve existing assignments
    // by folding legacy Training tracks into the shared Battle playlist.
    const candidate = rawCandidate === "training" ? "battle" : rawCandidate;
    if (!MUSIC_CATEGORIES.includes(candidate as MusicCategory)) continue;
    seen.add(candidate as MusicCategory);
  }
  return [...seen];
}

function remainingDeckCards(player: PlayerState) {
  const publicCount = Number(player.deck);
  if (Number.isFinite(publicCount) && publicCount >= 0) return publicCount;
  return Math.max(0, player.deckCards?.length ?? 0);
}

export type MusicBattleIntensityReason = "low-life" | "lethal-pressure" | null;

export function musicBattleIntensity(match: MatchState | null | undefined): MusicBattleIntensityReason {
  if (!match || match.phase === "result") return null;
  if (match.players.some((player) => remainingDeckCards(player) <= MUSIC_LOW_LIFE_CARDS)) {
    return "low-life";
  }
  if (match.phase !== "damage" || !match.pendingLoser || match.pendingDamage <= 0) return null;
  const defender = match.players.find((player) => player.id === match.pendingLoser);
  if (!defender) return null;
  const projectedRemaining = remainingDeckCards(defender) - Math.max(0, match.pendingDamage);
  return projectedRemaining <= MUSIC_NEAR_LETHAL_CARDS ? "lethal-pressure" : null;
}

export function musicCategoryForRoute(
  pathname: string,
  match: MatchState | null | undefined,
  _online: boolean,
  playerId: string,
): MusicCategory {
  if (pathname === "/play/match" && match) {
    if (match.phase === "result" && match.winner) {
      return match.winner === playerId ? "victory" : "defeat";
    }
    return musicBattleIntensity(match) ? "battle-intense" : "battle";
  }
  if (pathname.startsWith("/builder") || pathname.startsWith("/decks")) return "deck-builder";
  return "menu";
}

export function weightedMusicTrack(
  tracks: MusicTrack[],
  category: MusicCategory,
  previousId = "",
  randomValue = Math.random(),
): MusicTrack | null {
  let candidates = tracks.filter((track) => (
    track.enabled
    && track.categories.includes(category)
    && track.id !== previousId
  ));
  if (!candidates.length) {
    candidates = tracks.filter((track) => track.enabled && track.categories.includes(category));
  }
  if (!candidates.length && category === "battle-intense") {
    return weightedMusicTrack(tracks, "battle", previousId, randomValue);
  }
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, track) => sum + Math.max(1, track.weight), 0);
  let cursor = Math.min(.999999, Math.max(0, randomValue)) * total;
  for (const track of candidates) {
    cursor -= Math.max(1, track.weight);
    if (cursor < 0) return track;
  }
  return candidates[candidates.length - 1] ?? null;
}

export function musicGain(volumePercent: number, masterPercent: number, gainDb: number) {
  const channel = Math.min(1, Math.max(0, Number(volumePercent) / 100));
  const master = Math.min(1, Math.max(0, Number(masterPercent) / 100));
  const trim = Math.pow(10, Math.min(MUSIC_GAIN_MAX_DB, Math.max(MUSIC_GAIN_MIN_DB, gainDb)) / 20);
  return Math.min(1, channel * master * trim);
}
