import {
  beginCorePlacement, cancelCardChoice, concedeMatch, createMatch, discardToHandLimit, energizeCard, nextTurn,
  legalPlacementCells, orderTriggers, placeCore, prepareCardPlay, redactForPlayer, selectBakugan, setReady,
  startNextSeriesGame, submitCardChoice, type CardChoices, type MatchState,
} from "../../../lib/game";
import { makeCanonicalPlayer, type CanonicalPlayerSelection } from "../../../lib/data";
import { playCardWithAutoEnergy } from "../../../lib/cardPayment";
import { addChatMessage } from "../../../lib/chat";
import { tapEnergyCard } from "../../../lib/energy";
import {
  flipDamageCard,
  passPriorityWithManualDamage,
  resolveManualDamage,
} from "../../../lib/manualDamage";
import { confirmRoll, playerCanConfirmRoll, playerCanSelectRollTarget, selectRollTarget } from "../../../lib/rolling";
import { drawTurnCard, playerCanDrawTurnCard, preparePendingDraw } from "../../../lib/turnStart";
import { undoLatestAction } from "../../../lib/undo";
import { assertSameOrigin, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

type Body = {
  action: string;
  code?: string;
  playerId?: string;
  expectedVersion?: number;
  format?: "bo1" | "bo3";
  selection?: CanonicalPlayerSelection;
  payload?: Record<string, unknown>;
};

type MatchRecord = {
  state: MatchState;
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
  return env.DB;
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
const ACTIONS = new Set([
  "create", "join", "get", "ready", "begin-placement", "place", "draw", "energize", "tap-energy",
  "select", "target", "roll", "prepare-play", "play", "choice", "cancel-choice", "order-triggers",
  "pass", "flip-damage", "damage", "hand-limit", "chat", "concede", "next-turn", "next-game", "undo",
]);

function parseBody(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) throw new Error("A valid action is required.");
  if (body.code != null && (typeof body.code !== "string" || !/^[A-Z2-9]{6}$/i.test(body.code))) throw new Error("Room code is invalid.");
  if (body.playerId != null && typeof body.playerId !== "string") throw new Error("Player ID is invalid.");
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
    state: JSON.parse(row.state_json) as MatchState,
    previous: row.previous_state_json ? JSON.parse(row.previous_state_json) as MatchState : null,
  } : null;
}

/**
 * Compare-and-swap on the authoritative gameplay version. Presence pings live
 * in a separate table, so they cannot conflict with or be erased by gameplay
 * transitions. Concurrent gameplay actions still compete for the same version,
 * allowing exactly one transition to win.
 */
async function saveTransition(
  code: string,
  next: MatchState,
  previous: MatchState | null,
  expectedVersion: number,
  broadcast = true,
) {
  const chat = next.log.filter((entry) => String(entry.kind) === "chat").slice(-100);
  const events = next.log.filter((entry) => String(entry.kind) !== "chat").slice(-400);
  const retained = new Set([...chat, ...events].map((entry) => entry.id));
  next.log = next.log.filter((entry) => retained.has(entry.id));
  const database = await getDatabase();
  const result = await database.prepare(
    "UPDATE matches SET state_json = ?, previous_state_json = ?, updated_at = ? WHERE code = ? AND CAST(json_extract(state_json, '$.version') AS INTEGER) = ?",
  ).bind(
    JSON.stringify(next),
    previous ? JSON.stringify(previous) : null,
    Date.now(),
    code,
    expectedVersion,
  ).run();
  const saved = Number(result.meta?.changes ?? 0) > 0;
  if (!saved) return false;
  if (next.version % 5 === 0 || next.phase === "result") {
    await database.prepare(
      "INSERT OR REPLACE INTO match_snapshots (code, version, state_json, created_at) VALUES (?, ?, ?, ?)",
    ).bind(code, next.version, JSON.stringify(next), Date.now()).run();
  }
  if (broadcast) await publishMatchState(next);
  return true;
}

function resolveExpiredDeadline(input: MatchState, now = Date.now()) {
  if (now <= input.deadline || ["lobby", "result"].includes(input.phase)) return input;
  const state = structuredClone(input);
  const actorId = state.priority;
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) return input;
  if (state.pendingChoice) {
    const fields = state.pendingChoice.schema.fields.filter((candidate) => candidate.chooserId === actorId);
    if (!fields.length) return input;
    const timeoutChoices: Record<string, unknown> = {};
    const confirmation = fields.find((field) => field.id === "confirmed");
    if (confirmation?.options.some((option) => option.id === "no")) {
      timeoutChoices.confirmed = false;
    } else {
      for (const field of fields) {
        const selected = field.options.slice(0, field.minimum).map((option) => option.id);
        if (field.id === "xValue") timeoutChoices[field.id] = Number(selected[0] ?? 0);
        else if (field.id === "confirmed") timeoutChoices[field.id] = selected[0] !== "no";
        else if (["targetEnergyIds", "discardCardIds", "handCardIds"].includes(field.id)) timeoutChoices[field.id] = selected;
        else if (selected[0] != null) timeoutChoices[field.id] = selected[0];
      }
    }
    return submitCardChoice(state, actorId, timeoutChoices as CardChoices);
  }
  const triggerOrder = state.triggerOrders.find((request) => request.controllerId === actorId && !request.orderedIds);
  if (triggerOrder) return orderTriggers(state, actorId, triggerOrder.id, triggerOrder.triggerIds);
  if (state.phase === "startingPlayer") return beginCorePlacement(state, now);
  if (state.phase === "placement") {
    const used = new Set(state.placements.filter((placement) => placement.playerId === actorId).map((placement) => placement.core.id));
    const core = actor.cores.find((candidate) => !used.has(candidate.id));
    const cell = legalPlacementCells(state)[0];
    return core && cell ? placeCore(state, actorId, core.id, cell) : input;
  }
  if (state.phase === "draw" && playerCanDrawTurnCard(state, actorId, now)) return drawTurnCard(state, actorId, now);
  if (state.phase === "energize" && !actor.energizedThisTurn) return energizeCard(state, actorId);
  if (state.phase === "selection" && !state.selected[actorId]) {
    const bakugan = actor.bakugan.find((candidate) => !candidate.open) ?? actor.bakugan[0];
    return bakugan ? selectBakugan(state, actorId, bakugan.id) : input;
  }
  if (state.phase === "target") {
    if (playerCanSelectRollTarget(state, actorId)) {
      const target = state.placements.find((placement) => !placement.attachedTo);
      return target ? selectRollTarget(state, actorId, target.cell) : input;
    }
    if (playerCanConfirmRoll(state, actorId)) return confirmRoll(state, actorId);
  }
  if (state.phase === "damage" && state.pendingLoser === actorId) {
    if (state.revealedFlip) return resolveManualDamage(state, actorId);
    if (state.pendingDamage > 0) return flipDamageCard(state, actorId);
  }
  if (["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase)) return passPriorityWithManualDamage(state, actorId);
  if (state.phase === "handLimit") {
    const amount = Math.max(0, actor.hand.length - 7);
    return discardToHandLimit(state, actorId, actor.hand.slice(0, amount).map((card) => card.id));
  }
  return input;
}

async function touchPresence(code: string, playerId: string, now = Date.now()) {
  const database = await getDatabase();
  await database.prepare(
    "INSERT INTO match_presence (code, player_id, last_seen, connected) VALUES (?, ?, ?, 1) ON CONFLICT(code, player_id) DO UPDATE SET last_seen = excluded.last_seen, connected = 1",
  ).bind(code, playerId, now).run();
}

async function markPresenceDisconnected(code: string, playerId: string) {
  const database = await getDatabase();
  await database.prepare(
    "UPDATE match_presence SET connected = 0 WHERE code = ? AND player_id = ?",
  ).bind(code, playerId).run();
}

/**
 * Existing matches pre-date the presence table, so missing rows are seeded from
 * their last persisted timestamps before the table becomes authoritative.
 */
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

function checkDisconnects(state: MatchState) {
  if (["lobby", "result"].includes(state.phase) || state.players.length < 2) return state;
  const now = Date.now();
  const disconnected = state.players.find((player) => now - player.lastSeen > 30_000);
  if (!disconnected) return state;
  const winner = state.players.find((player) => player.id !== disconnected.id)!;
  disconnected.connected = false;
  const resolved = concedeMatch(state, disconnected.id);
  resolved.resultReason = "Opponent disconnected (30-second grace expired)";
  resolved.log.push({ id: `${now}-disconnect`, at: now, kind: "connection", message: `${disconnected.name}'s reconnect window expired. ${winner.name} wins.` });
  return resolved;
}

async function latestConflict(code: string, playerId: string, message = "Match state changed. Resynchronising.") {
  const latest = await load(code);
  if (latest) await hydratePresence(latest.state);
  return json({
    error: message,
    state: latest ? redactForPlayer(latest.state, playerId) : undefined,
  }, latest ? 409 : 404);
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const coordinated = request.headers.get("x-match-coordinator") === "durable-object";
  try {
    assertSameOrigin(request);
    const body = parseBody(await request.json());
    const clientKey = requestClientKey(request);
    await enforceRateLimit(`${clientKey}:${body.action === "chat" ? "chat" : "game"}`, body.action === "chat" ? 30 : 180, 60_000);
    if (body.action === "create") {
      if (!body.selection || !body.format) return json({ error: "Missing canonical match setup." }, 400);
      const player = makeCanonicalPlayer(body.selection);
      const database = await getDatabase();
      let code = "";
      let state: MatchState | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        code = roomCode();
        state = createMatch(code, body.format, [player]);
        const inserted = await database.prepare("INSERT OR IGNORE INTO matches (code, state_json, previous_state_json, updated_at) VALUES (?, ?, NULL, ?)")
          .bind(code, JSON.stringify(state), Date.now()).run();
        if (Number(inserted.meta?.changes ?? 0) > 0) break;
        state = null;
      }
      if (!state) return json({ error: "A unique room code could not be allocated." }, 503);
      const capability = await registerSeat(code, player.id);
      await touchPresence(code, player.id);
      await publishMatchState(state);
      console.info(JSON.stringify({ event: "match_created", correlationId, code, playerId: player.id, version: state.version }));
      return json({ state: redactForPlayer(state, player.id), capability });
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

    const beforeDisconnect = structuredClone(record.state);
    let state = checkDisconnects(record.state);
    if (state !== record.state) {
      const disconnected = state.players.find((player) => !player.connected);
      if (disconnected) await markPresenceDisconnected(code, disconnected.id);
      const saved = await saveTransition(state.code, state, beforeDisconnect, beforeDisconnect.version, !coordinated);
      if (!saved) {
        record = await load(code);
        if (!record) return json({ error: "Match room not found." }, 404);
        state = await hydratePresence(record.state);
      } else {
        record = { state, previous: beforeDisconnect };
      }
    }

    const beforeDeadline = structuredClone(state);
    const timed = resolveExpiredDeadline(state);
    if (timed !== state) {
      if (!await saveTransition(code, timed, beforeDeadline, beforeDeadline.version, !coordinated)) return latestConflict(code, body.playerId ?? "");
      state = timed;
      record = { state, previous: beforeDeadline };
    }

    if (body.action === "get") {
      return json({ state: redactForPlayer(state, body.playerId ?? "") });
    }

    if (body.action === "join") {
      if (!body.selection) return json({ error: "Canonical player selection required." }, 400);
      const player = makeCanonicalPlayer(body.selection);
      if (state.players.length >= 2 && !state.players.some((candidate) => candidate.id === player.id)) return json({ error: "Room is full." }, 409);
      if (!state.players.some((candidate) => candidate.id === player.id)) {
        const before = structuredClone(state);
        state.players.push(player);
        state.series[player.id] = 0;
        state.version += 1;
        state.log.push({ id: `${Date.now()}-join`, at: Date.now(), kind: "connection", message: `${player.name} joined the room.` });
        if (!await saveTransition(state.code, state, before, before.version, !coordinated)) {
          return latestConflict(code, player.id);
        }
        const capability = await registerSeat(code, player.id);
        await touchPresence(code, player.id);
        return json({ state: redactForPlayer(state, player.id), capability });
      }
      if (!await authenticateSeat(request, code, player.id)) return json({ error: "A valid seat capability is required to reconnect." }, 403);
      return json({ state: redactForPlayer(state, player.id) });
    }

    if (!body.playerId) return json({ error: "Unknown player." }, 403);
    if (body.expectedVersion != null && body.expectedVersion !== state.version) {
      return json({ error: "Match state changed. Resynchronising.", state: redactForPlayer(state, body.playerId) }, 409);
    }

    const before = structuredClone(state);
    const payload = body.payload ?? {};
    const choices = (payload.choices ?? {}) as CardChoices;
    switch (body.action) {
      case "ready": state = setReady(state, body.playerId); break;
      case "begin-placement": state = beginCorePlacement(state); break;
      case "place": state = placeCore(state, body.playerId, String(payload.coreId ?? ""), String(payload.cell ?? "")); break;
      case "draw": state = drawTurnCard(state, body.playerId); break;
      case "energize": state = energizeCard(state, body.playerId, payload.cardId ? String(payload.cardId) : undefined); break;
      case "tap-energy": state = tapEnergyCard(state, body.playerId, String(payload.cardId ?? "")); break;
      case "select": state = selectBakugan(state, body.playerId, String(payload.bakuganId ?? "")); break;
      case "target": state = selectRollTarget(state, body.playerId, String(payload.cell ?? "")); break;
      case "roll": state = confirmRoll(state, body.playerId); break;
      case "prepare-play": state = prepareCardPlay(state, body.playerId, String(payload.cardId ?? "")); break;
      case "play": state = playCardWithAutoEnergy(state, body.playerId, String(payload.cardId ?? ""), choices); break;
      case "choice": state = submitCardChoice(state, body.playerId, choices); break;
      case "cancel-choice": state = cancelCardChoice(state, body.playerId); break;
      case "order-triggers": state = orderTriggers(state, body.playerId, String(payload.requestId ?? ""), Array.isArray(payload.orderedIds) ? payload.orderedIds.map(String) : []); break;
      case "pass": state = passPriorityWithManualDamage(state, body.playerId); break;
      case "flip-damage": state = flipDamageCard(state, body.playerId); break;
      case "damage": state = resolveManualDamage(state, body.playerId, payload.cardId ? String(payload.cardId) : undefined, choices); break;
      case "hand-limit": state = discardToHandLimit(state, body.playerId, Array.isArray(payload.cardIds) ? payload.cardIds.map(String) : []); break;
      case "chat": state = addChatMessage(state, body.playerId, String(payload.message ?? "")); break;
      case "concede": state = concedeMatch(state, body.playerId); break;
      case "next-turn": state = nextTurn(state); break;
      case "next-game": state = startNextSeriesGame(state); break;
      case "undo": state = undoLatestAction(state, body.playerId); break;
      default: return json({ error: "Unknown match command." }, 400);
    }

    if (body.action !== "chat") state = preparePendingDraw(state);
    const actor = state.players.find((player) => player.id === body.playerId);
    if (actor) {
      actor.lastSeen = Date.now();
      actor.connected = true;
    }
    const previous = body.action === "chat" ? record.previous : before;
    if (!await saveTransition(state.code, state, previous, before.version, !coordinated)) {
      return latestConflict(code, body.playerId);
    }
    console.info(JSON.stringify({ event: "match_action", correlationId, code, action: body.action, playerId: body.playerId, version: state.version }));
    return json({ state: redactForPlayer(state, body.playerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match command failed.";
    console.error(JSON.stringify({ event: "match_action_failed", correlationId, message }));
    return json({ error: message }, 400);
  }
}
