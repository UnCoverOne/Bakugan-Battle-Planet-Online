import type {LobbyIdentity} from "./lobby-session";
import {normalizeMatchState,type MatchState} from "./game";
import {projectMatchForPlayer} from "./engine/projection";
import {isCompletedSeriesResult} from "./match-result-navigation";
import {AuthorizationError,ConflictError} from "./server-errors";

export async function recoverLobbyResult(database:D1Database,identity:LobbyIdentity,membershipId:string,seriesId:string,now=Date.now()){
  const row=await database.prepare(`SELECT l.mode,g.state_json,s.player_id FROM lobby_memberships m
    JOIN lobby_sessions l ON l.id=m.lobby_id JOIN lobby_series_bindings b ON b.id=l.previous_series_id AND b.status='completed'
    JOIN lobby_series_seats s ON s.series_id=b.id AND s.membership_id=m.id
    JOIN matches g ON g.code=b.match_code
    WHERE m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>? AND l.closed_at IS NULL AND b.id=?`)
    .bind(membershipId,`${identity.kind}:${identity.id}`,now,seriesId).first<{mode:string;state_json:string;player_id:string}>();
  if(row){
    const state=normalizeMatchState(JSON.parse(row.state_json) as MatchState);
    if(state.id!==seriesId||!isCompletedSeriesResult(state))throw new ConflictError("Completed series snapshot unavailable.");
    return {seriesId,playerId:row.player_id,state:projectMatchForPlayer(state,row.player_id)};
  }
  const training=await database.prepare(`SELECT t.state_json FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
    JOIN lobby_training_series t ON t.id=l.previous_series_id AND t.membership_id=m.id AND t.status='completed'
    WHERE m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>? AND l.closed_at IS NULL AND t.id=?`)
    .bind(membershipId,`${identity.kind}:${identity.id}`,now,seriesId).first<{state_json:string}>();
  if(!training)throw new AuthorizationError("No completed result for this membership.");
  const state=normalizeMatchState(JSON.parse(training.state_json) as MatchState);
  if(state.id!==seriesId||!isCompletedSeriesResult(state))throw new ConflictError("Completed Training snapshot unavailable.");
  return {seriesId,playerId:membershipId,state};
}
