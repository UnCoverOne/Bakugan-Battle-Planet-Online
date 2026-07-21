import type { Bakugan, GameCard, MatchState } from "./game";

type CharacterFaceState = Bakugan & {
  characterFaceUp?: boolean;
};

function normalizedName(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evoCanTarget(card: GameCard | null | undefined, bakugan: Bakugan | null | undefined) {
  if (!card || card.type !== "Evo" || !bakugan || !card.evolvesFrom) return false;
  const matchesName = normalizedName(card.evolvesFrom) === normalizedName(bakugan.name);
  const matchesFaction = card.factions?.length
    ? card.factions.includes(bakugan.faction)
    : card.faction === bakugan.faction;
  return matchesName && matchesFaction;
}

export function legalEvoTargets(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  card: GameCard | null | undefined,
): readonly Bakugan[] {
  if (!match || !playerId || !card || card.type !== "Evo") return [];
  const player = match.players.find((candidate) => candidate.id === playerId);
  return player?.bakugan.filter((bakugan) => evoCanTarget(card, bakugan)) ?? [];
}

export function selectedEvoTargetId(root: ParentNode = document) {
  return root.querySelector<HTMLElement>(
    '[data-zone-kind="character-card"][data-zone-owner="player"][data-evo-target-selected="true"]',
  )?.dataset.bakuganId ?? "";
}

export function characterCardIsFaceUp(bakugan: Bakugan | null | undefined) {
  return Boolean(bakugan && (bakugan.open || (bakugan as CharacterFaceState).characterFaceUp));
}

