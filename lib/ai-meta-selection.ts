import type { DeckRecord } from "./data";
import {
  deckAllowedInMeta,
  metaSetCodeFromCatalogId,
  type LobbyMeta,
  type MetaSetCode,
} from "./meta-formats";

const BATTLE_BRAWLERS_ERA = Object.freeze(["BB", "BR", "AA", "EX"] as const);
const ARMORED_ALLIANCE_ERA = Object.freeze(["AV", "FF", "SV", "DI"] as const);
const GEOGAN_RISING_ERA = Object.freeze(["GR", "GG", "CP"] as const);

const META_ERA_PRIORITY: Readonly<Record<LobbyMeta, readonly (readonly MetaSetCode[])[]>> = Object.freeze({
  "battle-brawlers": Object.freeze([BATTLE_BRAWLERS_ERA]),
  "armored-alliance": Object.freeze([ARMORED_ALLIANCE_ERA, BATTLE_BRAWLERS_ERA]),
  "geogan-rising": Object.freeze([GEOGAN_RISING_ERA, ARMORED_ALLIANCE_ERA, BATTLE_BRAWLERS_ERA]),
  unlimited: Object.freeze([GEOGAN_RISING_ERA, ARMORED_ALLIANCE_ERA, BATTLE_BRAWLERS_ERA]),
});

function deckUsesAnySet(deck: Pick<DeckRecord, "bakuganIds" | "cardIds">, sets: readonly MetaSetCode[]) {
  const wanted = new Set<MetaSetCode>(sets);
  return [...deck.bakuganIds, ...deck.cardIds].some((catalogId) => {
    const set = metaSetCodeFromCatalogId(catalogId);
    return Boolean(set && wanted.has(set));
  });
}

/**
 * Returns only decks legal in the selected meta, preferring the newest era
 * represented by at least one available deck. This gives an era-native deck
 * priority while still allowing older-year fallback when no newer deck exists.
 */
export function preferredAiDeckCandidates(
  decks: readonly DeckRecord[],
  meta: LobbyMeta,
): DeckRecord[] {
  const legal = decks.filter((deck) => deckAllowedInMeta(meta, deck));
  if (!legal.length) return [];
  for (const eraSets of META_ERA_PRIORITY[meta]) {
    const eraDecks = legal.filter((deck) => deckUsesAnySet(deck, eraSets));
    if (eraDecks.length) return eraDecks;
  }
  // Unlimited may contain special/future sets that are deliberately outside
  // the named era buckets. They remain valid as a final fallback.
  return legal;
}

function secureRandomIndex(length: number) {
  if (length <= 1) return 0;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % length;
}

export function selectAiDeckForMeta(
  decks: readonly DeckRecord[],
  meta: LobbyMeta,
  randomIndex: (length: number) => number = secureRandomIndex,
): DeckRecord | null {
  const candidates = preferredAiDeckCandidates(decks, meta);
  if (!candidates.length) return null;
  const index = Math.max(0, Math.min(candidates.length - 1, Math.floor(randomIndex(candidates.length))));
  return candidates[index];
}
