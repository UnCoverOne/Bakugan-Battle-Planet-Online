import type { LobbyIdentity } from "./lobby-session";
import { authenticateMatchSeat, digestMatchCapability, newMatchControllerId, secureMatchCapability, MATCH_CAPABILITY_HEADER, MATCH_CONTROLLER_HEADER } from "./match-seat-auth";
import { normalizeMatchState, type MatchState } from "./game";
import { projectMatchForPlayer } from "./engine/projection";
import { isCompletedSeriesResult } from "./match-result-navigation";
import { hydrateManagedPresence } from "./lobby-series-access";
import { AuthorizationError, ConflictError, ValidationError } from "./server-errors";

type ActiveSeat = { code:string; series_id:string; player_id:string; capability_version:number; state_json:string };
const identityKey=(identity:LobbyIdentity)=>`${identity.kind}:${identity.id}`;
export async function activeManagedSeat(database:D1Database,identity:LobbyIdentity,membershipId:string,seriesId?:string,now=Date.now()) {
  return database.prepare(`SELECT b.match_code AS code,b.id AS series_id,s.player_id,c.capability_version,g.state_json
    FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
    JOIN lobby_series_bindings b ON b.id=l.current_series_id AND b.status='active'
    JOIN lobby_series_seats s ON s.series_id=b.id AND s.membership_id=m.id
    JOIN match_seats c ON c.code=b.match_code AND c.player_id=s.player_id
    JOIN matches g ON g.code=b.match_code
    WHERE m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>?
      AND l.closed_at IS NULL AND (? IS NULL OR b.id=?)
      AND NOT EXISTS(SELECT 1 FROM lobby_series_departures d WHERE d.series_id=b.id AND d.membership_id=m.id)`)
    .bind(membershipId,identityKey(identity),now,seriesId??null,seriesId??null).first<ActiveSeat>();
}
export async function controllerOffer(database:D1Database,identity:LobbyIdentity,membershipId:string,seriesId:string) {
  const seat=await activeManagedSeat(database,identity,membershipId,seriesId);
  return seat?{seriesId:seat.series_id,capabilityVersion:seat.capability_version}:null;
}
/** Call within the room coordinator's serialized mutation. Never rotate
 * based only on a client-supplied player ID or engine code. */
export async function claimManagedController(database:D1Database,request:Request,identity:LobbyIdentity,body:Record<string,unknown>,code:string,hasActiveSocket:(playerId:string,version:number)=>boolean) {
  if(typeof body.membershipId!=="string"||typeof body.seriesId!=="string"||!Number.isSafeInteger(body.expectedCapabilityVersion))
    throw new ValidationError("Invalid controller claim.");
  const seat=await activeManagedSeat(database,identity,body.membershipId,body.seriesId);
  if(!seat||seat.code!==code)throw new AuthorizationError("Active series membership required.");
  const state=normalizeMatchState(JSON.parse(seat.state_json) as MatchState);
  if(state.id!==seat.series_id||isCompletedSeriesResult(state))throw new ConflictError("This series has completed.");
  if(!state.players.some(p=>p.id===seat.player_id))throw new ConflictError("Series seat unavailable.");
  await hydrateManagedPresence(database,state);
  // A tab with valid credentials need not rotate them on each return.
  const current=await authenticateMatchSeat(database,request,code,seat.player_id);
  if(current)return {state,playerId:seat.player_id,capability:request.headers.get(MATCH_CAPABILITY_HEADER)!,controllerId:request.headers.get(MATCH_CONTROLLER_HEADER)!,capabilityVersion:current.capability_version,rotated:false};
  if(body.expectedCapabilityVersion!==seat.capability_version)throw new ConflictError("Controller changed. Refresh and retry.");
  if(hasActiveSocket(seat.player_id,seat.capability_version)&&body.takeover!==true)throw new ConflictError("Game is active on another device. Confirm takeover to continue.");
  const capability=secureMatchCapability(32),controllerId=newMatchControllerId(),now=Date.now();
  const result=await database.prepare(`UPDATE match_seats SET capability_hash=?,controller_id=?,capability_version=capability_version+1,claimed_at=?
    WHERE code=? AND player_id=? AND capability_version=? AND EXISTS(
      SELECT 1 FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
      JOIN lobby_series_bindings b ON b.id=l.current_series_id AND b.status='active'
      JOIN lobby_series_seats s ON s.series_id=b.id AND s.membership_id=m.id
      WHERE m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>? AND b.id=? AND b.match_code=match_seats.code
        AND s.player_id=match_seats.player_id AND NOT EXISTS(SELECT 1 FROM lobby_series_departures d WHERE d.series_id=b.id AND d.membership_id=m.id))`)
    .bind(await digestMatchCapability(capability),controllerId,now,code,seat.player_id,seat.capability_version,body.membershipId,identityKey(identity),now,seat.series_id).run();
  if(Number(result.meta?.changes??0)!==1)throw new ConflictError("Controller or membership changed. Refresh and retry.");
  return {state,playerId:seat.player_id,capability,controllerId,capabilityVersion:seat.capability_version+1,rotated:true};
}
export function publicControllerClaim(claim:Awaited<ReturnType<typeof claimManagedController>>) {
  return {playerId:claim.playerId,capability:claim.capability,controllerId:claim.controllerId,capabilityVersion:claim.capabilityVersion,state:projectMatchForPlayer(claim.state,claim.playerId)};
}
