import type { MatchState } from "./game";

export type TrainingAiTraceStage =
  | "scheduled" | "request" | "worker-response" | "worker-error"
  | "decision" | "dispatch-success" | "dispatch-error" | "stale-response";

export type TrainingAiTraceEvent = {
  at: string;
  stage: TrainingAiTraceStage;
  matchVersion: number;
  phase: string;
  priority: string;
  batchSize: number;
  pendingChoiceId: string | null;
  detail?: string;
  command?: string;
  transport?: string;
  elapsedMs?: number;
  nextVersion?: number;
};

const MAX_EVENTS = 150;
let activeMatchId = "";
let activeCode = "";
let events: TrainingAiTraceEvent[] = [];
let dropped = 0;

/** In-memory only: no storage, console IO, state cloning or per-decision serialization. */
export function recordTrainingAiTrace(
  match: MatchState,
  stage: TrainingAiTraceStage,
  extra: Pick<TrainingAiTraceEvent, "detail" | "command" | "transport" | "elapsedMs" | "nextVersion"> = {},
) {
  if (activeMatchId !== match.id) {
    activeMatchId = match.id;
    activeCode = match.code;
    events = [];
    dropped = 0;
  }
  if (events.length >= MAX_EVENTS) {
    events.shift();
    dropped += 1;
  }
  events.push({
    at: new Date().toISOString(),
    stage,
    matchVersion: match.version,
    phase: match.phase,
    priority: match.priority,
    batchSize: match.batch.length,
    pendingChoiceId: match.pendingChoice?.id ?? null,
    ...extra,
  });
}

export function trainingAiTraceForExport(matchId: string) {
  return {
    schemaVersion: 1,
    source: "client-memory" as const,
    matchId,
    matchCode: activeMatchId === matchId ? activeCode : null,
    capacity: MAX_EVENTS,
    droppedEvents: activeMatchId === matchId ? dropped : 0,
    events: activeMatchId === matchId ? events.map((event) => ({ ...event })) : [],
  };
}
