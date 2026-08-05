export const DECK_ENERGY_FACE_REVEAL_MS = 5_000;

export type EnergyEntrySource = "hand" | "deck" | "hero" | "self";

export type EnergyVisibilityCard = {
  id: string;
  energyFaceRevealUntil?: number;
};

/**
 * Record whether an Energized card may be shown to its owner. Only cards moved
 * from the top of the deck receive a temporary face-up window. Re-energizing a
 * card from another zone clears any stale reveal deadline carried by the card.
 */
export function applyEnergyEntryVisibility(
  cards: readonly EnergyVisibilityCard[],
  source: EnergyEntrySource,
  energizedAt = Date.now(),
) {
  const revealUntil = source === "deck"
    ? energizedAt + DECK_ENERGY_FACE_REVEAL_MS
    : undefined;
  for (const card of cards) {
    if (revealUntil == null) delete card.energyFaceRevealUntil;
    else card.energyFaceRevealUntil = revealUntil;
  }
}

export function deckEnergyFaceVisible(
  card: EnergyVisibilityCard,
  now: number,
) {
  const revealUntil = card.energyFaceRevealUntil;
  return typeof revealUntil === "number"
    && Number.isFinite(revealUntil)
    && revealUntil > now;
}

export function nextDeckEnergyFaceRevealExpiry(
  cards: readonly EnergyVisibilityCard[],
  now: number,
) {
  let next: number | null = null;
  for (const card of cards) {
    const revealUntil = card.energyFaceRevealUntil;
    if (typeof revealUntil !== "number" || !Number.isFinite(revealUntil) || revealUntil <= now) continue;
    if (next == null || revealUntil < next) next = revealUntil;
  }
  return next;
}
