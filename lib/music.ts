import type { MatchState } from "./game";

export const MUSIC_CATEGORIES = [
  "menu",
  "deck-builder",
  "training",
  "battle",
  "battle-intense",
  "victory",
  "defeat",
] as const;

export type MusicCategory = typeof MUSIC_CATEGORIES[number];

export const MUSIC_CATEGORY_LABELS: Record<MusicCategory, string> = {
  menu: "Menu",
  "deck-builder": "Deck Builder",
  training: "Training",
  battle: "Battle",
  "battle-intense": "Battle — Intense",
  victory: "Victory",
  defeat: "Defeat",
};

export type MusicTrack = {
  id: string;
  name: string;
  artist: string;
  sourceName: string;
  mimeType: "audio/ogg";
  bytes: number;
  durationMs: number;
  bitrate: number;
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
  "name" | "artist" | "enabled" | "categories" | "weight" | "loop" | "gainDb" | "durationMs" | "bitrate"
>;

export function normalizeMusicCategories(value: unknown): MusicCategory[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<MusicCategory>();
  for (const candidate of value) {
    if (!MUSIC_CATEGORIES.includes(candidate as MusicCategory)) continue;
    seen.add(candidate as MusicCategory);
  }
  return [...seen];
}

export function musicCategoryForRoute(
  pathname: string,
  match: MatchState | null | undefined,
  online: boolean,
  playerId: string,
): MusicCategory {
  if (pathname === "/play/match" && match) {
    if (match.phase === "result" && match.winner) {
      return match.winner === playerId ? "victory" : "defeat";
    }
    if (!online) return "training";
    if (match.format === "bo3" && Number(match.gameNumber) >= 3) return "battle-intense";
    return "battle";
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
  const trim = Math.pow(10, Math.min(6, Math.max(-12, gainDb)) / 20);
  return Math.min(1, channel * master * trim);
}
