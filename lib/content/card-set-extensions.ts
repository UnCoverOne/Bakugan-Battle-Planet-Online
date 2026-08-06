import type { ControlledCardRecord } from "./catalogue";
import { constructionIdentityForCard } from "./construction-identity";

export type ExtensionCardRow = readonly [
  id: string,
  number: number,
  rarityCode: string,
  displayName: string,
  faction: ControlledCardRecord["faction"],
  type: ControlledCardRecord["type"],
  cost: number | "X",
  effect: string,
  bPower: number | null,
  damage: number | null,
  coreOne: string,
  coreTwo: string,
  evolvesFrom: string,
  scanFilename: string,
];

const RARITIES: Record<string, string> = {
  CC: "Character Card",
  CO: "Common",
  RA: "Rare",
  SR: "Super Rare",
  AR: "Awesome Rare",
  BE: "Bakugan Elite",
};

type ExtensionSetCode = "BR" | "AA" | "EX";

const SET_NAMES: Record<ExtensionSetCode, string> = {
  BR: "Bakugan Resurgence",
  AA: "Age of Aurelus",
  EX: "EX",
};

/** Official text corrections applied after the supplied set workbooks were authored. */
const CARD_TEXT_ERRATA: Readonly<Record<string, string>> = Object.freeze({
  "aa-69": "When you play this, search your deck for a card. You may put that card into your hand. Then shuffle your deck. If you have three of this in play, your Bakugan get +300 [B] and +3 [Damage Rating].",
});

const CORES: Record<string, ControlledCardRecord["coreTypes"][number]> = {
  "[FT]": "Fist",
  "[FF]": "Flaming Fist",
  "[SD]": "Shield",
  "[MS]": "Magic Shield",
  "[HE]": "Helix",
};

function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function mechanicsFor(effect: string) {
  const mechanics = new Set<string>();
  const checks: Array<[RegExp, string]> = [
    [/[+-]\d+\s*\[B\]/i, "B-Power"],
    [/[+-]\d+\s*\[Damage Rating\]/i, "Damage"],
    [/\[FrostStrike\]/i, "FrostStrike"],
    [/\[ShadowStrike\]/i, "ShadowStrike"],
    [/\[DoubleStrike\]/i, "DoubleStrike"],
    [/\[Stop\]/i, "Stop"],
    [/\bReroll\b/i, "Reroll"],
    [/\bDraw\b/i, "Draw"],
    [/\bdiscard\b/i, "Discard"],
    [/\bEnergize\b|\bEnergy cards?\b/i, "Energy"],
    [/\bBakuCore\b|\[(?:FT|FF|SD|MS|HE)\]/i, "BakuCore"],
    [/\bNegate\b/i, "Negate"],
    [/\bCopy\b/i, "Copy"],
    [/\bsearch your deck\b/i, "Search"],
    [/\bVictor\b/i, "Victor"],
    [/\bFury\b/i, "Fury"],
    [/\bFlow\b/i, "Flow"],
    [/\bTurbo\b/i, "Turbo"],
    [/\bDomination\b/i, "Domination"],
    [/\bSacrifice\b/i, "Sacrifice"],
    [/\bAurelus Power\b/i, "Aurelus Power"],
    [/\bBattle Mastery\b/i, "Battle Mastery"],
    [/\bUnderdog\b/i, "Underdog"],
    [/\bwin the game\b/i, "Alternate Win"],
    [/\bWhen\b|\bAt the end\b/i, "Triggered"],
    [/\bYour Bakugan\b|\bOpposing Bakugan\b|\bTreat all\b/i, "Static"],
  ];
  for (const [pattern, mechanic] of checks) if (pattern.test(effect)) mechanics.add(mechanic);
  return [...mechanics];
}

function scanUrl(setCode: ExtensionSetCode, id: string, filename: string) {
  if (!filename) return "/assets/cards/card-missing.svg";
  const extension = filename.startsWith("@svg/") ? "svg" : "webp";
  return `/assets/cards/sets/${setCode.toLowerCase()}/full/${id}.${extension}`;
}

export function recordsFromRows(
  setCode: ExtensionSetCode,
  rows: readonly ExtensionCardRow[],
): ControlledCardRecord[] {
  const setName = SET_NAMES[setCode];
  return rows.map((row) => {
    const [id, number, rarityCode, displayName, faction, type, cost, printedEffect, bPower, damage, coreOne, coreTwo, evolvesFrom, scanFilename] = row;
    const effect = CARD_TEXT_ERRATA[id] ?? printedEffect;
    const internalName = type === "Character" || type === "Evo"
      ? `${faction} ${displayName}`
      : id === "br-80"
        ? "Strata (Bakugan Resurgence)"
        : displayName;
    const coreTypes = [coreOne, coreTwo].map((token) => CORES[token]).filter(Boolean) as ControlledCardRecord["coreTypes"];
    return {
      id,
      number,
      name: internalName,
      displayName,
      constructionIdentity: constructionIdentityForCard({
        name: internalName,
        displayName,
        effect,
      }),
      faction,
      factions: [faction],
      type,
      cost,
      rarity: RARITIES[rarityCode] ?? rarityCode,
      effect,
      mechanics: mechanicsFor(effect),
      bPower,
      damage,
      coreTypes,
      evolvesFrom: evolvesFrom || null,
      art: scanUrl(setCode, id, scanFilename),
      hasProvidedScan: Boolean(scanFilename),
      source: `${setName} supplied workbook${scanFilename ? " and card scan" : ""}`,
      slug: `${setCode.toLowerCase()}-${number}-${slugify(displayName)}`,
    };
  });
}
