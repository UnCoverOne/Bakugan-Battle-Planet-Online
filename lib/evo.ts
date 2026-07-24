import type { Bakugan, GameCard, MatchState } from "./game";
import { ruleDefinitionForCard } from "./rules/catalogue";
import { canonicalEvoTargetAllowed } from "./rules/identity";

type CharacterFaceState = Bakugan & { characterFaceUp?: boolean };

export function evoCanTarget(card: GameCard | null | undefined, bakugan: Bakugan | null | undefined) {
  if (!card || card.type !== "Evo" || !bakugan) return false;
  return canonicalEvoTargetAllowed(ruleDefinitionForCard(card), bakugan);
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
