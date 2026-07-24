import { cloneMatch, type GameCard, type MatchState } from "../game";
import { structuredPhaseFor } from "./phase-machine";
import {
  APPLICATION_VERSION,
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  ENGINE_METADATA_KEY,
  ENGINE_SCHEMA_VERSION,
  ENGINE_VERSION,
  MAX_EMBEDDED_COMMAND_RECEIPTS,
  RULES_VERSION,
  type CommandEnvelope,
  type CommandReceipt,
  type EngineBackedMatchState,
  type EngineMetadata,
  type GameEvent,
  type UnsequencedGameEvent,
} from "./types";

type CardLocation = {
  playerId: string;
  zone: string;
  card: GameCard;
};

function cardLocations(state: MatchState) {
  const locations = new Map<string, CardLocation>();
  for (const player of state.players) {
    const add = (cards: readonly GameCard[], zone: string) => {
      for (const card of cards) locations.set(card.id, { playerId: player.id, zone, card });
    };
    add(player.deckCards, "deck");
    add(player.hand, "hand");
    add(player.discard, "discard");
    add(player.energyZone, "energy");
    add(player.heroes, "heroes");
    for (const bakugan of player.bakugan) {
      add([bakugan.character], `character:${bakugan.id}`);
      add(bakugan.evoStack, `evo:${bakugan.id}`);
    }
  }
  for (const effect of state.batch) {
    if (!locations.has(effect.card.id)) {
      locations.set(effect.card.id, {
        playerId: effect.controllerId,
        zone: `batch:${effect.id}`,
        card: effect.card,
      });
    }
  }
  return locations;
}

function zoneIsPublic(zone: string | undefined) {
  if (!zone) return false;
  return zone.startsWith("discard")
    || zone.startsWith("heroes")
    || zone.startsWith("character")
    || zone.startsWith("evo")
    || zone.startsWith("batch");
}

function cardMovementEvent(
  actorId: CommandEnvelope["actorId"],
  before: CardLocation | undefined,
  after: CardLocation | undefined,
): UnsequencedGameEvent {
  const ownerId = after?.playerId ?? before?.playerId ?? "";
  const publicMovement = zoneIsPublic(before?.zone) || zoneIsPublic(after?.zone);
  const card = after?.card ?? before?.card;
  return {
    type: "CARD_MOVED",
    actorId,
    visibility: publicMovement ? "public" : "controller",
    visibleTo: publicMovement ? undefined : ownerId,
    payload: {
      cardId: card?.id,
      cardName: card?.displayName ?? card?.name,
      cardType: card?.type,
      ownerId,
      from: before?.zone ?? "outside-match",
      to: after?.zone ?? "outside-match",
    },
  };
}

function summarizeCommand(envelope: CommandEnvelope) {
  const command = envelope.command;
  switch (command.type) {
    case "JOIN_PLAYER":
      return { type: command.type, player: command.player };
    case "PLAY_CARD":
      return { type: command.type, cardId: command.cardId, choices: command.choices };
    case "PLAY_DAMAGE_FLIP":
      return { type: command.type, cardId: command.cardId, choices: command.choices };
    case "SUBMIT_CARD_CHOICE":
      return { type: command.type, choices: command.choices };
    default:
      return command;
  }
}

export function ensureEngineMetadata(state: EngineBackedMatchState): EngineMetadata {
  const current = state[ENGINE_METADATA_KEY];
  if (current) {
    current.schemaVersion = ENGINE_SCHEMA_VERSION;
    current.applicationVersion = current.applicationVersion || APPLICATION_VERSION;
    current.engineVersion = current.engineVersion || ENGINE_VERSION;
    current.rulesVersion = current.rulesVersion || RULES_VERSION;
    current.cardCatalogueVersion = current.cardCatalogueVersion || CARD_CATALOGUE_VERSION;
    current.digitalAdaptationVersion = current.digitalAdaptationVersion || DIGITAL_ADAPTATION_VERSION;
    current.contentSchemaVersion = current.contentSchemaVersion || CONTENT_SCHEMA_VERSION;
    current.nextEventSequence = Number.isInteger(current.nextEventSequence) && current.nextEventSequence > 0
      ? current.nextEventSequence
      : 1;
    current.receipts = Array.isArray(current.receipts) ? current.receipts : [];
    current.phase = structuredPhaseFor(state.phase);
    return current;
  }

  const metadata: EngineMetadata = {
    schemaVersion: ENGINE_SCHEMA_VERSION,
    applicationVersion: APPLICATION_VERSION,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    cardCatalogueVersion: CARD_CATALOGUE_VERSION,
    digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
    contentSchemaVersion: CONTENT_SCHEMA_VERSION,
    nextEventSequence: 1,
    phase: structuredPhaseFor(state.phase),
    receipts: [],
  };
  state[ENGINE_METADATA_KEY] = metadata;
  return metadata;
}

export function normalizeEngineState(state: MatchState): EngineBackedMatchState {
  const next = cloneMatch(state) as EngineBackedMatchState;
  ensureEngineMetadata(next);
  return next;
}

export function findCommandReceipt(
  state: EngineBackedMatchState,
  commandId: string,
): CommandReceipt | undefined {
  return ensureEngineMetadata(state).receipts.find((receipt) => receipt.commandId === commandId);
}

export function appendCommandReceipt(
  state: EngineBackedMatchState,
  receipt: CommandReceipt,
) {
  const metadata = ensureEngineMetadata(state);
  metadata.lastCommandId = receipt.commandId;
  metadata.phase = structuredPhaseFor(state.phase);
  metadata.receipts = [
    ...metadata.receipts.filter((candidate) => candidate.commandId !== receipt.commandId),
    receipt,
  ].slice(-MAX_EMBEDDED_COMMAND_RECEIPTS);
}

export function sequenceEvents(
  state: EngineBackedMatchState,
  envelope: CommandEnvelope,
  events: readonly UnsequencedGameEvent[],
): GameEvent[] {
  const metadata = ensureEngineMetadata(state);
  const sequenced = events.map((event) => ({
    ...event,
    gameId: state.id,
    commandId: envelope.commandId,
    sequence: metadata.nextEventSequence++,
    engineVersion: metadata.engineVersion,
    rulesVersion: metadata.rulesVersion,
    cardCatalogueVersion: metadata.cardCatalogueVersion,
    digitalAdaptationVersion: metadata.digitalAdaptationVersion,
    contentSchemaVersion: metadata.contentSchemaVersion,
    createdAt: envelope.issuedAt,
  }));
  return sequenced;
}

export function deriveTransitionEvents(
  before: MatchState,
  after: MatchState,
  envelope: CommandEnvelope,
): UnsequencedGameEvent[] {
  const events: UnsequencedGameEvent[] = [{
    type: "COMMAND_ACCEPTED",
    actorId: envelope.actorId,
    visibility: "server",
    payload: {
      command: summarizeCommand(envelope),
      expectedVersion: envelope.expectedVersion,
      randomSeed: envelope.randomSeed,
      requestHash: envelope.requestHash,
    },
  }];

  if (envelope.command.type === "JOIN_PLAYER") {
    events.push({
      type: "PLAYER_JOINED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: {
        playerId: envelope.command.player.id,
        playerName: envelope.command.player.name,
      },
    });
  }

  if (envelope.command.type === "RESOLVE_DEADLINE" && before.version !== after.version) {
    events.push({
      type: "DEADLINE_RESOLVED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: { fromPhase: before.phase, toPhase: after.phase },
    });
  }

  if (before.phase !== after.phase) {
    events.push({
      type: "PHASE_CHANGED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: {
        from: structuredPhaseFor(before.phase),
        to: structuredPhaseFor(after.phase),
        stepLabel: after.stepLabel,
      },
    });
  }

  if (before.priority !== after.priority) {
    events.push({
      type: "PRIORITY_CHANGED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: { fromPlayerId: before.priority, toPlayerId: after.priority },
    });
  }

  const beforeCards = cardLocations(before);
  const afterCards = cardLocations(after);
  const cardIds = new Set([...beforeCards.keys(), ...afterCards.keys()]);
  for (const cardId of cardIds) {
    const previous = beforeCards.get(cardId);
    const next = afterCards.get(cardId);
    if (previous?.zone !== next?.zone || previous?.playerId !== next?.playerId) {
      events.push(cardMovementEvent(envelope.actorId, previous, next));
    }
  }

  for (const player of after.players) {
    const previous = before.players.find((candidate) => candidate.id === player.id);
    if (!previous) continue;
    if (previous.energy !== player.energy || previous.maxEnergy !== player.maxEnergy) {
      events.push({
        type: "ENERGY_CHANGED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          playerId: player.id,
          energyBefore: previous.energy,
          energyAfter: player.energy,
          maxEnergyBefore: previous.maxEnergy,
          maxEnergyAfter: player.maxEnergy,
        },
      });
    }
    for (const bakugan of player.bakugan) {
      const previousBakugan = previous.bakugan.find((candidate) => candidate.id === bakugan.id);
      if (previousBakugan && previousBakugan.open !== bakugan.open) {
        events.push({
          type: "BAKUGAN_OPEN_STATE_CHANGED",
          actorId: envelope.actorId,
          visibility: "public",
          payload: {
            playerId: player.id,
            bakuganId: bakugan.id,
            open: bakugan.open,
          },
        });
      }
    }
  }

  const beforeAttachments = new Map(before.placements.map((placement) => [placement.cell, placement.attachedTo ?? null]));
  for (const placement of after.placements) {
    const previous = beforeAttachments.get(placement.cell) ?? null;
    const next = placement.attachedTo ?? null;
    if (previous !== next) {
      events.push({
        type: "BAKUCORE_ATTACHMENT_CHANGED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          cell: placement.cell,
          coreId: placement.core.id,
          fromBakuganId: previous,
          toBakuganId: next,
        },
      });
    }
  }

  const beforeBatch = new Set(before.batch.map((effect) => effect.id));
  const afterBatch = new Set(after.batch.map((effect) => effect.id));
  for (const effect of after.batch) {
    if (!beforeBatch.has(effect.id)) {
      events.push({
        type: "BATCH_OBJECT_ADDED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          effectId: effect.id,
          controllerId: effect.controllerId,
          cardId: effect.card.id,
          cardName: effect.card.displayName ?? effect.card.name,
          kind: effect.kind,
        },
      });
    }
  }
  for (const effect of before.batch) {
    if (!afterBatch.has(effect.id)) {
      events.push({
        type: "BATCH_OBJECT_REMOVED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          effectId: effect.id,
          controllerId: effect.controllerId,
          cardId: effect.card.id,
          cardName: effect.card.displayName ?? effect.card.name,
          negated: Boolean(effect.negated),
        },
      });
    }
  }

  if (before.pendingDamage !== after.pendingDamage || before.pendingLoser !== after.pendingLoser) {
    events.push({
      type: "PENDING_DAMAGE_CHANGED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: {
        loserId: after.pendingLoser,
        amount: after.pendingDamage,
        originPlayerId: after.damageOrigin,
      },
    });
  }

  const previousLogIds = new Set(before.log.map((entry) => entry.id));
  for (const entry of after.log) {
    if (!previousLogIds.has(entry.id)) {
      events.push({
        type: "LOG_ENTRY_ADDED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          logId: entry.id,
          kind: entry.kind,
          message: entry.message,
          at: entry.at,
        },
      });
    }
  }

  if (!before.winner && after.winner) {
    events.push({
      type: "GAME_ENDED",
      actorId: envelope.actorId,
      visibility: "public",
      payload: { winnerId: after.winner, reason: after.resultReason },
    });
  }

  events.push({
    type: "COMMAND_COMPLETED",
    actorId: envelope.actorId,
    visibility: "public",
    payload: {
      commandType: envelope.command.type,
      previousVersion: before.version,
      newVersion: after.version,
    },
  });
  return events;
}
