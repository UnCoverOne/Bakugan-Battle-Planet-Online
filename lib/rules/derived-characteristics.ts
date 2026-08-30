import type { Bakugan, Faction, GameCard, MatchState, PlayerState } from "../game";

export const ALL_FACTIONS = [
  "Aquos",
  "Aurelus",
  "Darkus",
  "Haos",
  "Pyrus",
  "Ventus",
] as const satisfies readonly Faction[];

/** Factions a card currently counts as, including characteristic-defining text. */
export function effectiveCardFactions(card: GameCard): Faction[] {
  if (/\bcounts as all Factions\b/i.test(card.effect)) return [...ALL_FACTIONS];
  return card.factions?.length ? [...card.factions] : [card.faction];
}

/** Factions the current top Character/Evo makes a Bakugan count as. */
export function effectiveBakuganFactions(bakugan: Bakugan): Faction[] {
  return effectiveCardFactions(bakugan.evoStack.at(-1) ?? (bakugan.fused ? bakugan.fusionCharacter : undefined) ?? bakugan.character);
}

export function bakuganHasFaction(bakugan: Bakugan, faction: Faction) {
  return effectiveBakuganFactions(bakugan).includes(faction);
}

/**
 * BakuCore attachment membership used by effects and characteristics.
 * Pandoxx creates additional virtual memberships without moving a physical
 * Core or removing the original holder's membership and bonuses.
 */
export function effectiveBakucoreCells(
  _state: MatchState,
  bakugan: Bakugan,
  owner: PlayerState,
): string[] {
  const top = bakugan.evoStack.at(-1) ?? (bakugan.fused ? bakugan.fusionCharacter : undefined) ?? bakugan.character;
  const cells = [...bakugan.heldCoreCells];
  const normalizedText = top.effect.replace(/\s+/g, " ");
  if (/Treat all BakuCores attached to your other Bakugan as though they are attached to this/i.test(normalizedText)) {
    cells.push(...owner.bakugan
      .filter((candidate) => candidate.id !== bakugan.id)
      .flatMap((candidate) => candidate.heldCoreCells));
  }
  // heldCoreCells is the Bakugan's authoritative membership list.  Placements
  // can legitimately be absent in reconstructed matches and compact test
  // states, so requiring a duplicate attachedTo marker would incorrectly turn
  // off printed held-Core bonuses in those states.
  return [...new Set(cells)];
}
