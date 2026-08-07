import { cloneMatch, setReady, type MatchState } from "./game";

/** The player who created the room always occupies the first seat. */
export function roomOwnerId(state: MatchState) {
  return state.players[0]?.id ?? "";
}

/**
 * Online lobby SET_READY semantics:
 * - first press marks a player ready and always keeps the room in the lobby;
 * - after both players are ready, a second press from the room owner starts play.
 *
 * Local/training matches continue to use game.setReady directly and retain their
 * existing automatic start behaviour.
 */
export function setLobbyReadyOrStart(input: MatchState, playerId: string) {
  if (input.phase !== "lobby") throw new Error("Ready is not legal now.");
  const player = input.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  if (!player.ready) {
    const otherReady = input.players.find((candidate) => candidate.id !== playerId && candidate.ready);
    if (input.players.length === 2 && otherReady) {
      // game.setReady historically starts as soon as the second player readies.
      // Temporarily mask the other ready seat so we can reuse all validation,
      // logging, versioning, and deck checks without advancing the phase.
      const guarded = cloneMatch(input);
      const guardedOther = guarded.players.find((candidate) => candidate.id === otherReady.id);
      if (guardedOther) guardedOther.ready = false;
      const next = setReady(guarded, playerId);
      const restoredOther = next.players.find((candidate) => candidate.id === otherReady.id);
      if (restoredOther) restoredOther.ready = true;
      return next;
    }
    return setReady(input, playerId);
  }

  if (roomOwnerId(input) !== playerId) {
    throw new Error("Only the room owner can start the match.");
  }
  if (input.players.length !== 2) {
    throw new Error("Wait for another Brawler to join before starting the match.");
  }
  if (!input.players.every((candidate) => candidate.ready)) {
    throw new Error("Both players must be ready before the room owner can start the match.");
  }

  // Calling the established transition with two ready seats performs the
  // server-authoritative starting-player selection. Remove only the duplicate
  // ready log emitted by this deliberate second invocation.
  const next = setReady(input, playerId);
  const duplicateReadyLogIndex = input.log.length;
  if (next.log[duplicateReadyLogIndex]?.message === `${player.name} locked a legal deck.`) {
    next.log.splice(duplicateReadyLogIndex, 1);
  }
  return next;
}
