import type { DeckRecord } from "./data";

export const OFFLINE_PUBLIC_DECK_CACHE_KEY = "bbp-offline-public-decks-v1";
export const OFFLINE_PUBLIC_DECKS_UPDATED_EVENT = "bbp-offline-public-decks-updated";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type OfflinePublicDeckSnapshot = {
  version: 1;
  revision: number;
  decks: DeckRecord[];
};

const cloneDeck = (deck: DeckRecord): DeckRecord => ({
  ...deck,
  factions: [...deck.factions],
  bakuganIds: [...deck.bakuganIds],
  coreIds: [...deck.coreIds],
  cardIds: [...deck.cardIds],
  tags: [...(deck.tags ?? [])],
});

const isDeckRecord = (value: unknown): value is DeckRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DeckRecord>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.updatedAt === "string"
    && candidate.visibility === "Public"
    && Array.isArray(candidate.factions)
    && candidate.factions.every((item) => typeof item === "string")
    && Array.isArray(candidate.bakuganIds)
    && candidate.bakuganIds.every((item) => typeof item === "string")
    && Array.isArray(candidate.coreIds)
    && candidate.coreIds.every((item) => typeof item === "string")
    && Array.isArray(candidate.cardIds)
    && candidate.cardIds.every((item) => typeof item === "string");
};

export function readOfflinePublicDeckCache(storage: StorageLike): DeckRecord[] | null {
  try {
    const raw = storage.getItem(OFFLINE_PUBLIC_DECK_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<OfflinePublicDeckSnapshot>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.decks) || !snapshot.decks.every(isDeckRecord)) return null;
    return snapshot.decks.map(cloneDeck);
  } catch {
    return null;
  }
}

export function writeOfflinePublicDeckCache(
  storage: StorageLike,
  decks: DeckRecord[],
  revision = Date.now(),
) {
  const safeDecks = decks.filter(isDeckRecord).map(cloneDeck);
  const snapshot: OfflinePublicDeckSnapshot = {
    version: 1,
    revision: Number.isFinite(revision) ? revision : Date.now(),
    decks: safeDecks,
  };
  storage.setItem(OFFLINE_PUBLIC_DECK_CACHE_KEY, JSON.stringify(snapshot));
}

export function notifyOfflinePublicDecksUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT));
  }
}
