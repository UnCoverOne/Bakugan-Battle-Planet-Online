import type { GameCard } from "../game";

/** A Baku-Gear is Dual Wield only when its own text begins with [Dual]. */
export function isDualWieldGear(card: GameCard) {
  return card.type === "Baku-Gear" && /^\s*\[Dual\]\s*:/i.test(card.effect);
}

/** Shared mechanic matching for printed keywords and derived mechanics. */
export function cardHasMechanic(card: GameCard, mechanic: string) {
  if (/^dual(?: wield)?$/i.test(mechanic)) return isDualWieldGear(card);
  return card.mechanics.some((candidate) => candidate.toLowerCase() === mechanic.toLowerCase());
}
