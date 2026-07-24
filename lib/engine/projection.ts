import { redactForPlayer, type MatchState } from "../game";
import { ENGINE_METADATA_KEY, type EngineBackedMatchState, type GameEvent } from "./types";

export type PublicGameEvent = Pick<GameEvent,
  "gameId" | "commandId" | "sequence" | "type" | "actorId" | "payload" | "engineVersion" | "rulesVersion" | "createdAt"
>;

export function projectMatchForPlayer(state: MatchState, playerId: string): MatchState {
  const projected = redactForPlayer(state, playerId) as EngineBackedMatchState;
  delete projected[ENGINE_METADATA_KEY];
  return projected;
}

export function projectEventsForPlayer(
  events: readonly GameEvent[],
  playerId: string,
): PublicGameEvent[] {
  return events
    .filter((event) => event.visibility === "public" || (event.visibility === "controller" && event.visibleTo === playerId))
    .map((event) => ({
      gameId: event.gameId,
      commandId: event.commandId,
      sequence: event.sequence,
      type: event.type,
      actorId: event.actorId,
      payload: event.payload,
      engineVersion: event.engineVersion,
      rulesVersion: event.rulesVersion,
      createdAt: event.createdAt,
    }));
}
