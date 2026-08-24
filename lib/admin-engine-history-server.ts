import type { AccountDatabase } from "./account-server";
import { ensureEngineEventStore } from "./engine/event-store";

type MatchRow = {
  state_json: string;
  previous_state_json: string | null;
  updated_at: number;
};

type CommandRow = {
  command_id: string;
  actor_id: string;
  expected_version: number;
  result_version: number;
  request_hash: string;
  event_sequence_start: number;
  event_sequence_end: number;
  created_at: number;
};

type EventRow = {
  sequence: number;
  command_id: string;
  event_type: string;
  actor_id: string;
  visibility: string;
  visible_to: string | null;
  payload_json: string;
  engine_version: string;
  rules_version: string;
  created_at: number;
};

type ObservationRow = {
  id: number;
  code: string | null;
  command_id: string | null;
  kind: string;
  metric: string;
  value: number;
  duration_ms: number | null;
  context_json: string;
  details_json: string | null;
  created_at: number;
};

type SnapshotRow = {
  version: number;
  state_json: string;
  created_at: number;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Administrator diagnostic export of the authoritative engine record.
 * This deliberately reads the server-only event stream rather than the
 * projected MatchState.log, which is bounded and visibility-filtered.
 */
export async function loadAdministratorMatchEngineHistory(
  database: AccountDatabase,
  code: string,
  administratorId: string,
  exportedAt = Date.now(),
) {
  await ensureEngineEventStore(database);
  const match = await database.prepare(
    "SELECT state_json, previous_state_json, updated_at FROM matches WHERE code = ?",
  ).bind(code).first<MatchRow>();
  if (!match) return null;

  const currentState = parseJson<Record<string, unknown> | null>(match.state_json, null);
  const previousState = parseJson<Record<string, unknown> | null>(match.previous_state_json, null);
  const matchId = typeof currentState?.id === "string" ? currentState.id : code;

  const [commandResult, eventResult, observationResult, snapshotResult] = await Promise.all([
    database.prepare(`SELECT command_id, actor_id, expected_version, result_version, request_hash,
      event_sequence_start, event_sequence_end, created_at
      FROM match_commands WHERE code = ? ORDER BY result_version, created_at, command_id`)
      .bind(code).all<CommandRow>(),
    database.prepare(`SELECT sequence, command_id, event_type, actor_id, visibility, visible_to,
      payload_json, engine_version, rules_version, created_at
      FROM match_events WHERE code = ? ORDER BY sequence`)
      .bind(code).all<EventRow>(),
    database.prepare(`SELECT id, code, command_id, kind, metric, value, duration_ms,
      context_json, details_json, created_at
      FROM engine_observations WHERE code = ? OR code = ? ORDER BY created_at, id`)
      .bind(code, matchId).all<ObservationRow>(),
    database.prepare(`SELECT version, state_json, created_at
      FROM match_snapshots WHERE code = ? ORDER BY version`)
      .bind(code).all<SnapshotRow>(),
  ]);

  return {
    format: "bakugan-engine-history" as const,
    schemaVersion: 1 as const,
    source: "online" as const,
    exportedAt,
    exportedByAdministratorId: administratorId,
    match: {
      id: matchId,
      code,
      updatedAt: match.updated_at,
      currentState,
      previousState,
    },
    commands: (commandResult.results ?? []).map((row) => ({
      commandId: row.command_id,
      actorId: row.actor_id,
      expectedVersion: row.expected_version,
      resultVersion: row.result_version,
      requestHash: row.request_hash,
      eventSequenceStart: row.event_sequence_start,
      eventSequenceEnd: row.event_sequence_end,
      createdAt: row.created_at,
    })),
    events: (eventResult.results ?? []).map((row) => ({
      sequence: row.sequence,
      commandId: row.command_id,
      type: row.event_type,
      actorId: row.actor_id,
      visibility: row.visibility,
      visibleTo: row.visible_to,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
      engineVersion: row.engine_version,
      rulesVersion: row.rules_version,
      createdAt: row.created_at,
    })),
    observations: (observationResult.results ?? []).map((row) => ({
      id: row.id,
      storageKey: row.code,
      commandId: row.command_id,
      kind: row.kind,
      metric: row.metric,
      value: row.value,
      durationMs: row.duration_ms,
      context: parseJson<Record<string, unknown>>(row.context_json, {}),
      details: parseJson<Record<string, unknown> | null>(row.details_json, null),
      createdAt: row.created_at,
    })),
    snapshots: (snapshotResult.results ?? []).map((row) => ({
      version: row.version,
      createdAt: row.created_at,
      state: parseJson<Record<string, unknown> | null>(row.state_json, null),
    })),
  };
}
