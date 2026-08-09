import { redactForPlayer, type GameCard, type MatchState } from "../game";
import { deckEnergyFaceVisible } from "../energyVisibility";
import { hideRankedDeckLists } from "../ranked-lobby";
import { ENGINE_METADATA_KEY, type EngineBackedMatchState, type GameEvent } from "./types";

export type PublicGameEvent = Pick<GameEvent,
  "gameId" | "commandId" | "sequence" | "type" | "actorId" | "payload" | "engineVersion" | "rulesVersion" | "cardCatalogueVersion" | "digitalAdaptationVersion" | "contentSchemaVersion" | "createdAt"
>;

function hiddenEnergyCard(id: string): GameCard {
  return {
    id,
    catalogId: "hidden",
    number: 0,
    name: "Face-down Energy card",
    displayName: "Face-down Energy card",
    faction: "Aquos",
    factions: [],
    type: "Action",
    cost: 0,
    rarity: "",
    effect: "",
    mechanics: [],
    bPower: null,
    damage: null,
    coreTypes: [],
    evolvesFrom: null,
    art: "/assets/cards/card-missing.svg",
  };
}

export function projectMatchForPlayer(state: MatchState, playerId: string, now = Date.now()): MatchState {
  const projected = hideRankedDeckLists(redactForPlayer(state, playerId), playerId) as EngineBackedMatchState;
  delete projected[ENGINE_METADATA_KEY];
  const owner = projected.players.find((player) => player.id === playerId);
  if (owner) {
    owner.energyZone = owner.energyZone.map((card) => (
      deckEnergyFaceVisible(card, now) ? card : hiddenEnergyCard(card.id)
    ));
  }
  return projected;
}

function clientEventPayload(event: GameEvent) {
  if (event.type === "CARD_MOVED" && event.payload.to === "energy") {
    const { cardName: _cardName, cardType: _cardType, ...safe } = event.payload;
    return { ...safe, cardName: "Face-down Energy card" };
  }
  return event.payload;
}

function publicShape(event: GameEvent): PublicGameEvent {
  return {
    gameId: event.gameId,
    commandId: event.commandId,
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId,
    payload: clientEventPayload(event),
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
