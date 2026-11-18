import { BAKUGAN } from "./data";
import type { Bakugan, GameCard } from "./game";

export type BakuganRollingValues = Pick<Bakugan, "rollAccuracy" | "doubleCoreChance">;

// Keep references to the mutable Bakugan records so administrator overrides
// are reflected without rebuilding this lookup.
const bakuganByCardId = new Map(BAKUGAN.map((bakugan) => [bakugan.character.catalogId, bakugan]));
// Fusion cards represent the same physical Bakugan on both printed faces.
for (const bakugan of BAKUGAN) {
  if (bakugan.fusionCharacter) bakuganByCardId.set(bakugan.fusionCharacter.catalogId, bakugan);
}

export function bakuganRollingValues(card: Pick<GameCard, "catalogId" | "type">): BakuganRollingValues | null {
  return card.type === "Character" ? bakuganByCardId.get(card.catalogId) ?? null : null;
}
