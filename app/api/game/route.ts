import { normalizeMatchState, type MatchState } from "../../../lib/game";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { rankedSeries } from "../../../lib/ranked-lobby";
import { settleCompletedRankedState, persistRankedSettlementSnapshot } from "../../../lib/ranked-match-settlement";
import {
  apiActionToCommand,
  canonicalJson,
  createSeatStatePatch,
  engineDiagnosticContext,
  ensureEngineEventStore,
  findCommandReceipt,
  loadPersistedCommand,
  normalizeEngineState,
  persistTransition,
  projectEventStreamsForPlayer,
  projectEventsForPlayer,
  projectMatchForPlayer,
  recordEngineObservation,
  reduceMatch,
  transitionObservation,
  EngineCommandError,
  type ApiAction,
  type CommandEnvelope,
  type EngineBackedMatchState,
} from "../../../lib/engine";
import { resolveLobbyIdentities } from "../../../lib/lobby-identity-server";
import { managedIdentityOwnsSeat } from "../../../lib/lobby-series-access";
import { managedSeriesForCode, hydrateManagedPresence } from "../../../lib/lobby-series-access";
import { isInternalMatchRequest } from "../../../lib/internal-request";
import { ensureMatchSessionSchema } from "../../../lib/match-session-schema";
import {
  authenticateMatchSeat,
} from "../../../lib/match-seat-auth";
import { archiveCompletedMatch } from "../../../lib/replay-archive-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import {
  AuthorizationError,
  ConflictError,
  ServerError,
  ServiceUnavailableError,
  ValidationError,
  serverErrorResponse,
} from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

type Body = {
  action: string;
  commandId?: string;
  code?: string;
  playerId?: string;
  expectedVersion?: number;
  payload?: Record<string, unknown>;
};

type MatchRecord = {
  state: EngineBackedMatchState;
  previous: MatchState | null;
};

type PresenceRow = {
  player_id: string;
  last_seen: number;
  connected: number;
};

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store, max-age=0" },
});

async function getDatabase() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new ServiceUnavailableError(
      "The match service is temporarily unavailable.",
      "The DB binding was unavailable while processing a match command.",
    );
  }
  await ensureMatchSessionSchema(env.DB);
  await ensureEngineEventStore(env.DB);
  return env.DB;
}

function versionProfile(state: EngineBackedMatchState) {
  const metadata = state.__engine;
  return metadata ? {
    applicationVersion: metadata.applicationVersion,
    engineVersion: metadata.engineVersion,
    rulesVersion: metadata.rulesVersion,
    cardCatalogueVersion: metadata.cardCatalogueVersion,
    digitalAdaptationVersion: metadata.digitalAdaptationVersion,
    contentSchemaVersion: metadata.contentSchemaVersion,
  } : undefined;
}

function eventResponse(
  before: MatchState | null,
  state: EngineBackedMatchState,
  events: Parameters<typeof projectEventsForPlayer>[0],
  playerId: string,
) {
  const streams = projectEventStreamsForPlayer(events, playerId);
  return {
    accepted: true,
    newVersion: state.version,
    publicEvents: streams.publicEvents,
    privateEvents: streams.privateEvents,
    statePatch: createSeatStatePatch(before, state, playerId),
    versions: versionProfile(state),
    events: projectEventsForPlayer(events, playerId),
    state: projectMatchForPlayer(state, playerId),
  };
}

async function recordObservationSafely(observation: Parameters<typeof recordEngineObservation>[1]) {
  try {
    await recordEngineObservation(await getDatabase(), observation);
  } catch (error) {
    console.error(JSON.stringify({
      event: "engine_observation_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

function scheduleCompletedMatchArchive(database: D1Database, state: EngineBackedMatchState) {
  const task = archiveCompletedMatch(database, state).catch((error) => {
    console.error(JSON.stringify({
      event: "match_replay_archive_failed",
      code: state.code,
      replayId: state.id,
      message: error instanceof Error ? error.message : String(error),
    }));
    return false;
  });
  const context = getRequestExecutionContext();
  if (context) context.waitUntil(task);
  else void task;
}

async function publishMatchState(state: MatchState) {
  const { env } = await import("cloudflare:workers");
  if (!env.MATCHES) {
    throw new ServiceUnavailableError(
      "Live match updates are temporarily unavailable.",
      "The MATCHES Durable Object binding was unavailable.",
    );
  }
  const room = env.MATCHES.getByName(state.code);
  const response = await room.fetch("https://match.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new ServiceUnavailableError(
      "Live match updates are temporarily unavailable.",
      `Match coordinator rejected snapshot with HTTP ${response.status}.`,
    );
  }
}

const encoder = new TextEncoder();
const COMMAND_ID_HEADER = "x-command-id";
const ACTIONS = new Set([
  "get", "ready", "lobby-ready", "start-match",
  "ranked-ban", "ranked-select",
  "begin-placement", "place", "draw", "energize", "tap-energy", "select", "target", "roll", "reroll",
  "prepare-play", "play", "choice", "cancel-choice", "order-triggers", "pass", "complete-coin-flip", "flip-damage", "damage",
  "hand-limit", "concede", "next-turn", "ack-game-result", "undo",
]);

function parseBody(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("A JSON object is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) throw new ValidationError("A valid action is required.");
  if (body.code != null && (typeof body.code !== "string" || !/^[A-Z2-9]{6}$/i.test(body.code))) {
    throw new ValidationError("Room code is invalid.");
  }
  if (body.playerId != null && typeof body.playerId !== "string") throw new ValidationError("Player ID is invalid.");
  if (body.commandId != null && (typeof body.commandId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.commandId))) {
    throw new ValidationError("Command ID is invalid.");
  }
  if (body.expectedVersion != null && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) {
    throw new ValidationError("Expected version is invalid.");
  }
  if (body.payload != null && (typeof body.payload !== "object" || Array.isArray(body.payload))) {
    throw new ValidationError("Action payload is invalid.");
  }
  return body as Body;
}


function secureToken(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function commandIdentity(request: Request, body: Body, code: string, playerId: string, expectedVersion: number) {
  const requestHash = await digest(canonicalJson({
    code,
    playerId,
    expectedVersion,
    action: body.action,
    payload: body.payload ?? {},
  }));
  const supplied = body.commandId ?? request.headers.get(COMMAND_ID_HEADER);
  const commandId = supplied || `cmd-${requestHash}`;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(commandId)) throw new ValidationError("Command ID is invalid.");
  return { commandId, requestHash };
}

async function authenticateSeat(request: Request, code: string, playerId: string) {
  const database = await getDatabase();
  const seat=await authenticateMatchSeat(database,request,code,playerId);
  if (!seat) return false;
  const identities = await resolveLobbyIdentities(database, request);
  return Boolean(identities.primary && await managedIdentityOwnsSeat(database,code,playerId,identities.primary));

}

async function load(code: string): Promise<MatchRecord | null> {
  const database = await getDatabase();
  const row = await database.prepare("SELECT state_json, previous_state_json FROM matches WHERE code = ?")
    .bind(code)
    .first<{ state_json: string; previous_state_json: string | null }>();
  return row ? {
    state: normalizeEngineState(normalizeMatchState(JSON.parse(row.state_json) as MatchState)),
    previous: row.previous_state_json ? normalizeMatchState(JSON.parse(row.previous_state_json) as MatchState) : null,
  } : null;
}

async function touchPresence(code: string, playerId: string, now = Date.now()) {
  const database = await getDatabase();
  await database.prepare(
    "INSERT INTO match_presence (code, player_id, last_seen, connected) VALUES (?, ?, ?, 1) ON CONFLICT(code, player_id) DO UPDATE SET last_seen = excluded.last_seen, connected = 1",
  ).bind(code, playerId, now).run();
}

async function hydratePresence(state: MatchState) {
  const database = await getDatabase();
  if (await hydrateManagedPresence(database, state)) return state;
  await database.batch(state.players.map((player) => database.prepare(
    "INSERT OR IGNORE INTO match_presence (code, player_id, last_seen, connected) VALUES (?, ?, ?, ?)",
  ).bind(state.code, player.id, player.lastSeen, player.connected ? 1 : 0)));
  const response = await database.prepare(
    "SELECT player_id, last_seen, connected FROM match_presence WHERE code = ?",
  ).bind(state.code).all<PresenceRow>();
  const rows = new Map((response.results ?? []).map((row) => [row.player_id, row]));
  for (const player of state.players) {
    const presence = rows.get(player.id);
    if (!presence) continue;
    player.lastSeen = presence.last_seen;
    player.connected = Boolean(presence.connected);
  }
  return state;
}

async function latestConflict(code: string, playerId: string, correlationId: string, message = "Match state changed. Resynchronising.") {
  const latest = await load(code);
  if (latest) await hydratePresence(latest.state);
  return json({
    error: message,
    code: "CONFLICT_ERROR",
    correlationId,
    state: latest ? projectMatchForPlayer(latest.state, playerId) : undefined,
    newVersion: latest?.state.version,
  }, latest ? 409 : 404);
}

async function duplicateCommandResponse(
  database: D1Database,
  state: EngineBackedMatchState,
  playerId: string,
  commandId: string,
  requestHash: string,
  correlationId: string,
) {
  const embedded = findCommandReceipt(state, commandId);
  const persisted = embedded ? null : await loadPersistedCommand(database, state.code, commandId);
  const receipt = embedded ?? (persisted ? {
    commandId: persisted.command_id,
    actorId: persisted.actor_id,
    expectedVersion: persisted.expected_version,
    resultVersion: persisted.result_version,
    requestHash: persisted.request_hash,
    issuedAt: persisted.created_at,
    eventSequenceStart: persisted.event_sequence_start,
    eventSequenceEnd: persisted.event_sequence_end,
  } : undefined);
  if (!receipt) return null;
  if (receipt.requestHash !== requestHash) throw new ConflictError("This command ID was already used for a different request.");
  return json({
    ...eventResponse(state, state, [], playerId),
    commandId,
    duplicate: true,
    previousVersion: receipt.expectedVersion,
    newVersion: state.version,
    commandResultVersion: receipt.resultVersion,
    statePatch: [],
    correlationId,
  });
}

async function applyExpiredDeadline(state: EngineBackedMatchState, previous: MatchState | null, coordinated: boolean) {
  const now = Date.now();
  const commandId = `deadline:${state.id}:${state.version}:${state.deadline}`;
  const requestHash = await digest(commandId);
  const envelope: CommandEnvelope = {
    commandId,
    gameId: state.id,
    actorId: "system",
    expectedVersion: state.version,
    issuedAt: now,
    randomSeed: secureToken(32),
    requestHash,
    command: { type: "RESOLVE_DEADLINE" },
  };
  const result = reduceMatch(state, envelope);
  if (!result.changed || !result.receipt) return { state, previous };
  const database = await getDatabase();
  const saved = await persistTransition(database, {
    code: state.code,
    next: result.state,
    previous: state,
    expectedVersion: state.version,
    events: result.events,
    receipt: result.receipt,
  });
  if (!saved) return null;
  scheduleCompletedMatchArchive(database, result.state);
  if (!coordinated) await publishMatchState(result.state);
  return { state: result.state, previous: state };
}

function classifyMatchError(error: unknown) {
  if (error instanceof ServerError) return error;
  if (error instanceof EngineCommandError) {
    if (["VERSION_CONFLICT", "COMMAND_ID_REUSED", "ROOM_FULL"].includes(error.code)) {
      return new ConflictError(error.message);
    }
    if (["UNKNOWN_ACTOR", "WRONG_GAME"].includes(error.code)) {
      return new AuthorizationError("The match command is not allowed for this seat.", error.message);
    }
    return new ValidationError(error.message);
  }
  return error;
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const coordinated = isInternalMatchRequest(request);
  let diagnosticState: EngineBackedMatchState | undefined;
  let diagnosticEnvelope: CommandEnvelope | undefined;
  let action = "unknown";
  try {
    assertSameOrigin(request);
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      throw new ValidationError("Match request is not valid JSON.");
    }
    const body = parseBody(parsed);
    action = body.action;
    await enforceD1RateLimit(await getDatabase(), `${requestClientKey(request)}:game`, 180, 60_000);
    if (!body.code) throw new ValidationError("Room code required.");
    const code = body.code.toUpperCase();
    const managed = await managedSeriesForCode(await getDatabase(), code);
    if (!managed) throw new ConflictError("Open Play to recover your lobby.");
    let record = await load(code);
    if (!record) return json({ error: "Match room not found.", code: "VALIDATION_ERROR", correlationId }, 404);

    if (!body.playerId || !record.state.players.some((player) => player.id === body.playerId)) {
      throw new AuthorizationError("Unknown player.");
    }
    if (!await authenticateSeat(request, code, body.playerId)) throw new AuthorizationError("Invalid match seat capability.");
    await touchPresence(code, body.playerId);
    await hydratePresence(record.state);

    const deadlineResult = await applyExpiredDeadline(record.state, record.previous, coordinated);
    if (!deadlineResult) return latestConflict(code, body.playerId ?? "", correlationId);
    record = deadlineResult;
    const state = record.state;
    diagnosticState = state;

    if (await settleCompletedRankedState(await getDatabase(), state)) {
      await persistRankedSettlementSnapshot(await getDatabase(), state);
    }

    if (body.action === "get") {
      return json({
        accepted: true,
        snapshot: true,
        newVersion: state.version,
        versions: versionProfile(state),
        state: projectMatchForPlayer(state, body.playerId ?? ""),
        publicEvents: [],
        privateEvents: [],
        statePatch: [],
        correlationId,
      });
    }

    const expectedVersion = body.expectedVersion ?? state.version;
    const identity = await commandIdentity(request, body, code, body.playerId, expectedVersion);
    const database = await getDatabase();
    const duplicate = await duplicateCommandResponse(database, state, body.playerId, identity.commandId, identity.requestHash, correlationId);
    if (duplicate) return duplicate;
    if (expectedVersion !== state.version) return latestConflict(code, body.playerId, correlationId);

    let payload = body.payload ?? {};
    if ((body.action === "ranked-ban" || body.action === "ranked-select") && !rankedSeries(state)) {
      throw new ValidationError("This action is only available in Ranked lobbies.");
    }
    if (body.action === "ranked-select") {
      payload = { ...payload, restrictions: rankedSeries(state)?.restrictions ?? [] };
    }
    const envelope: CommandEnvelope = {
      commandId: identity.commandId,
      gameId: state.id,
      actorId: body.playerId,
      expectedVersion,
      issuedAt: Date.now(),
      randomSeed: secureToken(32),
      requestHash: identity.requestHash,
      command: apiActionToCommand(body.action as ApiAction, payload),
    };
    diagnosticEnvelope = envelope;
    const before = structuredClone(state) as EngineBackedMatchState;
    const startedAt = performance.now();
    const result = reduceMatch(state, envelope);
    const durationMs = performance.now() - startedAt;
    if (!result.changed || !result.receipt) {
      throw new ServiceUnavailableError("The match command could not be completed.", "The command did not produce a persistent transition.");
    }
    const previous = before;
    if (!await persistTransition(database, {
      code,
      next: result.state,
      previous,
      expectedVersion,
      events: result.events,
      receipt: result.receipt,
    })) return latestConflict(code, body.playerId, correlationId);
    if (await settleCompletedRankedState(database, result.state)) {
      await persistRankedSettlementSnapshot(database, result.state);
    }
    scheduleCompletedMatchArchive(database, result.state);
    if (!coordinated) await publishMatchState(result.state);
    await recordObservationSafely(transitionObservation(before, result.state, envelope, result.events, durationMs, correlationId));
    console.info(JSON.stringify({
      event: "match_action",
      correlationId,
      commandId: identity.commandId,
      code,
      action: body.action,
      playerId: body.playerId,
      previousVersion: expectedVersion,
      version: result.state.version,
    }));
    return json({
      ...eventResponse(before, result.state, result.events, body.playerId),
      commandId: identity.commandId,
      duplicate: false,
      previousVersion: expectedVersion,
      correlationId,
    });
  } catch (rawError) {
    const error = classifyMatchError(rawError);
    const internalMessage = rawError instanceof Error ? rawError.message : "Match command failed.";
    const context = engineDiagnosticContext(diagnosticState, diagnosticEnvelope, correlationId);
    await recordObservationSafely({
      kind: /version/i.test(internalMessage) ? "version-conflict" : /unsupported|unreviewed/i.test(internalMessage) ? "unsupported-rule" : "command-rejected",
      metric: "command",
      value: 1,
      context,
      details: { message: internalMessage },
      createdAt: Date.now(),
    });
    return serverErrorResponse(error, correlationId, "Match command failed.", {
      route: "/api/game",
      method: "POST",
      action,
      engine: context,
    });
  }
}
