import {
  concedeMatch, createMatch, discardToHandLimit, energizeCard, nextTurn, passPriority,
  placeCore, playCard, redactForPlayer, resolveDamage, selectBakugan, setReady,
  startNextSeriesGame, targetCore, type CardChoices, type MatchState, type PlayerState,
} from "../../../lib/game";

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

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

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

async function load(code: string) {
  const database = await getDatabase();
  const row = await database.prepare("SELECT state_json, previous_state_json FROM matches WHERE code = ?").bind(code).first<{ state_json: string; previous_state_json: string | null }>();
  return row ? { state: JSON.parse(row.state_json) as MatchState, previous: row.previous_state_json ? JSON.parse(row.previous_state_json) as MatchState : null } : null;
}

async function save(code: string, next: MatchState, previous: MatchState | null) {
  const database = await getDatabase();
  await database.prepare("UPDATE matches SET state_json = ?, previous_state_json = ?, updated_at = ? WHERE code = ?")
    .bind(JSON.stringify(next), previous ? JSON.stringify(previous) : null, Date.now(), code).run();
}

function checkDisconnects(state: MatchState) {
  if (["lobby", "result"].includes(state.phase) || state.players.length < 2) return state;
  const now = Date.now();
  const disconnected = state.players.find((p) => now - p.lastSeen > 30_000);
  if (!disconnected) return state;
  const winner = state.players.find((p) => p.id !== disconnected.id)!;
  disconnected.connected = false;
  const resolved = concedeMatch(state, disconnected.id); resolved.resultReason = "Opponent disconnected (30-second grace expired)";
  resolved.log.push({ id: `${now}-disconnect`, at: now, kind: "connection", message: `${disconnected.name}'s reconnect window expired. ${winner.name} wins.` });
  return resolved;
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
    const record = await load(body.code.toUpperCase());
    if (!record) return json({ error: "Match room not found." }, 404);
    let state = checkDisconnects(record.state);
    if (body.action === "get") {
      if (body.playerId) {
        const player = state.players.find((p) => p.id === body.playerId);
        if (player) { player.lastSeen = Date.now(); player.connected = true; await save(state.code, state, record.previous); }
      }
      return json({ state: redactForPlayer(state, body.playerId ?? "") });
    }
    if (body.action === "join") {
      if (!body.player) return json({ error: "Player profile required." }, 400);
      if (state.players.length >= 2 && !state.players.some((p) => p.id === body.player!.id)) return json({ error: "Room is full." }, 409);
      if (!state.players.some((p) => p.id === body.player!.id)) {
        state.players.push(body.player); state.series[body.player.id] = 0; state.version += 1;
        state.log.push({ id: `${Date.now()}-join`, at: Date.now(), kind: "connection", message: `${body.player.name} joined the room.` });
        await save(state.code, state, record.state);
      }
      return json({ state: redactForPlayer(state, body.player.id) });
    }
    if (!body.playerId || !state.players.some((p) => p.id === body.playerId)) return json({ error: "Unknown player." }, 403);
    if (body.expectedVersion != null && body.expectedVersion !== state.version) return json({ error: "Match state changed. Resynchronising.", state: redactForPlayer(state, body.playerId) }, 409);
    const before = structuredClone(state);
    const p = body.payload ?? {}; const choices = (p.choices ?? {}) as CardChoices;
    switch (body.action) {
      case "ready": state = setReady(state, body.playerId); break;
      case "place": state = placeCore(state, body.playerId, String(p.coreId ?? ""), String(p.cell ?? "")); break;
      case "energize": state = energizeCard(state, body.playerId, p.cardId ? String(p.cardId) : undefined); break;
      case "select": state = selectBakugan(state, body.playerId, String(p.bakuganId ?? "")); break;
      case "target": state = targetCore(state, body.playerId, String(p.cell ?? "")); break;
      case "play": state = playCard(state, body.playerId, String(p.cardId ?? ""), choices); break;
      case "pass": state = passPriority(state, body.playerId); break;
      case "damage": state = resolveDamage(state, body.playerId, p.cardId ? String(p.cardId) : undefined, choices); break;
      case "hand-limit": state = discardToHandLimit(state, body.playerId, Array.isArray(p.cardIds) ? p.cardIds.map(String) : []); break;
      case "concede": state = concedeMatch(state, body.playerId); break;
      case "next-turn": state = nextTurn(state); break;
      case "next-game": state = startNextSeriesGame(state); break;
      case "undo": {
        if (!record.previous || state.priority !== body.playerId || ["target", "damage", "result"].includes(state.phase)) return json({ error: "Undo is no longer available after hidden or random information is revealed." }, 409);
        state = record.previous; state.version = before.version + 1;
        state.log.push({ id: `${Date.now()}-undo`, at: Date.now(), kind: "system", message: `${state.players.find((x) => x.id === body.playerId)?.name} used undo before passing priority.` });
        break;
      }
      default: return json({ error: "Unknown match command." }, 400);
    }
    const actor = state.players.find((player) => player.id === body.playerId); if (actor) { actor.lastSeen = Date.now(); actor.connected = true; }
    await save(state.code, state, before);
    return json({ state: redactForPlayer(state, body.playerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match command failed.";
    return json({ error: message }, 400);
  }
}
