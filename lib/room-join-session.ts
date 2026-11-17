/**
 * Player IDs used by the match engine identify a *seat*, not the account or
 * browser. A browser-stored ID must never be reused for a new room entry:
 * another account on the same device may already occupy that ID in the lobby.
 *
 * Only an actual authenticated controller for this exact room may reconnect
 * using its existing player ID. This does not grant ownership of that seat;
 * the server still verifies the capability and controller.
 */
export type JoinSeatIdentity = {
  roomCode: string;
  currentMatchCode?: string | null;
  currentMatchPlayerIds?: readonly string[] | null;
  playerId: string;
  matchCapability?: string | null;
  matchControllerId?: string | null;
};

export function selectJoinSeatPlayerId(
  current: JoinSeatIdentity,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const sameRoom = current.roomCode.toUpperCase() === current.currentMatchCode?.toUpperCase();
  if (sameRoom
    && current.playerId
    && current.currentMatchPlayerIds?.includes(current.playerId)
    && current.matchCapability
    && current.matchControllerId
  ) return current.playerId;
  return createId();
}
