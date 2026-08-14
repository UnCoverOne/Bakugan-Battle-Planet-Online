import { BAKUGAN, CARD_BY_ID, CORES } from "../data";
import type { Bakugan, Core, GameCard, MatchState, PlayerState } from "../game";
import { cloneMatch } from "../game";
import {
  APPLICATION_VERSION,
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  ENGINE_METADATA_KEY,
  ENGINE_VERSION,
  RULES_VERSION,
  type CommandEnvelope,
  type EngineBackedMatchState,
  type GameCommand,
} from "./types";
import {
  REPLAY_SCHEMA_VERSION,
  type CompactBakuganInstance,
  type CompactCardInstance,
  type CompactCoreInstance,
  type CompactPlayerState,
  type CompactReplayCommand,
  type CompactReplayGenesis,
  type ReplayArchive,
  type ReplayRecording,
} from "./replay-types";

const CORE_BY_ID = new Map(CORES.map((core) => [core.catalogId ?? core.id, core]));
const BAKUGAN_BY_ID = new Map(BAKUGAN.map((bakugan) => [bakugan.id, bakugan]));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactCard(card: GameCard): CompactCardInstance {
  return {
    i: card.id,
    c: card.catalogId,
    ...(card.playedTurn == null ? {} : { p: card.playedTurn }),
    ...(card.energyFaceRevealUntil == null ? {} : { r: card.energyFaceRevealUntil }),
  };
}

function expandCard(card: CompactCardInstance): GameCard {
  const definition = CARD_BY_ID.get(card.c);
  if (!definition) throw new Error(`Replay requires unavailable card catalogue entry ${card.c}.`);
  return {
    ...clone(definition),
    id: card.i,
    ...(card.p == null ? {} : { playedTurn: card.p }),
    ...(card.r == null ? {} : { energyFaceRevealUntil: card.r }),
  };
}

function compactCore(core: Core): CompactCoreInstance {
  return { i: core.id, c: core.catalogId ?? core.id };
}

function expandCore(core: CompactCoreInstance): Core {
  const definition = CORE_BY_ID.get(core.c);
  if (!definition) throw new Error(`Replay requires unavailable BakuCore catalogue entry ${core.c}.`);
  return { ...clone(definition), id: core.i, catalogId: core.c };
}

function compactBakugan(bakugan: Bakugan): CompactBakuganInstance {
  const catalogueId = bakugan.character.catalogId || bakugan.id;
  return {
    i: bakugan.id,
    c: catalogueId,
    ci: bakugan.character.id,
    ...(bakugan.open ? { o: 1 as const } : {}),
    ...(bakugan.heldCoreCells.length ? { h: [...bakugan.heldCoreCells] } : {}),
    ...(bakugan.evoStack.length ? { e: bakugan.evoStack.map(compactCard) } : {}),
    ...(bakugan.openedTurn == null ? {} : { t: bakugan.openedTurn }),
  };
}

function expandBakugan(bakugan: CompactBakuganInstance): Bakugan {
  const definition = BAKUGAN_BY_ID.get(bakugan.c);
  if (!definition) throw new Error(`Replay requires unavailable Bakugan catalogue entry ${bakugan.c}.`);
  return {
    ...clone(definition),
    id: bakugan.i,
    character: { ...clone(definition.character), id: bakugan.ci },
    open: bakugan.o === 1,
    heldCoreCells: [...(bakugan.h ?? [])],
    evoStack: (bakugan.e ?? []).map(expandCard),
    ...(bakugan.t == null ? {} : { openedTurn: bakugan.t }),
  };
}

export function compactReplayPlayer(player: PlayerState): CompactPlayerState {
  const configured = player as PlayerState & {
    avatar?: string;
    lobbyDeckFormat?: "standard" | "singleton" | "competitive";
    lobbyDeckName?: string;
  };
  const avatar = configured.avatar;
  return {
    id: player.id,
    n: player.name,
    ...(avatar ? { a: avatar } : {}),
    ...(configured.lobbyDeckFormat ? { lf: configured.lobbyDeckFormat } : {}),
    ...(configured.lobbyDeckName ? { ln: configured.lobbyDeckName } : {}),
    b: player.bakugan.map(compactBakugan),
    c: player.cores.map(compactCore),
    d: player.deckCards.map(compactCard),
    h: player.hand.map(compactCard),
    ...(player.discard.length ? { x: player.discard.map(compactCard) } : {}),
    ...(player.energyZone.length ? { e: player.energyZone.map(compactCard) } : {}),
    ...(player.heroes.length ? { r: player.heroes.map(compactCard) } : {}),
    ...(player.energy ? { en: player.energy } : {}),
    ...(player.maxEnergy ? { me: player.maxEnergy } : {}),
    ...(player.ready ? { rd: 1 as const } : {}),
    ...(!player.connected ? { cn: 0 as const } : {}),
    ...(player.lastSeen ? { ls: player.lastSeen } : {}),
    ...(player.energizedThisTurn ? { et: 1 as const } : {}),
    ...(player.cardsPlayedThisTurn ? { cp: player.cardsPlayedThisTurn } : {}),
    ...(player.factionsPlayedThisTurn?.length ? { fp: [...player.factionsPlayedThisTurn] } : {}),
    ...(player.revealedDeckCardId ? { rv: player.revealedDeckCardId } : {}),
  };
}

export function expandReplayPlayer(player: CompactPlayerState): PlayerState {
  const expanded: PlayerState & {
    avatar?: string;
    lobbyDeckFormat?: "standard" | "singleton" | "competitive";
    lobbyDeckName?: string;
  } = {
    id: player.id,
    name: player.n,
    bakugan: player.b.map(expandBakugan),
    cores: player.c.map(expandCore),
    deck: player.d.length,
    deckCards: player.d.map(expandCard),
    hand: player.h.map(expandCard),
    discard: (player.x ?? []).map(expandCard),
    energyZone: (player.e ?? []).map(expandCard),
    heroes: (player.r ?? []).map(expandCard),
    energy: player.en ?? 0,
    maxEnergy: player.me ?? 0,
    ready: player.rd === 1,
    connected: player.cn !== 0,
    lastSeen: player.ls ?? 0,
    energizedThisTurn: player.et === 1,
    cardsPlayedThisTurn: player.cp ?? 0,
    factionsPlayedThisTurn: [...(player.fp ?? [])],
    ...(player.rv ? { revealedDeckCardId: player.rv } : {}),
  };
  if (player.a) expanded.avatar = player.a;
  if (player.lf) expanded.lobbyDeckFormat = player.lf;
  if (player.ln) expanded.lobbyDeckName = player.ln;
  return expanded;
}

export function captureReplayGenesis(state: MatchState): CompactReplayGenesis {
  const copied = cloneMatch(state) as EngineBackedMatchState;
  delete copied[ENGINE_METADATA_KEY];
  const { players, ...rest } = copied;
  return { state: rest, players: players.map(compactReplayPlayer) };
}

export function expandReplayGenesis(genesis: CompactReplayGenesis): MatchState {
  return clone({ ...genesis.state, players: genesis.players.map(expandReplayPlayer) });
}

export function compactReplayCommand(envelope: CommandEnvelope): CompactReplayCommand {
  const command = envelope.command.type === "JOIN_PLAYER" || envelope.command.type === "UPDATE_LOBBY_DECK"
    ? { ...envelope.command, player: compactReplayPlayer(envelope.command.player) }
    : clone(envelope.command);
  return {
    a: envelope.actorId,
    t: envelope.issuedAt,
    s: envelope.randomSeed,
    c: command,
  } as CompactReplayCommand;
}

export function expandReplayCommand(
  gameId: string,
  command: CompactReplayCommand,
  index: number,
  expectedVersion: number,
): CommandEnvelope {
  const expanded = command.c.type === "JOIN_PLAYER" || command.c.type === "UPDATE_LOBBY_DECK"
    ? { ...command.c, player: expandReplayPlayer(command.c.player) }
    : clone(command.c);
  return {
    commandId: `replay:${gameId}:${index}`,
    gameId,
    actorId: command.a,
    expectedVersion,
    issuedAt: command.t,
    randomSeed: command.s,
    requestHash: `replay:${index}`,
    command: expanded as GameCommand,
  };
}

export function createReplayRecording(state: MatchState): ReplayRecording {
  return { schemaVersion: REPLAY_SCHEMA_VERSION, genesis: captureReplayGenesis(state), commands: [] };
}

function canonicalStateForHash(state: MatchState) {
  const copy = cloneMatch(state) as EngineBackedMatchState;
  delete copy[ENGINE_METADATA_KEY];
  // Online persistence deliberately prunes the legacy text log while replay
  // reconstruction replays the complete command journal. The log is an audit
  // surface, not battlefield state, so retention must not invalidate an
  // otherwise deterministic replay.
  copy.log = [];
  const ranked = (copy as MatchState & {
    ranked?: { stage?: string; settlement?: unknown };
  }).ranked;
  if (ranked) {
    // Rating settlement is account metadata written after the final gameplay
    // command. It is intentionally not part of deterministic match playback.
    delete ranked.settlement;
    if (copy.phase === "result" && Math.max(...Object.values(copy.series)) >= 2) {
      ranked.stage = "complete";
    }
  }
  for (const player of copy.players) {
    player.connected = true;
    player.lastSeen = 0;
  }
  return copy;
}

function legacyCanonicalStateForHash(state: MatchState) {
  const copy = cloneMatch(state) as EngineBackedMatchState;
  delete copy[ENGINE_METADATA_KEY];
  for (const player of copy.players) {
    player.connected = true;
    player.lastSeen = 0;
  }
  return copy;
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

/** Portable integrity digest; compatibility, not cryptographic authentication. */
export function replayStateHash(state: MatchState): string {
  const input = stableJson(canonicalStateForHash(state));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

/** Hash compatibility for archives produced before account settlement left gameplay playback. */
export function legacyReplayStateHash(state: MatchState): string {
  const input = stableJson(legacyCanonicalStateForHash(state));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

export function archiveReplayRecording(
  recording: ReplayRecording,
  state: MatchState,
  completedAt = Date.now(),
): ReplayArchive {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    replayId: state.id,
    capturedAt: completedAt,
    startedAt: recording.genesis.state.log[0]?.at ?? recording.commands[0]?.t ?? completedAt,
    completedAt,
    finalVersion: state.version,
    finalStateHash: replayStateHash(state),
    versions: {
      applicationVersion: APPLICATION_VERSION,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
      cardCatalogueVersion: CARD_CATALOGUE_VERSION,
      digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
      contentSchemaVersion: CONTENT_SCHEMA_VERSION,
    },
    recording: clone(recording),
  };
}

/** Read-only bridge for active snapshots created by the previous recorder. */
export function archiveReplay(state: EngineBackedMatchState, completedAt = Date.now()): ReplayArchive | null {
  const recording = (state[ENGINE_METADATA_KEY] as { replay?: ReplayRecording } | undefined)?.replay;
  return recording ? archiveReplayRecording(recording, state, completedAt) : null;
}
