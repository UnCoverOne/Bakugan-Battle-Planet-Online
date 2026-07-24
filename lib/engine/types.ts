import type { CardChoices, MatchState, PlayerState } from "../game";

export const ENGINE_SCHEMA_VERSION = 1 as const;
export const ENGINE_VERSION = "3.0.0";
export const RULES_VERSION = "battle-planet-rules-v3";
export const ENGINE_METADATA_KEY = "__engine" as const;
export const MAX_EMBEDDED_COMMAND_RECEIPTS = 128;

export type CommandActorId = string | "system";
export type GameCommand =
  | { type: "SET_READY" }
  | { type: "BEGIN_CORE_PLACEMENT" }
  | { type: "PLACE_CORE"; coreId: string; cell: string }
  | { type: "DRAW_TURN_CARD" }
  | { type: "ENERGIZE"; cardId?: string }
  | { type: "TAP_ENERGY_CARD"; cardId: string }
  | { type: "SELECT_BAKUGAN"; bakuganId: string }
  | { type: "SELECT_ROLL_TARGET"; cell: string }
  | { type: "CONFIRM_ROLL" }
  | { type: "PREPARE_CARD_PLAY"; cardId: string }
  | { type: "PLAY_CARD"; cardId: string; choices: CardChoices }
  | { type: "SUBMIT_CARD_CHOICE"; choices: CardChoices }
  | { type: "CANCEL_CARD_CHOICE" }
  | { type: "ORDER_TRIGGERS"; requestId: string; orderedIds: string[] }
  | { type: "PASS_PRIORITY" }
  | { type: "REVEAL_DAMAGE_FLIP" }
  | { type: "PLAY_DAMAGE_FLIP"; cardId?: string; choices: CardChoices }
  | { type: "DISCARD_TO_HAND_LIMIT"; cardIds: string[] }
  | { type: "CHAT"; message: string }
  | { type: "CONCEDE" }
  | { type: "NEXT_TURN" }
  | { type: "START_NEXT_SERIES_GAME" }
  | { type: "UNDO" }
  | { type: "JOIN_PLAYER"; player: PlayerState }
  | { type: "RESOLVE_DEADLINE" };
export type GameCommandType = GameCommand["type"];
export type CommandEnvelope = {
  commandId: string;
  gameId: string;
  actorId: CommandActorId;
  expectedVersion: number;
  issuedAt: number;
  randomSeed: string;
  requestHash: string;
  command: GameCommand;
};
export type StructuredPhase =
  | { area: "lobby"; step: "ready"; legacy: MatchState["phase"] }
  | { area: "setup"; step: "starting-player" | "core-placement" | "draw" | "energize"; legacy: MatchState["phase"] }
  | { area: "roll"; step: "selection" | "pre-roll-priority" | "targeting-and-rolling"; legacy: MatchState["phase"] }
  | { area: "brawl"; step: "power" | "victor" | "damage" | "post-damage" | "retract" | "end-play" | "hand-limit"; legacy: MatchState["phase"] }
  | { area: "result"; step: "match-result"; legacy: MatchState["phase"] };
export type EventVisibility = "public" | "controller" | "server";
export type GameEventType =
  | "COMMAND_ACCEPTED" | "COMMAND_COMPLETED" | "MATCH_CREATED" | "PLAYER_JOINED"
  | "PHASE_CHANGED" | "PRIORITY_CHANGED" | "CARD_MOVED" | "ENERGY_CHANGED"
  | "BAKUGAN_OPEN_STATE_CHANGED" | "BAKUCORE_ATTACHMENT_CHANGED" | "BATCH_OBJECT_ADDED"
  | "BATCH_OBJECT_REMOVED" | "PENDING_DAMAGE_CHANGED" | "LOG_ENTRY_ADDED" | "GAME_ENDED"
  | "DEADLINE_RESOLVED";
export type UnsequencedGameEvent = {
  type: GameEventType;
  actorId: CommandActorId;
  visibility: EventVisibility;
  visibleTo?: string;
  payload: Record<string, unknown>;
};
export type GameEvent = UnsequencedGameEvent & {
  gameId: string;
  commandId: string;
  sequence: number;
  engineVersion: string;
  rulesVersion: string;
  createdAt: number;
};
export type CommandReceipt = {
  commandId: string;
  actorId: CommandActorId;
  expectedVersion: number;
  resultVersion: number;
  requestHash: string;
  issuedAt: number;
  eventSequenceStart: number;
  eventSequenceEnd: number;
};
export type EngineMetadata = {
  schemaVersion: typeof ENGINE_SCHEMA_VERSION;
  engineVersion: string;
  rulesVersion: string;
  nextEventSequence: number;
  lastCommandId?: string;
  phase: StructuredPhase;
  receipts: CommandReceipt[];
};
export type EngineBackedMatchState = MatchState & { [ENGINE_METADATA_KEY]?: EngineMetadata };
export type ReduceResult = {
  state: EngineBackedMatchState;
  events: GameEvent[];
  receipt?: CommandReceipt;
  duplicate: boolean;
  changed: boolean;
};
export type InitializeMatchOptions = {
  commandId: string;
  actorId: string;
  issuedAt: number;
  randomSeed: string;
  requestHash: string;
};
export class EngineCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineCommandError";
    this.code = code;
  }
}
export class EngineInvariantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineInvariantError";
    this.code = code;
  }
}
