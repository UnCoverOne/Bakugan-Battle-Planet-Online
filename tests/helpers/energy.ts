import { CARDS } from "../../lib/data";
import type { PlayerState } from "../../lib/game";

const ENERGY_CARD_TEMPLATE = CARDS.find((card) => card.type === "Action" && card.cost !== "X");
if (!ENERGY_CARD_TEMPLATE) throw new Error("The test catalogue needs an Energy fixture card.");

export function setPhysicalEnergy(player: PlayerState, amount: number) {
  const count = Math.max(0, Math.floor(amount));
  player.energyZone = Array.from({ length: count }, (_, index) => ({
    ...ENERGY_CARD_TEMPLATE,
    id: `${player.id}-test-energy-${index}`,
  }));
}
