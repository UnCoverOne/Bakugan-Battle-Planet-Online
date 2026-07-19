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
  raw: string;
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
    raw: row.state_json,
  } : null;
}

/**
 * Compare-and-swap on the authoritative gameplay version. Heartbeat requests
 * may update same-version presence metadata before an action saves, but a
 * heartbeat that finishes after a newer action can no longer overwrite it.
 * Concurrent gameplay actions still compete for the same version, so exactly
 * one transition wins.
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

/**
 * Heartbeats use an exact-document comparison. If both players ping together,
 * the loser reloads and retries so one player's lastSeen update cannot erase the
 * other's. A gameplay transition changes the document/version and therefore
 * always defeats an older heartbeat.
 */
async function saveHeartbeat(
  code: string,
  next: MatchState,
  previous: MatchState | null,
  expectedStateJson: string,
) {
  const database = await getDatabase();
  const result = await database.prepare(
    "UPDATE matches SET state_json = ?, previous_state_json = ?, updated_at = ? WHERE code = ? AND state_json = ?",
  ).bind(
    JSON.stringify(next),
    previous ? JSON.stringify(previous) : null,
    Date.now(),
    code,
    expectedStateJson,
  ).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

function checkDisconnects(state: MatchState) {
  if (["lobby", "result"].includes(state.phase) || state.players.length < 2) return state;
  const now = Date.now();
  const disconnected = state.players.find((p) => now - p.lastSeen > 30_000);
  if (!disconnected) return state;
  const winner = state.players.find((p) => p.id !== disconnected.id)!;
  disconnected.connected = false;
  const resolved = concedeMatch(state, disconnected.id);
  resolved.resultReason = "Opponent disconnected (30-second grace expired)";
  resolved.log.push({ id: `${now}-disconnect`, at: now, kind: "connection", message: `${disconnected.name}'s reconnect window expired. ${winner.name} wins.` });
  return resolved;
}

async function latestConflict(code: string, playerId: string, message = "Match state changed. Resynchronising.") {
  const latest = await load(code);
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
      return json({ state: redactForPlayer(state, body.player.id) });
    }

    if (!body.code) return json({ error: "Room code required." }, 400);
    const code = body.code.toUpperCase();
    let record = await load(code);
    if (!record) return json({ error: "Match room not found." }, 404);

    // Resolve disconnects through the same atomic write path as every other
    // state transition. If another request won the race, continue from it.
    const beforeDisconnect = structuredClone(record.state);
    let state = checkDisconnects(record.state);
    const disconnectedRaw = JSON.stringify(state);
    if (disconnectedRaw !== record.raw) {
      const saved = await saveTransition(state.code, state, beforeDisconnect, beforeDisconnect.version);
      if (!saved) {
        record = await load(code);
        if (!record) return json({ error: "Match room not found." }, 404);
        state = record.state;
      } else {
        record = { state, previous: beforeDisconnect, raw: disconnectedRaw };
      }
    }

    if (body.action === "get") {
      if (body.playerId) {
        let heartbeatRecord = record;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const heartbeatState = structuredClone(heartbeatRecord.state);
          const player = heartbeatState.players.find((candidate) => candidate.id === body.playerId);
          if (!player) break;
          player.lastSeen = Date.now();
          player.connected = true;
          if (await saveHeartbeat(
            heartbeatState.code,
            heartbeatState,
            heartbeatRecord.previous,
            heartbeatRecord.raw,
          )) {
            state = heartbeatState;
            break;
          }

          const latest = await load(code);
          if (!latest) break;
          state = latest.state;
          if (latest.state.version !== heartbeatRecord.state.version) break;
          heartbeatRecord = latest;
        }
      }
      return json({ state: redactForPlayer(state, body.playerId ?? "") });
    }

    if (body.action === "join") {
      if (!body.player) return json({ error: "Player profile required." }, 400);
      if (state.players.length >= 2 && !state.players.some((p) => p.id === body.player!.id)) return json({ error: "Room is full." }, 409);
      if (!state.players.some((p) => p.id === body.player!.id)) {
        const before = structuredClone(state);
        state.players.push(body.player);
        state.series[body.player.id] = 0;
        state.version += 1;
        state.log.push({ id: `${Date.now()}-join`, at: Date.now(), kind: "connection", message: `${body.player.name} joined the room.` });
        if (!await saveTransition(state.code, state, before, before.version)) {
          return latestConflict(code, body.player.id);
        }
      }
      return json({ state: redactForPlayer(state, body.player.id) });
    }

    if (!body.playerId || !state.players.some((p) => p.id === body.playerId)) return json({ error: "Unknown player." }, 403);
    if (body.expectedVersion != null && body.expectedVersion !== state.version) {
      return json({ error: "Match state changed. Resynchronising.", state: redactForPlayer(state, body.playerId) }, 409);
    }

    const before = structuredClone(state);
    const p = body.payload ?? {};
    const choices = (p.choices ?? {}) as CardChoices;
    switch (body.action) {
      case "ready": state = setReady(state, body.playerId); break;
      case "place": state = placeCore(state, body.playerId, String(p.coreId ?? ""), String(p.cell ?? "")); break;
      case "draw": state = drawTurnCard(state, body.playerId); break;
      case "energize": state = energizeCard(state, body.playerId, p.cardId ? String(p.cardId) : undefined); break;
      case "tap-energy": state = tapEnergyCard(state, body.playerId, String(p.cardId ?? "")); break;
      case "select": state = selectBakugan(state, body.playerId, String(p.bakuganId ?? "")); break;
      case "target": state = selectRollTarget(state, body.playerId, String(p.cell ?? "")); break;
      case "roll": state = confirmRoll(state, body.playerId); break;
      // The acting player retains priority after adding an object to the Batch.
      case "play": state = playCard(state, body.playerId, String(p.cardId ?? ""), choices); break;
      case "pass": state = passPriority(state, body.playerId); break;
      case "damage": state = resolveDamage(state, body.playerId, p.cardId ? String(p.cardId) : undefined, choices); break;
      case "hand-limit": state = discardToHandLimit(state, body.playerId, Array.isArray(p.cardIds) ? p.cardIds.map(String) : []); break;
      case "concede": state = concedeMatch(state, body.playerId); break;
      case "next-turn": state = nextTurn(state); break;
      case "next-game": state = startNextSeriesGame(state); break;
      case "undo": {
        if (!record.previous || state.priority !== body.playerId || ["target", "damage", "result"].includes(state.phase)) return json({ error: "Undo is no longer available after hidden or random information is revealed." }, 409);
        state = record.previous;
        state.version = before.version + 1;
        state.log.push({ id: `${Date.now()}-undo`, at: Date.now(), kind: "system", message: `${state.players.find((x) => x.id === body.playerId)?.name} used undo before passing priority.` });
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
