import { normalizeMatchState, type MatchState } from "../../../lib/game";
import { makeCanonicalPlayer, type CanonicalPlayerSelection } from "../../../lib/data";
import { applyDatabaseCardOverrides } from "../../../lib/administration-server";
import {
  apiActionToCommand,
  canonicalJson,
  createSeatStatePatch,
  engineDiagnosticContext,
  ensureEngineEventStore,
  findCommandReceipt,
  initializeMatch,
  loadPersistedCommand,
  normalizeEngineState,
  persistInitialMatch,
  persistTransition,
  projectEventStreamsForPlayer,
  projectEventsForPlayer,
  projectMatchForPlayer,
  recordEngineObservation,
  reduceMatch,
  transitionObservation,
  type ApiAction,
  type CommandEnvelope,
  type EngineBackedMatchState,
} from "../../../lib/engine";
import { assertSameOrigin, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

type Body = {
  action: string;
  commandId?: string;
  code?: string;
  playerId?: string;
  expectedVersion?: number;
  format?: "bo1" | "bo3";
  selection?: CanonicalPlayerSelection;
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
  if (!env.DB) throw new Error("The match database is unavailable.");
  await ensureEngineEventStore(env.DB);
  return env.DB;
}

function versionProfile(state: EngineBackedMatchState) {
  const metadata = state.__engine;
  return metadata ? { applicationVersion: metadata.applicationVersion, engineVersion: metadata.engineVersion, rulesVersion: metadata.rulesVersion, cardCatalogueVersion: metadata.cardCatalogueVersion, digitalAdaptationVersion: metadata.digitalAdaptationVersion, contentSchemaVersion: metadata.contentSchemaVersion } : undefined;
}

function eventResponse(before: MatchState | null, state: EngineBackedMatchState, events: Parameters<typeof projectEventsForPlayer>[0], playerId: string) {
  const streams = projectEventStreamsForPlayer(events, playerId);
  return { accepted: true, newVersion: state.version, publicEvents: streams.publicEvents, privateEvents: streams.privateEvents, statePatch: createSeatStatePatch(before, state, playerId), versions: versionProfile(state), events: projectEventsForPlayer(events, playerId), state: projectMatchForPlayer(state, playerId) };
}

async function recordObservationSafely(observation: Parameters<typeof recordEngineObservation>[1]) {
  try { await recordEngineObservation(await getDatabase(), observation); } catch (error) { console.error(JSON.stringify({ event: "engine_observation_failed", message: error instanceof Error ? error.message : String(error) })); }
}

async function publishMatchState(state: MatchState) {
  const { env } = await import("cloudflare:workers");
  if (!env.MATCHES) return;
  const room = env.MATCHES.getByName(state.code);
  const response = await room.fetch("https://match.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(`Match coordinator rejected snapshot (${response.status}).`);
}

const encoder = new TextEncoder();
const CAPABILITY_HEADER = "x-match-capability";
const COMMAND_ID_HEADER = "x-command-id";
const ACTIONS = new Set([
  "create", "join", "get", "ready", "begin-placement", "place", "draw", "energize", "tap-energy",
  "select", "target", "roll", "reroll", "prepare-play", "play", "choice", "cancel-choice", "order-triggers",
  "pass", "flip-damage", "damage", "hand-limit", "chat", "concede", "next-turn", "next-game", "undo",
]);

function parseBody(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) throw new Error("A valid action is required.");
  if (body.action !== "create" && body.code != null && (typeof body.code !== "string" || !/^[A-Z2-9]{6}$/i.test(body.code))) throw new Error("Room code is invalid.");
  if (body.playerId != null && typeof body.playerId !== "string") throw new Error("Player ID is invalid.");
  if (body.commandId != null && (typeof body.commandId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.commandId))) throw new Error("Command ID is invalid.");
  if (body.expectedVersion != null && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) throw new Error("Expected version is invalid.");
  if (body.payload != null && (typeof body.payload !== "object" || Array.isArray(body.payload))) throw new Error("Action payload is invalid.");
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

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

async function commandIdentity(
  request: Request,
  body: Body,
  code: string,
  playerId: string,
  expectedVersion: number,
) {
  const requestHash = await digest(canonicalJson({
    code,
    playerId,
    expectedVersion,
    action: body.action,
    format: body.format,
    selection: body.selection,
    payload: body.payload ?? {},
  }));
  const supplied = body.commandId ?? request.headers.get(COMMAND_ID_HEADER);
  const commandId = supplied || `cmd-${requestHash}`;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(commandId)) throw new Error("Command ID is invalid.");
  return { commandId, requestHash };
}

async function authenticateSeat(request: Request, code: string, playerId: string) {
  const capability = request.headers.get(CAPABILITY_HEADER) ?? "";
  if (!capability) return false;
  const database = await getDatabase();
  const row = await database.prepare("SELECT capability_hash FROM match_seats WHERE code = ? AND player_id = ?")
    .bind(code, playerId).first<{ capability_hash: string }>();
  return Boolean(row?.capability_hash && row.capability_hash === await digest(capability));
}

async function registerSeat(code: string, playerId: string) {
  const capability = secureToken();
  const database = await getDatabase();
  await database.prepare("INSERT INTO match_seats (code, player_id, capability_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(code, playerId, await digest(capability), Date.now()).run();
  return capability;
}

async function enforceRateLimit(key: string, maximum: number, windowMs: number) {
  const database = await getDatabase();
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  await database.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1",
  ).bind(key, windowStart).run();
  const row = await database.prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?")
    .bind(key, windowStart).first<{ count: number }>();
  if (Number(row?.count ?? 0) > maximum) throw new Error("Rate limit exceeded. Try again shortly.");
}

async function load(code: string): Promise<MatchRecord | null> {
  const database = await getDatabase();
  const row = await database.prepare("SELECT state_json, previous_state_json FROM matches WHERE code = ?")
    .bind(code)
    .first<{ state_json: string; previous_state_json: string | null }>();
  return row ? {
    state: normalizeEngineState(normalizeMatchState(JSON.parse(row.state_json) as MatchState)),
    previous: row.previous_state_json
      ? normalizeMatchState(JSON.parse(row.previous_state_json) as MatchState)
      : null,
  } : null;
}

async function touchPresence(code: string, playerId: string, now = Date.now()) {
  const database = await getDatabase();
  await database.prepare(
    "INSERT INTO match_presence (code, player_id, last_seen, connected) VALUES (?, ?, ?, 1) ON CONFLICT(code, player_id) DO UPDATE SET last_seen = excluded.last_seen, connected = 1",
  ).bind(code, playerId, now).run();
}

/** Existing snapshots pre-date the presence table, so missing rows are seeded. */
async function hydratePresence(state: MatchState) {
  const database = await getDatabase();
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

async function latestConflict(code: string, playerId: string, message = "Match state changed. Resynchronising.") {
  const latest = await load(code);
  if (latest) await hydratePresence(latest.state);
  return json({
    error: message,
    state: latest ? projectMatchForPlayer(latest.state, playerId) : undefined,
  }, latest ? 409 : 404);
}

async function duplicateCommandResponse(
  database: D1Database,
  state: EngineBackedMatchState,
  playerId: string,
  commandId: string,
  requestHash: string,
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
  if (receipt.requestHash !== requestHash) {
    return json({ error: "This command ID was already used for a different request." }, 409);
  }
  return json({ ...eventResponse(state, state, [], playerId), commandId, duplicate: true, previousVersion: receipt.expectedVersion, newVersion: receipt.resultVersion, statePatch: [] });
}

async function applyExpiredDeadline(
  state: EngineBackedMatchState,
  previous: MatchState | null,
  coordinated: boolean,
) {
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
  if (!coordinated) await publishMatchState(result.state);
  return { state: result.state, previous: state };
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const coordinated = request.headers.get("x-match-coordinator") === "durable-object";
  let diagnosticState: EngineBackedMatchState | undefined;
  let diagnosticEnvelope: CommandEnvelope | undefined;
  try {
    assertSameOrigin(request);
    const body = parseBody(await request.json());
    const clientKey = requestClientKey(request);
    await enforceRateLimit(`${clientKey}:${body.action === "chat" ? "chat" : "game"}`, body.action === "chat" ? 30 : 180, 60_000);
    if (body.action === "create" || body.action === "join") {
      await applyDatabaseCardOverrides(await getDatabase());
    }

    if (body.action === "create") {
      if (!body.selection || !body.format) return json({ error: "Missing canonical match setup." }, 400);
      const player = makeCanonicalPlayer(body.selection);
      const database = await getDatabase();
      const issuedAt = Date.now();
      const identity = await commandIdentity(request, body, "NEW", player.id, 0);
      const baseSeed = secureToken(32);
      let code = "";
      let result: ReturnType<typeof initializeMatch> | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        code = roomCode();
        result = initializeMatch(code, body.format, [player], {
          commandId: identity.commandId,
          actorId: player.id,
          issuedAt,
          randomSeed: `${baseSeed}:${code}`,
          requestHash: identity.requestHash,
        });
        if (!result.receipt) throw new Error("Match initialization did not produce a command receipt.");
        if (await persistInitialMatch(database, result.state, result.events, result.receipt)) break;
        result = null;
      }
      if (!result) return json({ error: "A unique room code could not be allocated." }, 503);
      const capability = await registerSeat(code, player.id);
      await touchPresence(code, player.id, issuedAt);
      if (!coordinated) await publishMatchState(result.state);
      console.info(JSON.stringify({ event: "match_created", correlationId, commandId: identity.commandId, code, playerId: player.id, version: result.state.version }));
      await recordObservationSafely(transitionObservation(result.state, result.state, { commandId: identity.commandId, gameId: result.state.id, actorId: player.id, expectedVersion: 0, issuedAt, randomSeed: `${baseSeed}:${code}`, requestHash: identity.requestHash, command: { type: "CHAT", message: "" } }, result.events, 0, correlationId));
      return json({ ...eventResponse(null, result.state, result.events, player.id), commandId: identity.commandId, duplicate: false, previousVersion: 0, capability });
    }

    if (!body.code) return json({ error: "Room code required." }, 400);
    const code = body.code.toUpperCase();
    let record = await load(code);
    if (!record) return json({ error: "Match room not found." }, 404);

    if (body.action !== "join") {
      if (!body.playerId || !record.state.players.some((player) => player.id === body.playerId)) return json({ error: "Unknown player." }, 403);
      if (!await authenticateSeat(request, code, body.playerId)) return json({ error: "Invalid match seat capability." }, 403);
      await touchPresence(code, body.playerId);
    }
    await hydratePresence(record.state);

    const deadlineResult = await applyExpiredDeadline(record.state, record.previous, coordinated);
    if (!deadlineResult) return latestConflict(code, body.playerId ?? "");
    record = deadlineResult;
    const state = record.state;
    diagnosticState = state;

    if (body.action === "get") {
      return json({ accepted: true, snapshot: true, newVersion: state.version, versions: versionProfile(state), state: projectMatchForPlayer(state, body.playerId ?? ""), publicEvents: [], privateEvents: [], statePatch: [] });
    }

    if (body.action === "join") {
      if (!body.selection) return json({ error: "Canonical player selection required." }, 400);
      const player = makeCanonicalPlayer(body.selection);
      if (state.players.some((candidate) => candidate.id === player.id)) {
        if (!await authenticateSeat(request, code, player.id)) return json({ error: "A valid seat capability is required to reconnect." }, 403);
        return json({ accepted: true, snapshot: true, reconnect: true, newVersion: state.version, versions: versionProfile(state), state: projectMatchForPlayer(state, player.id), publicEvents: [], privateEvents: [], statePatch: [] });
      }
      if (state.players.length >= 2) return json({ error: "Room is full." }, 409);

      const expectedVersion = body.expectedVersion ?? state.version;
      const identity = await commandIdentity(request, body, code, player.id, expectedVersion);
      const database = await getDatabase();
      const duplicate = await duplicateCommandResponse(database, state, player.id, identity.commandId, identity.requestHash);
      if (duplicate) return duplicate;
      if (expectedVersion !== state.version) return latestConflict(code, player.id);

      const envelope: CommandEnvelope = {
        commandId: identity.commandId,
        gameId: state.id,
        actorId: player.id,
        expectedVersion,
        issuedAt: Date.now(),
        randomSeed: secureToken(32),
        requestHash: identity.requestHash,
        command: { type: "JOIN_PLAYER", player },
      };
      diagnosticEnvelope = envelope;
      const result = reduceMatch(state, envelope);
      if (!result.receipt) throw new Error("Join did not produce a command receipt.");
      const saved = await persistTransition(database, {
        code,
        next: result.state,
        previous: state,
        expectedVersion,
        events: result.events,
        receipt: result.receipt,
      });
      if (!saved) return latestConflict(code, player.id);
      const capability = await registerSeat(code, player.id);
      await touchPresence(code, player.id, envelope.issuedAt);
      if (!coordinated) await publishMatchState(result.state);
      await recordObservationSafely(transitionObservation(state, result.state, envelope, result.events, 0, correlationId));
      return json({ ...eventResponse(state, result.state, result.events, player.id), commandId: identity.commandId, duplicate: false, previousVersion: expectedVersion, capability });
    }

    if (!body.playerId) return json({ error: "Unknown player." }, 403);
    const expectedVersion = body.expectedVersion ?? state.version;
    const identity = await commandIdentity(request, body, code, body.playerId, expectedVersion);
    const database = await getDatabase();
    const duplicate = await duplicateCommandResponse(database, state, body.playerId, identity.commandId, identity.requestHash);
    if (duplicate) return duplicate;
    if (expectedVersion !== state.version) {
      return json({ error: "Match state changed. Resynchronising.", state: projectMatchForPlayer(state, body.playerId) }, 409);
    }

    const payload = body.payload ?? {};
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
    if (!result.changed || !result.receipt) throw new Error("The command did not produce a persistent transition.");
    const previous = body.action === "chat" ? record.previous : before;
    if (!await persistTransition(database, {
      code,
      next: result.state,
      previous,
      expectedVersion,
      events: result.events,
      receipt: result.receipt,
    })) {
      return latestConflict(code, body.playerId);
    }
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
    return json({ ...eventResponse(before, result.state, result.events, body.playerId), commandId: identity.commandId, duplicate: false, previousVersion: expectedVersion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match command failed.";
    const context = engineDiagnosticContext(diagnosticState, diagnosticEnvelope, correlationId);
    console.error(JSON.stringify({ event: "match_action_failed", correlationId, message, context }));
    await recordObservationSafely({ kind: /version/i.test(message) ? "version-conflict" : /unsupported|unreviewed/i.test(message) ? "unsupported-rule" : "command-rejected", metric: "command", value: 1, context, details: { message }, createdAt: Date.now() });
    return json({ error: message }, 400);
  }
}
