import { makePlayer, type DeckRecord } from "../data";
import { cloneMatch, type GameCard, type MatchState, type PlayerState } from "../game";
import { ensureEngineMetadata } from "./events";
import { EngineInvariantError, type EngineBackedMatchState, type OriginalDeckManifest } from "./types";

function mainDeckCards(player: PlayerState): GameCard[] {
  return [
    ...player.deckCards,
    ...player.hand,
    ...player.discard,
    ...player.energyZone,
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => bakugan.evoStack),
  ].filter((card) => card.type !== "Character");
}

export function manifestFromPlayer(player: PlayerState): OriginalDeckManifest {
  const cardCatalogIds = mainDeckCards(player).map((card) => card.catalogId);
  if (cardCatalogIds.length !== 40) {
    throw new EngineInvariantError(
      "ORIGINAL_DECK_MANIFEST_INVALID",
      `Player ${player.id} has ${cardCatalogIds.length} recoverable Main Deck cards instead of 40.`,
    );
  }
  const bakuganCatalogIds = player.bakugan.map((bakugan) => bakugan.character.catalogId);
  const coreCatalogIds = player.cores.map((core) => core.catalogId ?? core.id);
  if (bakuganCatalogIds.length !== 3 || coreCatalogIds.length !== 6) {
    throw new EngineInvariantError(
      "ORIGINAL_TEAM_MANIFEST_INVALID",
      `Player ${player.id} does not have a complete three-Bakugan, six-BakuCore manifest.`,
    );
  }
  return {
    playerId: player.id,
    deckName: `${player.name}'s Series Deck`,
    cardCatalogIds,
    bakuganCatalogIds,
    coreCatalogIds,
  };
}

export function captureOriginalDeckManifest(state: EngineBackedMatchState, player: PlayerState) {
  const metadata = ensureEngineMetadata(state);
  metadata.originalDeckManifests = metadata.originalDeckManifests ?? {};
  if (!metadata.originalDeckManifests[player.id]) {
    metadata.originalDeckManifests[player.id] = manifestFromPlayer(player);
  }
  return metadata.originalDeckManifests[player.id];
}

export function ensureOriginalDeckManifests(state: EngineBackedMatchState) {
  for (const player of state.players) captureOriginalDeckManifest(state, player);
  return ensureEngineMetadata(state).originalDeckManifests!;
}

function rebuildPlayer(player: PlayerState, manifest: OriginalDeckManifest) {
  const deck: DeckRecord = {
    id: `series-${player.id}`,
    name: manifest.deckName,
    factions: [],
    bakuganIds: [...manifest.bakuganCatalogIds],
    coreIds: [...manifest.coreCatalogIds],
    cardIds: [...manifest.cardCatalogIds],
    updatedAt: new Date().toISOString(),
    visibility: "Private",
    format: "standard",
  };
  const rebuilt = makePlayer(player.id, player.name, deck);
  rebuilt.connected = player.connected;
  rebuilt.lastSeen = player.lastSeen;
  rebuilt.ready = player.ready;
  return rebuilt;
}

export function restoreOriginalDecksForNextGame(input: MatchState): EngineBackedMatchState {
  const state = cloneMatch(input) as EngineBackedMatchState;
  const manifests = ensureOriginalDeckManifests(state);
  state.players = state.players.map((player) => {
    const manifest = manifests[player.id];
    if (!manifest) {
      throw new EngineInvariantError(
        "ORIGINAL_DECK_MANIFEST_MISSING",
        `Player ${player.id} has no immutable original deck manifest.`,
      );
    }
    return rebuildPlayer(player, manifest);
  });
  return state;
}
