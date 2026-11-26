import { isCompletedSeriesResult, type MatchResultSnapshot } from "./match-result-navigation";

type LegacyRow = { code: string; player_id: string; state_json: string; updated_at: number };
/** Read-only inventory for cutover. Completed legacy rooms are not assumed
 * to represent membership: the old system did not retain that distinction.
 * Unknown/invalid snapshots must be reconciled, not silently discarded. */
export async function inspectLegacyAccountSessions(database: D1Database, userId: string) {
  const result = await database.prepare(`SELECT a.code, a.player_id, m.state_json, m.updated_at
    FROM match_seat_accounts a JOIN match_seats s ON s.code = a.code AND s.player_id = a.player_id
    JOIN matches m ON m.code = a.code WHERE a.user_id = ? ORDER BY m.updated_at DESC, a.code, a.player_id`)
    .bind(userId).all<LegacyRow>();
  const candidates = (result.results ?? []).map(row => {
    let status: "unfinished" | "completed" | "unknown" = "unknown";
    try {
      const state = JSON.parse(row.state_json) as MatchResultSnapshot & { players?: { id: string }[] };
      if (state.players?.some(player => player.id === row.player_id) && typeof state.phase === "string") {
        status = isCompletedSeriesResult(state) ? "completed" : "unfinished";
      }
    } catch { /* retain as unknown */ }
    return { code: row.code, playerId: row.player_id, updatedAt: row.updated_at, status };
  });
  const unresolved = candidates.filter(candidate => candidate.status !== "completed");
  return { candidates, requiresExplicitResolution: unresolved.length > 1 || unresolved.some(candidate => candidate.status === "unknown") };
}

/** Global read-only cutover inventory. A malformed snapshot is a blocker,
 * never an implicitly completed match. Excludes managed engine codes. */
export async function inspectLegacyRooms(database:D1Database) {
  const result=await database.prepare(`SELECT m.code,m.state_json,m.updated_at FROM matches m
    WHERE NOT EXISTS(SELECT 1 FROM lobby_series_bindings b WHERE b.match_code=m.code)
    ORDER BY m.code`).all<{code:string;state_json:string;updated_at:number}>();
  let completed=0,unfinished=0,unknown=0;
  for(const row of result.results??[]){
    const status=legacyRoomStatus(row.state_json);
    if(status==="completed")completed++;else if(status==="unfinished")unfinished++;else unknown++;
  }
  return {completed,unfinished,unknown,ready:unfinished===0&&unknown===0};
}
export function legacyRoomStatus(raw:string):"completed"|"unfinished"|"unknown" {
  try{
    const state=JSON.parse(raw) as MatchResultSnapshot & {players?:{id:string}[]};
    if(!state||!Array.isArray(state.players)||!state.players.length||!state.players.every(p=>p&&typeof p.id==="string")||
      typeof state.phase!=="string"||!["bo1","bo3"].includes(state.format)||!state.series||typeof state.series!=="object")return "unknown";
    if(state.phase==="result"&&(!state.winner||!state.players.some(p=>p.id===state.winner)))return "unknown";
    return isCompletedSeriesResult(state)?"completed":"unfinished";
  }catch{return "unknown";}
}
