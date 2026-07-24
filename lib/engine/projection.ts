import { redactForPlayer, type MatchState } from "../game";
import { ENGINE_METADATA_KEY, type EngineBackedMatchState, type GameEvent } from "./types";

export type PublicGameEvent = Pick<GameEvent,
  "gameId" | "commandId" | "sequence" | "type" | "actorId" | "payload" | "engineVersion" | "rulesVersion" | "cardCatalogueVersion" | "digitalAdaptationVersion" | "contentSchemaVersion" | "createdAt"
>;

export function projectMatchForPlayer(state: MatchState, playerId: string): MatchState {
  const projected = redactForPlayer(state, playerId) as EngineBackedMatchState;
  delete projected[ENGINE_METADATA_KEY];
  return projected;
}

function publicShape(event: GameEvent): PublicGameEvent {
  return {
    gameId: event.gameId,
    commandId: event.commandId,
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId,
    payload: event.payload,
    engineVersion: event.engineVersion,
    rulesVersion: event.rulesVersion,
    cardCatalogueVersion: event.cardCatalogueVersion,
    digitalAdaptationVersion: event.digitalAdaptationVersion,
    contentSchemaVersion: event.contentSchemaVersion,
    createdAt: event.createdAt,
  };
}

export type ProjectedEventStreams = { publicEvents: PublicGameEvent[]; privateEvents: PublicGameEvent[] };
export function projectEventStreamsForPlayer(events: readonly GameEvent[], playerId: string): ProjectedEventStreams {
  return {
    publicEvents: events.filter((event) => event.visibility === "public").map(publicShape),
    privateEvents: events.filter((event) => event.visibility === "controller" && event.visibleTo === playerId).map(publicShape),
  };
}

export function projectEventsForPlayer(events: readonly GameEvent[], playerId: string): PublicGameEvent[] {
  const streams = projectEventStreamsForPlayer(events, playerId);
  return [...streams.publicEvents, ...streams.privateEvents].sort((left, right) => left.sequence - right.sequence);
}
