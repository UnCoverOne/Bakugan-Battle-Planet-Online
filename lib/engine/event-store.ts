import type { MatchState } from "../game";
import type { EngineObservation } from "./observability";
import { ENGINE_METADATA_KEY, type CommandReceipt, type EngineBackedMatchState, type GameEvent } from "./types";

let schemaReady: Promise<void> | undefined;

export type PersistedCommand = {
  command_id: string;
  actor_id: string;
  expected_version: number;
  result_version: number;
  request_hash: string;
  event_sequence_start: number;
  event_sequence_end: number;
  created_at: number;
};

export type PersistedSeat = {
  playerId: string;
  capabilityHash: string;
  controllerId: string;
  createdAt: number;
};

function engineSchemaStatements(database: D1Database) {
  return [
    database.prepare(`CREATE TABLE IF NOT EXISTS match_events (
      code text NOT NULL,
      sequence integer NOT NULL,
      command_id text NOT NULL,
      event_type text NOT NULL,
      actor_id text NOT NULL,
      visibility text NOT NULL,
      visible_to text,
      payload_json text NOT NULL,
      engine_version text NOT NULL,
      rules_version text NOT NULL,
      created_at integer NOT NULL,
      PRIMARY KEY (code, sequence)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS match_events_command_idx ON match_events (code, command_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS match_events_type_sequence_idx ON match_events (code, event_type, sequence)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS match_commands (
      code text NOT NULL,
      command_id text NOT NULL,
      actor_id text NOT NULL,
      expected_version integer NOT NULL,
      result_version integer NOT NULL,
      request_hash text NOT NULL,
      event_sequence_start integer NOT NULL,
      event_sequence_end integer NOT NULL,
      created_at integer NOT NULL,
      PRIMARY KEY (code, command_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS match_commands_result_version_idx ON match_commands (code, result_version)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS engine_observations (
      id integer PRIMARY KEY AUTOINCREMENT,
      code text,
      command_id text,
      kind text NOT NULL,
      metric text NOT NULL,
      value real NOT NULL,
      duration_ms real,
      context_json text NOT NULL,
      details_json text,
      created_at integer NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS engine_observations_code_created_idx ON engine_observations (code, created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS engine_observations_kind_created_idx ON engine_observations (kind, created_at)"),
  ];
}

export async function ensureEngineEventStore(database: D1Database) {
  if (!schemaReady) {
    schemaReady = database.batch(engineSchemaStatements(database))
      .then(() => undefined)
      .catch((error) => {
        schemaReady = undefined;
        throw error;
      });
  }
  await schemaReady;
}

export async function loadPersistedCommand(database: D1Database, code: string, commandId: string) {
  await ensureEngineEventStore(database);
  return database.prepare(`SELECT command_id, actor_id, expected_version, result_version, request_hash,
    event_sequence_start, event_sequence_end, created_at
    FROM match_commands WHERE code = ? AND command_id = ?`)
    .bind(code, commandId)
    .first<PersistedCommand>();
}

function trimLegacyLog(state: MatchState) {
  const chat = state.log.filter((entry) => String(entry.kind) === "chat").slice(-100);
  const events = state.log.filter((entry) => String(entry.kind) !== "chat").slice(-400);
  const retained = new Set([...chat, ...events].map((entry) => entry.id));
  state.log = state.log.filter((entry) => retained.has(entry.id));
}

function eventInsert(database: D1Database, code: string, event: GameEvent, commandId: string) {
  return database.prepare(`INSERT OR IGNORE INTO match_events (
    code, sequence, command_id, event_type, actor_id, visibility, visible_to,
    payload_json, engine_version, rules_version, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM matches
    WHERE code = ? AND json_extract(state_json, '$.${ENGINE_METADATA_KEY}.lastCommandId') = ?
  )`).bind(
    code,
    event.sequence,
    event.commandId,
    event.type,
    String(event.actorId),
    event.visibility,
    event.visibleTo ?? null,
    JSON.stringify({ ...event.payload, __versions: { engineVersion: event.engineVersion, rulesVersion: event.rulesVersion, cardCatalogueVersion: event.cardCatalogueVersion, digitalAdaptationVersion: event.digitalAdaptationVersion, contentSchemaVersion: event.contentSchemaVersion } }),
    event.engineVersion,
    event.rulesVersion,
    event.createdAt,
    code,
    commandId,
  );
}

function receiptInsert(database: D1Database, code: string, receipt: CommandReceipt) {
  return database.prepare(`INSERT OR IGNORE INTO match_commands (
    code, command_id, actor_id, expected_version, result_version, request_hash,
    event_sequence_start, event_sequence_end, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM matches
    WHERE code = ? AND json_extract(state_json, '$.${ENGINE_METADATA_KEY}.lastCommandId') = ?
  )`).bind(
    code,
    receipt.commandId,
    String(receipt.actorId),
    receipt.expectedVersion,
    receipt.resultVersion,
    receipt.requestHash,
    receipt.eventSequenceStart,
    receipt.eventSequenceEnd,
    receipt.issuedAt,
    code,
    receipt.commandId,
  );
}

function seatInsert(database: D1Database, code: string, commandId: string, seat: PersistedSeat) {
  return database.prepare(`INSERT INTO match_seats (
      code, player_id, capability_hash, capability_version, controller_id, claimed_at, created_at
    )
    SELECT ?, ?, ?, 1, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM matches
      WHERE code = ? AND json_extract(state_json, '$.${ENGINE_METADATA_KEY}.lastCommandId') = ?
    )`).bind(
      code,
      seat.playerId,
      seat.capabilityHash,
      seat.controllerId,
      seat.createdAt,
      seat.createdAt,
      code,
      commandId,
    );
}

export async function persistInitialMatch(
  database: D1Database,
  state: EngineBackedMatchState,
  events: readonly GameEvent[],
  receipt: CommandReceipt,
  seat?: PersistedSeat,
) {
  await ensureEngineEventStore(database);
  trimLegacyLog(state);
  const statements = [
    database.prepare("INSERT OR IGNORE INTO matches (code, state_json, previous_state_json, updated_at) VALUES (?, ?, NULL, ?)")
      .bind(state.code, JSON.stringify(state), receipt.issuedAt),
    ...events.map((event) => eventInsert(database, state.code, event, receipt.commandId)),
    receiptInsert(database, state.code, receipt),
    database.prepare(`INSERT OR REPLACE INTO match_snapshots (code, version, state_json, created_at)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM matches
        WHERE code = ? AND json_extract(state_json, '$.${ENGINE_METADATA_KEY}.lastCommandId') = ?
      )`).bind(state.code, state.version, JSON.stringify(state), receipt.issuedAt, state.code, receipt.commandId),
    ...(seat ? [seatInsert(database, state.code, receipt.commandId, seat)] : []),
  ];
  const results = await database.batch(statements);
  return Number(results[0]?.meta?.changes ?? 0) > 0;
}

export type PersistTransitionOptions = {
  code: string;
  next: EngineBackedMatchState;
  previous: MatchState | null;
  expectedVersion: number;
  events: readonly GameEvent[];
  receipt: CommandReceipt;
  seat?: PersistedSeat;
};

export async function persistTransition(database: D1Database, options: PersistTransitionOptions) {
  await ensureEngineEventStore(database);
  trimLegacyLog(options.next);
  const statements = [
    database.prepare(`UPDATE matches
      SET state_json = ?, previous_state_json = ?, updated_at = ?
      WHERE code = ? AND CAST(json_extract(state_json, '$.version') AS INTEGER) = ?`)
      .bind(
        JSON.stringify(options.next),
        options.previous ? JSON.stringify(options.previous) : null,
        options.receipt.issuedAt,
        options.code,
        options.expectedVersion,
      ),
    ...options.events.map((event) => eventInsert(database, options.code, event, options.receipt.commandId)),
    receiptInsert(database, options.code, options.receipt),
    ...(options.seat ? [seatInsert(database, options.code, options.receipt.commandId, options.seat)] : []),
  ];

  const enteredGameplay = options.previous?.phase === "lobby" && options.next.phase !== "lobby";
  if (enteredGameplay || options.next.version % 5 === 0 || options.next.phase === "result") {
    statements.push(database.prepare(`INSERT OR REPLACE INTO match_snapshots (code, version, state_json, created_at)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM matches
        WHERE code = ? AND json_extract(state_json, '$.${ENGINE_METADATA_KEY}.lastCommandId') = ?
      )`).bind(options.code, options.next.version, JSON.stringify(options.next), options.receipt.issuedAt, options.code, options.receipt.commandId));
  }

  const results = await database.batch(statements);
  return Number(results[0]?.meta?.changes ?? 0) > 0;
}

export async function recordEngineObservation(database: D1Database, observation: EngineObservation) {
  await ensureEngineEventStore(database);
  await database.prepare(`INSERT INTO engine_observations (code, command_id, kind, metric, value, duration_ms, context_json, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(observation.context.gameId ?? null, observation.context.commandId ?? null, observation.kind, observation.metric, observation.value, observation.durationMs ?? null, JSON.stringify(observation.context), observation.details ? JSON.stringify(observation.details) : null, observation.createdAt)
    .run();
}
