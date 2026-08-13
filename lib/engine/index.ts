export { apiActionToCommand, canonicalJson, type ApiAction } from "./commands";
export {
  ensureEngineEventStore,
  loadPersistedCommand,
  persistInitialMatch,
  persistTransition,
  recordEngineObservation,
  type PersistedCommand,
} from "./event-store";
export {
  ensureEngineMetadata,
  findCommandReceipt,
  normalizeEngineState,
} from "./events";
export { structuredPhaseFor } from "./phase-machine";
export { isPlayPipelineCommand, playContextFor, type PlayContext } from "./play-pipeline";
export { projectEventStreamsForPlayer, projectEventsForPlayer, projectMatchForPlayer, type ProjectedEventStreams, type PublicGameEvent } from "./projection";
export { applyStatePatch, createSeatStatePatch, type StatePatchOperation } from "./state-patch";
export { replayCommands, replayForPlayer, type ReplayResult } from "./replay";
export { archiveReplay, archiveReplayRecording, captureReplayGenesis, compactReplayCommand, createReplayRecording, replayStateHash } from "./replay-codec";
export { buildReplayFrames, buildProjectedReplayBundle, decodeReplayTransport, encodeReplayTransport } from "./replay-playback";
export type { ReplayArchive, ReplayBundle, ReplayFrame, ReplayMarker, ReplayTransportBundle } from "./replay-types";
export { engineDiagnosticContext, transitionObservation, type EngineDiagnosticContext, type EngineObservation, type EngineObservationKind } from "./observability";
export { initializeMatch, reduceMatch } from "./reducer";
export { SeededRandomSource, withDeterministicRuntime, type RandomSource } from "./runtime";
export {
  ENGINE_METADATA_KEY,
  ENGINE_SCHEMA_VERSION,
  ENGINE_VERSION,
  RULES_VERSION,
  APPLICATION_VERSION,
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  EngineCommandError,
  EngineInvariantError,
  type CommandEnvelope,
  type CommandReceipt,
  type EngineBackedMatchState,
  type EngineMetadata,
  type EngineFault,
  type GameVersionProfile,
  type GameCommand,
  type GameEvent,
  type ReduceResult,
  type StructuredPhase,
} from "./types";
