import { normalizeMatchState, type MatchState } from "../../../lib/game";
import { makeCanonicalPlayer, makeCanonicalPlayerWithRestrictions, type CanonicalPlayerSelection } from "../../../lib/data";
import { tagLobbyPlayerDeck } from "../../../lib/lobby-config";
import { getSessionUser } from "../../../lib/account-server";
import { initializeRankedLobby, joinRankedLobby, rankedSeries, rankedSeriesScore } from "../../../lib/ranked-lobby";
import { getActiveRankedRuleset, settleRankedSeries } from "../../../lib/ranked-server";
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
  EngineCommandError,
  type ApiAction,
  type CommandEnvelope,
  type EngineBackedMatchState,
} from "../../../lib/engine";
import { isInternalMatchRequest } from "../../../lib/internal-request";
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
  format?: "bo1" | "bo3";
  selection?: CanonicalPlayerSelection;
  rankedDecks?: CanonicalPlayerSelection[];
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
const CAPABILITY_HEADER = "x-match-capability";
const COMMAND_ID_HEADER = "x-command-id";
const ACTIONS = new Set([
  "create", "join", "get", "ready", "lobby-ready", "start-match", "lobby-settings", "lobby-deck",
  "ranked-ban", "ranked-select",
  "begin-placement", "place", "draw", "energize", "tap-energy", "select", "target", "roll", "reroll",
  "prepare-play", "play", "choice", "cancel-choice", "order-triggers", "pass", "flip-damage", "damage",
  "hand-limit", "chat", "concede", "next-turn", "next-game", "undo",
]);

function parseBody(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("A JSON object is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) throw new ValidationError("A valid action is required.");
  if (body.action !== "create" && body.code != null && (typeof body.code !== "string" || !/^[A-Z2-9]{6}$/i.test(body.code))) {
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
  if (body.rankedDecks != null && (!Array.isArray(body.rankedDecks) || body.rankedDecks.length !== 3)) {
    throw new ValidationError("Ranked requires exactly three deck submissions.");
  }
  return body as Body;
}

async function settleCompletedRankedState(database: D1Database, state: EngineBackedMatchState) {
  const ranked = rankedSeries(state);
  if (!ranked || ranked.settlement || state.phase !== "result" || Math.max(...Object.values(state.series)) < 2) return false;
  const winnerId = state.winner;
  const winner = winnerId ? ranked.players[winnerId] : undefined;
  const loserEntry = Object.entries(ranked.players).find(([playerId]) => playerId !== winnerId);
  if (!winner || !loserEntry) throw new ServiceUnavailableError("Ranked BP could not be settled.");
  ranked.stage = "complete";
  ranked.settlement = await settleRankedSeries(database, {
    seriesId: state.id,
    rulesetVersion: ranked.rulesetVersion,
    playerOneUserId: Object.values(ranked.players)[0].userId,
    playerTwoUserId: Object.values(ranked.players)[1].userId,
    winnerUserId: winner.userId,
    loserUserId: loserEntry[1].userId,
    score: rankedSeriesScore(state),
  });
  return true;
}

async function persistRankedSettlementSnapshot(database: D1Database, state: EngineBackedMatchState) {
  const result = await database.prepare(`UPDATE matches SET state_json = ?, updated_at = ?
    WHERE code = ? AND CAST(json_extract(state_json, '$.version') AS INTEGER) = ?`)
    .bind(JSON.stringify(state), Date.now(), state.code, state.version).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new ConflictError("The completed Ranked result changed while BP was being settled.");
  }
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

async function commandIdentity(request: Request, body: Body, code: string, playerId: string, expectedVersion: number) {
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
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(commandId)) throw new ValidationError("Command ID is invalid.");
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
    const clientKey = requestClientKey(request);
    await enforceD1RateLimit(await getDatabase(), `${clientKey}:${body.action === "chat" ? "chat" : "game"}`, body.action === "chat" ? 30 : 180, 60_000);
    if (body.action === "create" || body.action === "join" || body.action === "lobby-deck") await applyDatabaseCardOverrides(await getDatabase());

    if (body.action === "create") {
      if (!body.selection || !body.format) throw new ValidationError("Missing canonical match setup.");
      const database = await getDatabase();
      const requestedRanked = body.payload?.lobbyMode === "ranked";
      const account = requestedRanked ? await getSessionUser(request) : null;
      if (requestedRanked && !account) throw new AuthorizationError("Sign in to create a Ranked lobby.");
      if (requestedRanked && body.format !== "bo3") throw new ValidationError("Ranked is locked to Best of Three.");
      if (requestedRanked && body.rankedDecks?.[0]?.deck.id !== body.selection.deck.id) throw new ValidationError("The active Ranked deck must be one of the submitted decks.");
      const ruleset = requestedRanked ? await getActiveRankedRuleset(database) : null;
      const effectiveSelection = requestedRanked ? { ...body.selection, name: account!.displayName } : body.selection;
      const player = tagLobbyPlayerDeck(
        requestedRanked
          ? makeCanonicalPlayerWithRestrictions(effectiveSelection, ruleset!.restrictions)
          : makeCanonicalPlayer(effectiveSelection),
        effectiveSelection.deck,
      );
      const issuedAt = Date.now();
      const identity = await commandIdentity(request, body, "NEW", player.id, 0);
      const baseSeed = secureToken(32);
      const capability = secureToken();
      const capabilityHash = await digest(capability);
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
        if (requestedRanked) {
          result.state = initializeRankedLobby(
            result.state,
            player.id,
            account!.id,
            account!.displayName,
            body.rankedDecks ?? [],
            ruleset!.version,
            ruleset!.restrictions,
          ) as EngineBackedMatchState;
        }
        if (!result.receipt) throw new ServiceUnavailableError("The match could not be created.", "Match initialization did not produce a command receipt.");
        if (await persistInitialMatch(database, result.state, result.events, result.receipt, {
          playerId: player.id,
          capabilityHash,
          createdAt: issuedAt,
        })) break;
        result = null;
      }
      if (!result) throw new ServiceUnavailableError("A unique room code could not be allocated.");
      await touchPresence(code, player.id, issuedAt);
      if (!coordinated) await publishMatchState(result.state);
      console.info(JSON.stringify({ event: "match_created", correlationId, commandId: identity.commandId, code, playerId: player.id, version: result.state.version }));
      await recordObservationSafely(transitionObservation(result.state, result.state, {
        commandId: identity.commandId,
        gameId: result.state.id,
        actorId: player.id,
        expectedVersion: 0,
        issuedAt,
        randomSeed: `${baseSeed}:${code}`,
        requestHash: identity.requestHash,
        command: { type: "CHAT", message: "" },
      }, result.events, 0, correlationId));
      return json({
        ...eventResponse(null, result.state, result.events, player.id),
        commandId: identity.commandId,
        duplicate: false,
        previousVersion: 0,
        capability,
        correlationId,
      });
    }

    if (!body.code) throw new ValidationError("Room code required.");
    const code = body.code.toUpperCase();
    let record = await load(code);
    if (!record) return json({ error: "Match room not found.", code: "VALIDATION_ERROR", correlationId }, 404);

    if (body.action !== "join") {
      if (!body.playerId || !record.state.players.some((player) => player.id === body.playerId)) {
        throw new AuthorizationError("Unknown player.");
      }
      if (!await authenticateSeat(request, code, body.playerId)) throw new AuthorizationError("Invalid match seat capability.");
      await touchPresence(code, body.playerId);
    }
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

    if (body.action === "join") {
      if (!body.selection) throw new ValidationError("Canonical player selection required.");
      if (body.format && body.format !== state.format) {
        throw new ValidationError(`This lobby uses ${state.format === "bo3" ? "Best of Three" : "Best of One"}. Select the matching structure before joining.`);
      }
      const ranked = rankedSeries(state);
      const account = ranked ? await getSessionUser(request) : null;
      if (ranked && !account) throw new AuthorizationError("Sign in to join a Ranked lobby.");
      if (ranked && body.format !== "bo3") throw new ValidationError("Ranked is locked to Best of Three.");
      if (ranked && body.rankedDecks?.[0]?.deck.id !== body.selection.deck.id) throw new ValidationError("The active Ranked deck must be one of the submitted decks.");
      if (!ranked && body.rankedDecks) throw new ValidationError("This is not a Ranked lobby.");
      const effectiveSelection = ranked ? { ...body.selection, name: account!.displayName } : body.selection;
      const player = tagLobbyPlayerDeck(
        ranked ? makeCanonicalPlayerWithRestrictions(effectiveSelection, ranked.restrictions) : makeCanonicalPlayer(effectiveSelection),
        effectiveSelection.deck,
      );
      if (state.players.some((candidate) => candidate.id === player.id)) {
        if (!await authenticateSeat(request, code, player.id)) {
          throw new AuthorizationError("A valid seat capability is required to reconnect.");
        }
        return json({
          accepted: true,
          snapshot: true,
          reconnect: true,
          newVersion: state.version,
          versions: versionProfile(state),
          state: projectMatchForPlayer(state, player.id),
          publicEvents: [],
          privateEvents: [],
          statePatch: [],
          correlationId,
        });
      }
      if (state.players.length >= 2) throw new ConflictError("Room is full.");

      const expectedVersion = body.expectedVersion ?? state.version;
      const identity = await commandIdentity(request, body, code, player.id, expectedVersion);
      const database = await getDatabase();
      const duplicate = await duplicateCommandResponse(database, state, player.id, identity.commandId, identity.requestHash, correlationId);
      if (duplicate) return duplicate;
      if (expectedVersion !== state.version) return latestConflict(code, player.id, correlationId);

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
      if (!result.receipt) throw new ServiceUnavailableError("The player could not join the room.", "Join did not produce a command receipt.");
      if (ranked) {
        result.state = joinRankedLobby(
          result.state,
          player.id,
          account!.id,
          account!.displayName,
          body.rankedDecks ?? [],
          ranked.restrictions,
        ) as EngineBackedMatchState;
      }
      const capability = secureToken();
      const saved = await persistTransition(database, {
        code,
        next: result.state,
        previous: state,
        expectedVersion,
        events: result.events,
        receipt: result.receipt,
        seat: { playerId: player.id, capabilityHash: await digest(capability), createdAt: envelope.issuedAt },
      });
      if (!saved) return latestConflict(code, player.id, correlationId);
      await touchPresence(code, player.id, envelope.issuedAt);
      if (!coordinated) await publishMatchState(result.state);
      await recordObservationSafely(transitionObservation(state, result.state, envelope, result.events, 0, correlationId));
      return json({
        ...eventResponse(state, result.state, result.events, player.id),
        commandId: identity.commandId,
        duplicate: false,
        previousVersion: expectedVersion,
        capability,
        correlationId,
      });
    }

    if (!body.playerId) throw new AuthorizationError("Unknown player.");
    const expectedVersion = body.expectedVersion ?? state.version;
    const identity = await commandIdentity(request, body, code, body.playerId, expectedVersion);
    const database = await getDatabase();
    const duplicate = await duplicateCommandResponse(database, state, body.playerId, identity.commandId, identity.requestHash, correlationId);
    if (duplicate) return duplicate;
    if (expectedVersion !== state.version) return latestConflict(code, body.playerId, correlationId);

    let payload = body.payload ?? {};
    if (body.action === "lobby-deck") {
      if (rankedSeries(state)) throw new ValidationError("Ranked deck changes use the locked series selection.");
      if (!body.selection) throw new ValidationError("Canonical player selection required.");
      const replacement = tagLobbyPlayerDeck(makeCanonicalPlayer(body.selection), body.selection.deck);
      if (replacement.id !== body.playerId) throw new AuthorizationError("A player can only change their own lobby deck.");
      payload = { ...payload, player: replacement };
    }
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
    const previous = body.action === "chat" ? record.previous : before;
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
