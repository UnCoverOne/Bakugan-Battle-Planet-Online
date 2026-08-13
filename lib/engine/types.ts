import type { CardChoices, MatchState, PlayerState } from "../game";
import type { DeckRestriction } from "../deck-validation";
import { APPLICATION_VERSION, CARD_CATALOGUE_VERSION, CONTENT_SCHEMA_VERSION, DIGITAL_ADAPTATION_VERSION, GAME_ENGINE_VERSION, RULES_PROFILE_VERSION, type GameVersionProfile } from "../content/versions";

export const ENGINE_SCHEMA_VERSION = 2 as const;
export const ENGINE_VERSION = GAME_ENGINE_VERSION;
export const RULES_VERSION = RULES_PROFILE_VERSION;
export { APPLICATION_VERSION, CARD_CATALOGUE_VERSION, CONTENT_SCHEMA_VERSION, DIGITAL_ADAPTATION_VERSION };
export type { GameVersionProfile };
export const ENGINE_METADATA_KEY = "__engine" as const;
export const MAX_EMBEDDED_COMMAND_RECEIPTS = 128;

export type CommandActorId = string | "system";
export type GameCommand =
  | { type: "SET_READY" }
  | { type: "SET_LOBBY_READY"; ready: boolean }
  | { type: "START_MATCH" }
  | { type: "UPDATE_LOBBY_SETTINGS"; rulesFormat: "standard" | "singleton" | "competitive"; meta: "battle-brawlers" }
  | { type: "UPDATE_LOBBY_DECK"; player: PlayerState }
  | { type: "RANKED_BAN_DECK"; deckId: string }
  | { type: "RANKED_SELECT_DECK"; deckId: string; restrictions: DeckRestriction[] }
  | { type: "BEGIN_CORE_PLACEMENT" }
  | { type: "PLACE_CORE"; coreId: string; cell: string }
  | { type: "DRAW_TURN_CARD" }
  | { type: "ENERGIZE"; cardId?: string }
  | { type: "TAP_ENERGY_CARD"; cardId: string }
  | { type: "SELECT_BAKUGAN"; bakuganId: string }
  | { type: "SELECT_ROLL_TARGET"; cell: string }
  | { type: "CONFIRM_ROLL" }
  | { type: "ACTIVATE_REROLL" }
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
  | { type: "CONCEDE"; reason?: "disconnect" }
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
  | { area: "roll"; step: "selection" | "pre-roll-priority" | "targeting-and-rolling" | "reroll"; legacy: MatchState["phase"] }
  | { area: "brawl"; step: "power" | "victor" | "damage" | "post-damage" | "retract"; legacy: MatchState["phase"] }
  | { area: "end"; step: "play" | "charge" | "reset" | "hand-limit"; legacy: MatchState["phase"] }
  | { area: "result"; step: "match-result"; legacy: MatchState["phase"] };
export type EventVisibility = "public" | "controller" | "server";
export type GameEventType =
  | "COMMAND_ACCEPTED" | "COMMAND_COMPLETED" | "MATCH_CREATED" | "PLAYER_JOINED"
  | "PHASE_CHANGED" | "PRIORITY_CHANGED" | "CARD_MOVED" | "ENERGY_CHANGED"
  | "BAKUGAN_OPEN_STATE_CHANGED" | "BAKUCORE_ATTACHMENT_CHANGED" | "BATCH_OBJECT_ADDED"
  | "BATCH_OBJECT_REMOVED" | "PENDING_DAMAGE_CHANGED" | "LOG_ENTRY_ADDED" | "GAME_ENDED"
  | "DEADLINE_RESOLVED" | "ENGINE_FAULT";
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
  cardCatalogueVersion: string;
  digitalAdaptationVersion: string;
  contentSchemaVersion: number;
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
export type EngineFault = { code: string; message: string; metric?: string; limit?: number; actual?: number; commandId: string; phase: MatchState["phase"]; createdAt: number; suspended: true };
export type OriginalDeckManifest = {
  playerId: string;
  deckName: string;
  cardCatalogIds: string[];
  bakuganCatalogIds: string[];
  coreCatalogIds: string[];
};
export type EngineMetadata = {
  schemaVersion: typeof ENGINE_SCHEMA_VERSION;
  applicationVersion: string;
  engineVersion: string;
  rulesVersion: string;
  cardCatalogueVersion: string;
  digitalAdaptationVersion: string;
  contentSchemaVersion: number;
  nextEventSequence: number;
  lastCommandId?: string;
  phase: StructuredPhase;
  receipts: CommandReceipt[];
  originalDeckManifests?: Record<string, OriginalDeckManifest>;
  fault?: EngineFault;
  runtimeBudget?: { triggerChainDepth: number; effectSteps: number; replacementIterations: number; pendingChoices: number; physicalRollAttempts: number };
  timeoutStrikes?: Record<string, { decision: number; connectionGrace: number }>;
};
export type EngineBackedMatchState = MatchState & { [ENGINE_METADATA_KEY]?: EngineMetadata };
export type ReduceResult = {
  state: EngineBackedMatchState;
  events: GameEvent[];
  receipt?: CommandReceipt;
  duplicate: boolean;
  changed: boolean;
  faulted?: boolean;
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
