import type { Bakugan, MatchState, PlayerState } from "../../lib/game";

export function selectionPlayer(
  match: MatchState | null | undefined,
  playerId?: string,
): PlayerState | null {
  if (!match?.players.length) return null;
  return match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
}

export function selectableCharacterBakugan(
  match: MatchState | null | undefined,
  playerId?: string,
): readonly Bakugan[] {
  const player = selectionPlayer(match, playerId);
  if (!match || !player || match.phase !== "selection") return [];

  const closed = player.bakugan.filter((bakugan) => !bakugan.open);
  return closed.length ? closed : player.bakugan;
}

export function characterSelectionCanConfirm(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  bakuganId: string,
) {
  if (!bakuganId) return false;
  return selectableCharacterBakugan(match, playerId)
    .some((bakugan) => bakugan.id === bakuganId);
}
