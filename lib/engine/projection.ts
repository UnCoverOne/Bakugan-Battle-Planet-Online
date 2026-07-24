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
    .map(({ visibility: _visibility, visibleTo: _visibleTo, ...event }) => event);
}
