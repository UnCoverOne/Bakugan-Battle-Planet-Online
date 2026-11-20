import type { Core, GameCard } from "./game";
import { compareCardCollectorOrder } from "./content/catalogue";
import { DEVELOPER_RULINGS, type RulingRecord } from "./developer-rulings";
import { RULEBOOK_IDS, ruleAnchor } from "./rulebook-reader";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && [...left].sort().join("|") === [...right].sort().join("|");
const identity = (card: GameCard) => card.constructionIdentity ?? card.catalogId;
const baseFace = (card: GameCard, cards: readonly GameCard[]) =>
  card.fusionFace === "b"
    ? cards.find(candidate => candidate.fusionPairId && candidate.fusionPairId === card.fusionPairId && candidate.fusionFace === "a") ?? card
    : card;

/** Printings must share the actual gameplay profile, not merely a printed name. */
export function inspectorCardPrintings(selected: GameCard, cards: readonly GameCard[]) {
  const base = baseFace(selected, cards);
  return cards.filter(candidate =>
    candidate.fusionFace !== "b" &&
    identity(candidate) === identity(base) &&
    candidate.type === base.type &&
    candidate.cost === base.cost &&
    candidate.bPower === base.bPower &&
    candidate.damage === base.damage &&
    candidate.armorRating === base.armorRating &&
    candidate.effect === base.effect &&
    candidate.evolvesFrom === base.evolvesFrom &&
    same(candidate.factions, base.factions) &&
    same(candidate.coreTypes, base.coreTypes)
  ).toSorted(compareCardCollectorOrder);
}

export function inspectorFusionFace(card: GameCard, cards: readonly GameCard[], face: "a" | "b") {
  if (face === "a" || !card.fusionPairId) return card;
  return cards.find(candidate =>
    candidate.fusionPairId === card.fusionPairId && candidate.fusionFace === "b"
  ) ?? card;
}

function matchesBase(evo: GameCard, candidate: GameCard) {
  if (evo.type !== "Evo" || candidate.type !== "Character" || candidate.fusionFace === "b" || !evo.evolvesFrom) return false;
  if (!evo.factions.some(faction => candidate.factions.includes(faction))) return false;
  const baseName = normalize(evo.evolvesFrom);
  return normalize(candidate.displayName) === baseName ||
    normalize(candidate.name) === baseName ||
    candidate.factions.some(faction => normalize(candidate.name) === normalize(faction + " " + baseName));
}

function uniqueProfiles(cards: GameCard[]) {
  const seen = new Set<string>();
  return cards.filter(card => {
    const key = [identity(card), card.type, card.factions.join("/"), card.bPower, card.damage].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function inspectorEvolutionBases(evo: GameCard, cards: readonly GameCard[]) {
  return uniqueProfiles(cards.filter(candidate => matchesBase(evo, candidate)).toSorted(compareCardCollectorOrder));
}

export function inspectorEvolutionChildren(base: GameCard, cards: readonly GameCard[]) {
  if (base.type !== "Character") return [];
  return uniqueProfiles(cards.filter(evo =>
    evo.type === "Evo" && matchesBase(evo, base)
  ).toSorted(compareCardCollectorOrder));
}

export type InspectorRuleLink = { id: string; title: string; href: string };
const typeSections: Record<string, readonly [string, string][]> = {
  Character: [["3.2", "Character cards"], ["2.11", "BakuCore indicators"]],
  Evo: [["3.3", "Evo cards"], ["2.16", "Evo identification"]],
  Hero: [["3.4", "Hero cards"]],
  "Flip Hero": [["3.6", "Flip cards (general)"], ["3.4", "Hero cards (general)"]],
  Action: [["3.5", "Action cards"]],
  Flip: [["3.6", "Flip cards"]],
  // Baku-Gear was introduced after the 2019 official rulebook.
  "Baku-Gear": [],
};
export function inspectorOfficialRules(card?: GameCard, core?: Core): InspectorRuleLink[] {
  const sources = core
    ? ([["1.12", "BakuCores"], ["4.7", "The BakuCore field"]] as const)
    : typeSections[card?.type ?? ""] ?? [];
  return sources.filter(([id]) => RULEBOOK_IDS.has(id)).map(([id, title]) => ({
    id, title, href: "/compendium/rules" + ruleAnchor(id),
  }));
}

/**
 * Developer-ruling matches are restricted to manually transcribed, explicitly
 * mentioned card identities. Never infer an authoritative link from shared
 * gameplay keywords such as "damage", "energy", or "faction".
 */
export function inspectorDeveloperRulings(
  card: GameCard | undefined,
  core: Core | undefined,
  allCards: readonly GameCard[],
): RulingRecord[] {
  if (core) {
    const numbers = core.bakuGearCostReduction ? [3, 44] : [];
    return DEVELOPER_RULINGS.filter(entry => numbers.includes(entry.number));
  }
  if (!card) return [];
  const exact = new Set([card.name, card.displayName,
    ...card.factions.map(faction => faction + " " + card.displayName),
  ].map(normalize));
  const ambiguousNames = new Set(allCards.filter(candidate =>
    candidate.type !== card.type || !candidate.factions.some(faction => card.factions.includes(faction))
  ).flatMap(candidate => [normalize(candidate.name), normalize(candidate.displayName)]));
  return DEVELOPER_RULINGS.filter(ruling => ruling.mentionedCards.some(value => {
    const name = normalize(value);
    return exact.has(name) && !ambiguousNames.has(name);
  }));
}
