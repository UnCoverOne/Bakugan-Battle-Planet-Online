import {
  concedeMatch, createMatch, discardToHandLimit, energizeCard, nextTurn, passPriority,
  placeCore, playCard, redactForPlayer, resolveDamage, selectBakugan, setReady,
  startNextSeriesGame, type CardChoices, type MatchState, type PlayerState,
} from "../../../lib/game";
import { tapEnergyCard } from "../../../lib/energy";
import { confirmRoll, selectRollTarget } from "../../../lib/rolling";
import { drawTurnCard, preparePendingDraw } from "../../../lib/turnStart";

export const dynamic = "force-dynamic";

type Body = {
  action: string;
  code?: string;
  playerId?: string;
  expectedVersion?: number;
  format?: "bo1" | "bo3";
  player?: PlayerState;
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

async function ensureSchema() {
  const database = await getDatabase();
  await database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS matches (code TEXT PRIMARY KEY, state_json TEXT NOT NULL, previous_state_json TEXT, updated_at INTEGER NOT NULL)"),
    database.prepare("CREATE INDEX IF NOT EXISTS matches_updated_at_idx ON matches(updated_at)"),
    database.prepare("CREATE TABLE IF NOT EXISTS match_presence (code TEXT NOT NULL, player_id TEXT NOT NULL, last_seen INTEGER NOT NULL, connected INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (code, player_id))"),
    database.prepare("CREATE INDEX IF NOT EXISTS match_presence_seen_idx ON match_presence(code, last_seen)"),
  ]);
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
) {
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
  return Number(result.meta?.changes ?? 0) > 0;
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
  try {
    await ensureSchema();
    const body = await request.json() as Body;
    if (body.action === "create") {
      if (!body.player || !body.code || !body.format) return json({ error: "Missing match setup." }, 400);
      const code = body.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      const state = createMatch(code, body.format, [body.player]);
      const database = await getDatabase();
      await database.prepare("INSERT INTO matches (code, state_json, previous_state_json, updated_at) VALUES (?, ?, NULL, ?)")
        .bind(code, JSON.stringify(state), Date.now()).run();
      await touchPresence(code, body.player.id);
      return json({ state: redactForPlayer(state, body.player.id) });
    }

    if (!body.code) return json({ error: "Room code required." }, 400);
    const code = body.code.toUpperCase();
    let record = await load(code);
    if (!record) return json({ error: "Match room not found." }, 404);

    if (body.playerId && record.state.players.some((player) => player.id === body.playerId)) {
      await touchPresence(code, body.playerId);
    }
    await hydratePresence(record.state);

    // Resolve disconnects through the same atomic write path as every other
    // gameplay transition. If another request won the race, continue from it.
    const beforeDisconnect = structuredClone(record.state);
    let state = checkDisconnects(record.state);
    if (state !== record.state) {
      const disconnected = state.players.find((player) => !player.connected);
      if (disconnected) await markPresenceDisconnected(code, disconnected.id);
      const saved = await saveTransition(state.code, state, beforeDisconnect, beforeDisconnect.version);
      if (!saved) {
        record = await load(code);
        if (!record) return json({ error: "Match room not found." }, 404);
        state = await hydratePresence(record.state);
      } else {
        record = { state, previous: beforeDisconnect };
      }
    }

    if (body.action === "get") {
      return json({ state: redactForPlayer(state, body.playerId ?? "") });
    }

    if (body.action === "join") {
      if (!body.player) return json({ error: "Player profile required." }, 400);
      if (state.players.length >= 2 && !state.players.some((player) => player.id === body.player!.id)) return json({ error: "Room is full." }, 409);
      if (!state.players.some((player) => player.id === body.player!.id)) {
        const before = structuredClone(state);
        state.players.push(body.player);
        state.series[body.player.id] = 0;
        state.version += 1;
        state.log.push({ id: `${Date.now()}-join`, at: Date.now(), kind: "connection", message: `${body.player.name} joined the room.` });
        if (!await saveTransition(state.code, state, before, before.version)) {
          return latestConflict(code, body.player.id);
        }
        await touchPresence(code, body.player.id);
      }
      return json({ state: redactForPlayer(state, body.player.id) });
    }

    if (!body.playerId || !state.players.some((player) => player.id === body.playerId)) return json({ error: "Unknown player." }, 403);
    if (body.expectedVersion != null && body.expectedVersion !== state.version) {
      return json({ error: "Match state changed. Resynchronising.", state: redactForPlayer(state, body.playerId) }, 409);
    }

    const before = structuredClone(state);
    const payload = body.payload ?? {};
    const choices = (payload.choices ?? {}) as CardChoices;
    switch (body.action) {
      case "ready": state = setReady(state, body.playerId); break;
      case "place": state = placeCore(state, body.playerId, String(payload.coreId ?? ""), String(payload.cell ?? "")); break;
      case "draw": state = drawTurnCard(state, body.playerId); break;
      case "energize": state = energizeCard(state, body.playerId, payload.cardId ? String(payload.cardId) : undefined); break;
      case "tap-energy": state = tapEnergyCard(state, body.playerId, String(payload.cardId ?? "")); break;
      case "select": state = selectBakugan(state, body.playerId, String(payload.bakuganId ?? "")); break;
      case "target": state = selectRollTarget(state, body.playerId, String(payload.cell ?? "")); break;
      case "roll": state = confirmRoll(state, body.playerId); break;
      // The acting player retains priority after adding an object to the Batch.
      case "play": state = playCard(state, body.playerId, String(payload.cardId ?? ""), choices); break;
      case "pass": state = passPriority(state, body.playerId); break;
      case "damage": state = resolveDamage(state, body.playerId, payload.cardId ? String(payload.cardId) : undefined, choices); break;
      case "hand-limit": state = discardToHandLimit(state, body.playerId, Array.isArray(payload.cardIds) ? payload.cardIds.map(String) : []); break;
      case "concede": state = concedeMatch(state, body.playerId); break;
      case "next-turn": state = nextTurn(state); break;
      case "next-game": state = startNextSeriesGame(state); break;
      case "undo": {
        if (!record.previous || state.priority !== body.playerId || ["target", "damage", "result"].includes(state.phase)) return json({ error: "Undo is no longer available after hidden or random information is revealed." }, 409);
        state = record.previous;
        state.version = before.version + 1;
        state.log.push({ id: `${Date.now()}-undo`, at: Date.now(), kind: "system", message: `${state.players.find((player) => player.id === body.playerId)?.name} used undo before passing priority.` });
        break;
      }
      default: return json({ error: "Unknown match command." }, 400);
    }

    state = preparePendingDraw(state);
    const actor = state.players.find((player) => player.id === body.playerId);
    if (actor) {
      actor.lastSeen = Date.now();
      actor.connected = true;
    }
    if (!await saveTransition(state.code, state, before, before.version)) {
      return latestConflict(code, body.playerId);
    }
    return json({ state: redactForPlayer(state, body.playerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match command failed.";
    return json({ error: message }, 400);
  }
}
