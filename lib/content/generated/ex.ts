import type { ExtensionCardRow } from "../card-set-extensions";

export const EX_ROWS = [
  ["ex-1", 1, "CC", "Titan Dragonoid", "Pyrus", "Character", 0, "", 700, 3, "[SD]", "[FT]", "", "Titan_Dragonoid_(Pyrus_Card)_ENG_1_CC_EX.png"],
  ["ex-2", 2, "BE", "Dragonoid Maximus", "Pyrus", "Evo", 10, "If you control Dan, Wynton, and Lia, you win the game.", 2500, 10, "", "", "Titan Dragonoid", "Dragonoid_Maximus_(Pyrus_Card)_ENG_2_BE_EX.png"],
] as const satisfies readonly ExtensionCardRow[];
