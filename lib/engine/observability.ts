import type { MatchState } from "../game";
import type { CommandEnvelope, EngineBackedMatchState, GameEvent } from "./types";

export type EngineObservationKind =
  | "command-accepted"
  | "command-rejected"
  | "version-conflict"
  | "deadline-resolved"
  | "stuck-phase"
  | "unsupported-rule"
  | "replacement-loop"
  | "engine-fault"
  | "match-ended";

export type EngineDiagnosticContext = {
  correlationId?: string;
  gameId?: string;
  commandId?: string;
  eventSequence?: number;
  engineVersion?: string;
  rulesVersion?: string;
  cardCatalogueVersion?: string;
  digitalAdaptationVersion?: string;
  phase?: MatchState["phase"];
  activeEffectId?: string;
  sourceCardDefinitionId?: string;
};

export type EngineObservation = {
  kind: EngineObservationKind;
  metric: string;
  value: number;
  durationMs?: number;
  context: EngineDiagnosticContext;
  details?: Record<string, unknown>;
  createdAt: number;
};

export function engineDiagnosticContext(
  state?: EngineBackedMatchState,
  envelope?: CommandEnvelope,
  correlationId?: string,
): EngineDiagnosticContext {
  const metadata = state?.__engine;
  const active = state?.batch.at(-1);
  return {
    correlationId,
    gameId: state?.id ?? envelope?.gameId,
    commandId: envelope?.commandId,
    eventSequence: metadata ? Math.max(0, metadata.nextEventSequence - 1) : undefined,
    engineVersion: metadata?.engineVersion,
    rulesVersion: metadata?.rulesVersion,
    cardCatalogueVersion: metadata?.cardCatalogueVersion,
    digitalAdaptationVersion: metadata?.digitalAdaptationVersion,
    phase: state?.phase,
    activeEffectId: active?.id,
    sourceCardDefinitionId: active?.card.catalogId,
  };
}

export function transitionObservation(
  before: EngineBackedMatchState,
  after: EngineBackedMatchState,
  envelope: CommandEnvelope,
  events: readonly GameEvent[],
  durationMs: number,
  correlationId?: string,
): EngineObservation {
  const effectsResolved = events.filter((event) => event.type === "BATCH_OBJECT_REMOVED").length;
  const triggerDepth = after.batch.filter((object) => object.kind === "trigger").length;
  const kind: EngineObservationKind = after.winner ? "match-ended" : envelope.command.type === "RESOLVE_DEADLINE" ? "deadline-resolved" : "command-accepted";
  return {
    kind,
    metric: "command",
    value: 1,
    durationMs,
    context: engineDiagnosticContext(after, envelope, correlationId),
    details: {
      commandType: envelope.command.type,
      previousVersion: before.version,
      newVersion: after.version,
      effectsResolved,
      triggerChainDepth: triggerDepth,
      eventCount: events.length,
      pendingChoiceType: after.pendingChoice?.kind,
      terminationReason: after.resultReason || undefined,
    },
    createdAt: envelope.issuedAt,
  };
}
