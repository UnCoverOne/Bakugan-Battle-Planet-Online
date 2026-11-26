import { applyDatabaseCardOverrides } from "./administration-server";
import { makeCanonicalPlayerWithRestrictions, type CanonicalPlayerSelection } from "./data";
import { initializeMatch } from "./engine/reducer";
import type { EngineBackedMatchState } from "./engine/types";
import { applyLobbyConfig, lobbyConfig, tagLobbyPlayerDeck, type LobbyConfig } from "./lobby-config";
import { startLobbyMatch } from "./lobby";
import { initializeRankedLobby, joinRankedLobby } from "./ranked-lobby";
import { digestMatchCapability, newMatchControllerId, secureMatchCapability } from "./match-seat-auth";
import { persistManagedSeries } from "./lobby-series-bridge";
import { loadPreparation, synchronizePreparation, projectPreparation, identityKey, type PreparationState } from "./lobby-preparation-server";
import type { LobbyIdentity } from "./lobby-session";
import { ConflictError, ValidationError, AuthorizationError } from "./server-errors";
import { withDeterministicRuntime } from "./engine/runtime";

const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function engineCode(){return Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>alphabet[v&31]).join("");}
const validCommandId=(id:unknown):id is string=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
export function initializePreparedSeries(room:PreparationState,code:string,commandId:string,issuedAt:number,seed:string) {
  const ruleset=room.preparation.ruleset;
  const selections=room.members.map(member=>(room.preparation.members[member.id]?.decks??[]).map(deck=>({playerId:member.id,name:member.name,deck}) satisfies CanonicalPlayerSelection));
  if(room.mode==="training"){
    if(!room.preparation.aiDeck)throw new ValidationError("No compatible AI deck");
    selections.push([{playerId:"training-bot",name:"Mira Nova • Training AI",deck:room.preparation.aiDeck}]);
  }
  if(selections.length!==2||selections.some(list=>list.length===0))throw new ConflictError("Incomplete preparation.");
  const players=selections.map(list=>{
    const selected=list[0];
    const player=tagLobbyPlayerDeck(makeCanonicalPlayerWithRestrictions(selected,ruleset?.restrictions??[],ruleset?.deckSize??50),selected.deck);
    player.ready=room.mode!=="ranked";
    return player;
  });
  const configuration:LobbyConfig={mode:room.mode,rulesFormat:room.configuration.format,meta:room.configuration.meta};
  return initializeMatch(code,room.configuration.structure,players,{
    commandId,actorId:room.ownId,issuedAt,randomSeed:seed,requestHash:`prepared:${room.id}:${room.version}`,
    configureInitialState: initial=>{
      let state=applyLobbyConfig(initial,configuration);
      if(room.mode==="ranked"){
        if(!ruleset||room.members.some(m=>!m.identity_key.startsWith("account:")))throw new ConflictError("Ranked account or ruleset unavailable.");
        const [host,guest]=room.members;
        state=initializeRankedLobby(state,host.id,host.identity_key.slice(8),host.name,selections[0],ruleset.version,ruleset.restrictions,ruleset.deckSize);
        state=joinRankedLobby(state,guest.id,guest.identity_key.slice(8),guest.name,selections[1],ruleset.restrictions);
        applyLobbyConfig(state,configuration);
        // Engine phase remains lobby for its existing ban/select rules. The
        // persistent lobby has already entered a series; routing must use the binding.
        state.stepLabel="Ranked deck bans";
      }else state=startLobbyMatch(state,room.ownId);
      return state;
    },
  });
}
export async function startPreparedSeries(database:D1Database,identity:LobbyIdentity,body:Record<string,unknown>) {
  if(!validCommandId(body.commandId))throw new ValidationError("Invalid start command.");
  const commandId=body.commandId;
  await applyDatabaseCardOverrides(database);
  const room=await loadPreparation(database,identity);
  if(!room||room.ownId!==body.membershipId)throw new AuthorizationError("Verified lobby membership required.");
  // Retry before version/readiness checks; a response may have been lost.
  const table=room.mode==="training"?"lobby_training_series":"lobby_series_bindings";
  const hostColumn=room.mode==="training"?"membership_id":"host_member_id";
  const identityColumn=room.mode==="training"?"identity_key":"host_identity_key";
  const prior=await database.prepare(`SELECT id,status FROM ${table} WHERE lobby_id=? AND start_command_id=? AND ${hostColumn}=? AND ${identityColumn}=?`)
    .bind(room.id,commandId,room.ownId,identityKey(identity)).first<{id:string;status:string}>();
  if(prior)return {seriesId:prior.id,status:prior.status};
  if(body.expectedVersion!==room.version||room.currentSeriesId)throw new ConflictError("Lobby changed. Refresh and retry.");
  if(room.members[0]?.id!==room.ownId)throw new AuthorizationError("Only the host can start.");
  const synchronized=await synchronizePreparation(database,identity,room);
  if(synchronized.version!==room.version||!projectPreparation(room).canStart)throw new ConflictError("Both players must be ready with compatible decks.");
  for(let attempt=0;attempt<12;attempt++){
    const code=engineCode(),at=Date.now(),seed=secureMatchCapability(32);
    if(code===room.code)continue;
    const exists=await database.prepare("SELECT code FROM matches WHERE code=? UNION SELECT match_code AS code FROM lobby_series_bindings WHERE match_code=?").bind(code,code).first();
    if(exists)continue;
    const initialized=withDeterministicRuntime({now:at,randomSeed:seed},()=>initializePreparedSeries(room,code,commandId,at,seed));
    try{
      if(room.mode==="training"){
        await database.prepare(`INSERT INTO lobby_training_series (id,lobby_id,membership_id,start_command_id,expected_lobby_version,identity_key,state_json,status,created_at)
          VALUES (?,?,?,?,?,?,?,'active',?)`).bind(initialized.state.id,room.id,room.ownId,commandId,room.version,identityKey(identity),JSON.stringify(initialized.state),at).run();
        return {seriesId:initialized.state.id,status:"active"};
      }
      const seats=await Promise.all(room.members.map(async m=>({membershipId:m.id,playerId:m.id,capabilityHash:await digestMatchCapability(secureMatchCapability(32)),controllerId:newMatchControllerId(),createdAt:at})));
      const binding=await persistManagedSeries(database,{lobbyId:room.id,expectedLobbyVersion:room.version,hostMemberId:room.ownId,hostIdentity:identity,startCommandId:commandId,initialized,seats});
      // No raw capability is retained or returned for the opponent. Each member
      // must recover their own controller via the authenticated claim path.
      return {seriesId:binding.id,status:binding.status};
    }catch(error){
      const existing=await database.prepare(`SELECT id,status FROM ${table} WHERE lobby_id=? AND start_command_id=? AND ${hostColumn}=? AND ${identityColumn}=?`)
        .bind(room.id,commandId,room.ownId,identityKey(identity)).first<{id:string;status:string}>();
      if(existing)return {seriesId:existing.id,status:existing.status};
      if(error instanceof Error&&/UNIQUE constraint failed: (matches.code|lobby_series_bindings.match_code)/.test(error.message))continue;
      if(error instanceof Error&&/LOBBY_(PREPARATION_CHANGED|SERIES_START_CONFLICT|TRAINING_START_CONFLICT)/.test(error.message))throw new ConflictError("Lobby changed. Refresh and retry.");
      throw error;
    }
  }
  throw new ConflictError("Could not allocate a series. Retry.");
}

/** Private local Training recovery. Its checkpoints are not trusted online
 * match records or a source of Ranked BP. Only the owning member can read/write. */
export async function trainingCheckpoint(database:D1Database,identity:LobbyIdentity,body:Record<string,unknown>) {
  const room=await loadPreparation(database,identity);
  if(!room||room.mode!=="training"||room.ownId!==body.membershipId||!room.currentSeriesId||room.currentSeriesId!==body.seriesId)throw new AuthorizationError("Active Training membership required.");
  const seat=room.members.find(m=>m.id===room.ownId)!;
  if(seat.expires_at<=Date.now())throw new ConflictError("Training membership expired.");
  const row=await database.prepare("SELECT state_json,revision,status FROM lobby_training_series WHERE id=? AND membership_id=? AND identity_key=? AND status='active'")
    .bind(room.currentSeriesId,room.ownId,identityKey(identity)).first<{state_json:string;revision:number;status:string}>();
  if(!row)throw new ConflictError("Training series changed.");
  if(body.action==="recover-training")return {seriesId:room.currentSeriesId,revision:row.revision,state:JSON.parse(row.state_json)};
  const state=body.state as EngineBackedMatchState|undefined;
  const previous=JSON.parse(row.state_json) as EngineBackedMatchState;
  if(!state||typeof state!=="object"||state.id!==previous.id||state.code!==previous.code||state.format!==previous.format||
    !Array.isArray(state.players)||state.players.length!==2||state.players[0]?.id!==room.ownId||state.players[1]?.id!=="training-bot"||
    !Number.isSafeInteger(state.version)||state.version<previous.version||body.expectedRevision!==row.revision||
    JSON.stringify(lobbyConfig(state))!==JSON.stringify(lobbyConfig(previous)))throw new ConflictError("Invalid or stale Training checkpoint.");
  const completed=body.action==="complete-training";
  const target=state.format==="bo3"?2:1;
  if(completed&&(state.phase!=="result"||!state.players.some(p=>p.id===state.winner)||
    !Number.isInteger(state.series?.[state.winner])||state.series[state.winner]!==target||
    !state.players.every(p=>Number.isInteger(state.series?.[p.id])&&state.series[p.id]>=0&&state.series[p.id]<=target)))throw new ValidationError("Training series is not complete.");
  const now=Date.now();
  const result=await database.prepare(`UPDATE lobby_training_series SET state_json=?,revision=revision+1,status=?,ended_at=?
    WHERE id=? AND revision=? AND identity_key=? AND status='active' AND EXISTS(
      SELECT 1 FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id WHERE m.id=lobby_training_series.membership_id
      AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>? AND l.current_series_id=lobby_training_series.id)`)
    .bind(JSON.stringify(state),completed?"completed":"active",completed?now:null,room.currentSeriesId,row.revision,identityKey(identity),identityKey(identity),now).run();
  if(Number(result.meta?.changes??0)!==1)throw new ConflictError("Training checkpoint changed.");
  return {seriesId:room.currentSeriesId,revision:row.revision+1,status:completed?"completed":"active"};
}
