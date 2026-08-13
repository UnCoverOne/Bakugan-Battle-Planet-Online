import type { MatchState, PlayerState } from "../game";
import type { GameCommand, GameVersionProfile } from "./types";
import type { StatePatchOperation } from "./state-patch";

export const REPLAY_SCHEMA_VERSION = 1 as const;

export type CompactCardInstance = {
  /** Physical instance ID used by commands and rules. */
  i: string;
  /** Immutable catalogue ID used to restore the card definition. */
  c: string;
  /** Turn this instance entered play, when applicable. */
  p?: number;
  /** Temporary owner-only Energy reveal deadline. */
  r?: number;
};

export type CompactCoreInstance = { i: string; c: string };

export type CompactBakuganInstance = {
  i: string;
  c: string;
  ci: string;
  o?: 1;
  h?: string[];
  e?: CompactCardInstance[];
  t?: number;
};

export type CompactPlayerState = {
  id: string;
  n: string;
  a?: string;
  /** Lobby deck format/name are mutable player state, not catalogue data. */
  lf?: "standard" | "singleton" | "competitive";
  ln?: string;
  b: CompactBakuganInstance[];
  c: CompactCoreInstance[];
  d: CompactCardInstance[];
  h: CompactCardInstance[];
  x?: CompactCardInstance[];
  e?: CompactCardInstance[];
  r?: CompactCardInstance[];
  en?: number;
  me?: number;
  rd?: 1;
  cn?: 0;
  ls?: number;
  et?: 1;
  cp?: number;
  fp?: PlayerState["factionsPlayedThisTurn"];
  rv?: string;
};

type ReplayableCommand = Exclude<GameCommand,
  { type: "JOIN_PLAYER" } | { type: "UPDATE_LOBBY_DECK" }
> | { type: "JOIN_PLAYER"; player: CompactPlayerState }
  | { type: "UPDATE_LOBBY_DECK"; player: CompactPlayerState };

export type CompactReplayCommand = {
  a: string;
  t: number;
  s: string;
  c: ReplayableCommand;
};

export type CompactReplayGenesis = {
  /** The non-player initial match state contains no duplicated catalogue data. */
  state: Omit<MatchState, "players">;
  players: CompactPlayerState[];
};

export type ReplayRecording = {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  genesis: CompactReplayGenesis;
  commands: CompactReplayCommand[];
  /** Deterministic top-level deltas for offline subsystems that predate command routing. */
  localTransitions?: Array<{
    /** Number of reducer commands recorded before this delta. */
    q: number;
    t: number;
    l: string;
    p: StatePatchOperation[];
  }>;
};

export type ReplayArchive = {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  replayId: string;
  capturedAt: number;
  startedAt: number;
  completedAt: number;
  finalVersion: number;
  finalStateHash: string;
  versions: GameVersionProfile;
  recording: ReplayRecording;
};

export type ReplayMarker = {
  index: number;
  at: number;
  type: "start" | "phase" | "card" | "roll" | "damage" | "game" | "result" | "command";
  label: string;
};

export type ReplayFrame = {
  index: number;
  at: number;
  commandType: "CREATE_MATCH" | GameCommand["type"];
  label: string;
  state: MatchState;
};

export type ReplayBundle = {
  archive: Omit<ReplayArchive, "recording">;
  perspectivePlayerId: string;
  frames: ReplayFrame[];
  markers: ReplayMarker[];
};

export type ReplayTransportStep = {
  index: number;
  at: number;
  commandType: ReplayFrame["commandType"];
  label: string;
  patch: StatePatchOperation[];
};

export type ReplayTransportBundle = {
  archive: Omit<ReplayArchive, "recording">;
  perspectivePlayerId: string;
  initialState: MatchState;
  steps: ReplayTransportStep[];
  markers: ReplayMarker[];
};
