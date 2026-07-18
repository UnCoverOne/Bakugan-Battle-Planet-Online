import type { Bakugan, MatchState, PlayerState } from "../../lib/game";

export function characterSelectionPlayer(
  match: MatchState | null | undefined,
  playerId?: string,
): PlayerState | null {
  if (!match?.players.length) return null;
  return match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
}

export function characterSelectionIsAvailable(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const player = characterSelectionPlayer(match, playerId);
  return Boolean(
    match
    && player
    && match.phase === "selection"
    && !match.selected[player.id],
  );
}

export function bakuganForCharacterSlot(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  slot: number,
): Bakugan | null {
  const player = characterSelectionPlayer(match, playerId);
  if (!player || !Number.isInteger(slot) || slot < 1) return null;
  return player.bakugan[slot - 1] ?? null;
}
