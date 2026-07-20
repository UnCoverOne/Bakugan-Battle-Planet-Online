import type { Bakugan, GameCard, MatchState } from "./game";

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

/**
 * The base engine already keeps every Evo underneath the newest one and uses the
 * top card for statistics. This reconciliation supplies the remaining rules:
 * resolving an Evo turns a face-down Character face up, while preserving every
 * older Evo in the same pile.
 */
export function reconcileResolvedEvos(input: MatchState, next: MatchState) {
  for (const nextPlayer of next.players) {
    const beforePlayer = input.players.find((candidate) => candidate.id === nextPlayer.id);
    if (!beforePlayer) continue;
    for (const nextBakugan of nextPlayer.bakugan) {
      const beforeBakugan = beforePlayer.bakugan.find((candidate) => candidate.id === nextBakugan.id);
      if (!beforeBakugan || nextBakugan.evoStack.length <= beforeBakugan.evoStack.length) continue;
      const wasClosed = !nextBakugan.open;
      nextBakugan.open = true;
      if (wasClosed) {
        next.log.push({
          id: `${Date.now()}-evo-open-${next.log.length}`,
          at: Date.now(),
          kind: "game",
          message: `${nextBakugan.name}'s Character card was turned face up before its Evo entered play.`,
        });
      }
    }
  }
  return next;
}
