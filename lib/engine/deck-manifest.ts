import { cloneMatch, type GameCard, type MatchState, type PlayerState } from "../game";
import { ensureEngineMetadata } from "./events";
import {
  EngineInvariantError,
  type EngineBackedMatchState,
  type OriginalDeckManifest,
} from "./types";

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
  const bakuganCatalogIds = player.bakugan.map(
    (bakugan) => bakugan.character.catalogId,
  );
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

export function captureOriginalDeckManifest(
  state: EngineBackedMatchState,
  player: PlayerState,
) {
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

function sameMultiset(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rebuildPlayerZones(
  player: PlayerState,
  manifest: OriginalDeckManifest,
) {
  const teamIds = player.bakugan.map((bakugan) => bakugan.character.catalogId);
  const coreIds = player.cores.map((core) => core.catalogId ?? core.id);
  if (
    !sameMultiset(teamIds, manifest.bakuganCatalogIds)
    || !sameMultiset(coreIds, manifest.coreCatalogIds)
  ) {
    throw new EngineInvariantError(
      "ORIGINAL_TEAM_MANIFEST_MISMATCH",
      `Player ${player.id}'s current team does not match the immutable series manifest.`,
    );
  }

  const available = mainDeckCards(player);
  const rebuilt: GameCard[] = [];
  for (const catalogId of manifest.cardCatalogIds) {
    const index = available.findIndex((card) => card.catalogId === catalogId);
    if (index < 0) {
      throw new EngineInvariantError(
        "ORIGINAL_DECK_CARD_MISSING",
        `Player ${player.id}'s immutable series manifest is missing a ${catalogId} instance.`,
      );
    }
    rebuilt.push(available.splice(index, 1)[0]);
  }
  if (available.length || rebuilt.length !== 40) {
    throw new EngineInvariantError(
      "ORIGINAL_DECK_MANIFEST_MISMATCH",
      `Player ${player.id}'s current zones do not match the immutable 40-card series manifest.`,
    );
  }

  player.deckCards = rebuilt;
  player.deck = rebuilt.length;
  player.hand = [];
  player.discard = [];
  player.energyZone = [];
  player.heroes = [];
  player.energy = 0;
  player.maxEnergy = 0;
  for (const bakugan of player.bakugan) bakugan.evoStack = [];
}

export function restoreOriginalDecksForNextGame(
  input: MatchState,
): EngineBackedMatchState {
  const state = cloneMatch(input) as EngineBackedMatchState;
  const manifests = ensureOriginalDeckManifests(state);
  for (const player of state.players) {
    const manifest = manifests[player.id];
    if (!manifest) {
      throw new EngineInvariantError(
        "ORIGINAL_DECK_MANIFEST_MISSING",
        `Player ${player.id} has no immutable original deck manifest.`,
      );
    }
    rebuildPlayerZones(player, manifest);
  }
  return state;
}
