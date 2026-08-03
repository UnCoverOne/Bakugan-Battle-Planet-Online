import type { MatchState } from "./game";

export const TRAINING_AI_PLAYER_ID = "training-bot";

export type AdministratorIdentity = {
  id?: string;
  roles?: readonly string[];
} | null | undefined;

export function accountIsAdministrator(user: AdministratorIdentity) {
  return Boolean(user?.roles?.includes("administrator"));
}

export function trainingAiOpponent(
  match: MatchState | null | undefined,
  viewerId: string | undefined,
) {
  if (!match || !viewerId) return undefined;
  return match.players.find((player) => (
    player.id !== viewerId && player.id === TRAINING_AI_PLAYER_ID
  ));
}

/**
 * This is deliberately narrower than a general opponent-card reveal flag.
 * It can only authorize the built-in local Training AI seat, and only for an
 * authenticated Administrator whose server-owned preference is enabled.
 */
export function canRevealOpponentAiCards(
  match: MatchState | null | undefined,
  viewerId: string | undefined,
  user: AdministratorIdentity,
  preferenceEnabled: boolean,
) {
  return accountIsAdministrator(user)
    && preferenceEnabled
    && Boolean(trainingAiOpponent(match, viewerId));
}
