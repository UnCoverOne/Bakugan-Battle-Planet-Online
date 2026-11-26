import { applyDatabaseCardOverrides, listAiDecks } from "./administration-server";
import { preferredAiDeckCandidates } from "./ai-meta-selection";
import { getActiveRankedRuleset } from "./ranked-server";
import { trainingOpponentDeck } from "./training-lobby";
import { validateDeck, type DeckRecord } from "./data";
import { DEFAULT_META, isLobbyMeta } from "./meta-formats";
import { createLobbySessionService } from "./lobby-session-server";
import { LOBBY_DISCONNECTED_AFTER_MS, type LobbyConfiguration, type LobbyIdentity, type LobbyMode } from "./lobby-session";
import { canonicalLobbyDeck, clearPreparationReadiness, deckPreview, deckProblem, emptyPreparedMember, requiredDeckCount, rosterProblem, type LobbyPreparation } from "./lobby-preparation";
import { ConflictError, ValidationError, AuthorizationError } from "./server-errors";

type Seat = { id:string; identity_key:string; name:string; last_seen_at:number; expires_at:number };
type Row = { id:string;code:string;mode:LobbyMode;version:number;configuration_json:string;preparation_json:string;current_series_id:string|null;own_id:string;members_json:string };
export type PreparationState = { id:string;code:string;mode:LobbyMode;version:number;configuration:LobbyConfiguration;preparation:LobbyPreparation;currentSeriesId:string|null;ownId:string;members:Seat[] };
export const identityKey = (identity:LobbyIdentity) => `${identity.kind}:${identity.id}`;

export async function loadPreparation(database:D1Database,identity:LobbyIdentity):Promise<PreparationState|null> {
  const row=await database.prepare(`SELECT l.id,l.code,l.mode,l.version,l.configuration_json,l.preparation_json,l.current_series_id,own.id AS own_id,
    (SELECT json_group_array(json_object('id',m.id,'identity_key',m.identity_key,'name',m.name,'last_seen_at',m.last_seen_at,'expires_at',m.expires_at))
      FROM (SELECT m.*,COALESCE(u.display_name,'Brawler ' || (SELECT COUNT(*) FROM lobby_memberships p WHERE p.lobby_id=m.lobby_id AND p.left_at IS NULL AND p.sequence<=m.sequence)) AS name
        FROM lobby_memberships m LEFT JOIN users u ON m.identity_key='account:' || u.id
        WHERE m.lobby_id=l.id AND m.left_at IS NULL ORDER BY m.sequence) m) AS members_json
    FROM lobby_sessions l JOIN lobby_memberships own ON own.lobby_id=l.id
    WHERE own.identity_key=? AND own.left_at IS NULL AND l.closed_at IS NULL`).bind(identityKey(identity)).first<Row>();
  if(!row)return null;
  return {id:row.id,code:row.code,mode:row.mode,version:row.version,configuration:JSON.parse(row.configuration_json),preparation:JSON.parse(row.preparation_json),
    currentSeriesId:row.current_series_id,ownId:row.own_id,members:JSON.parse(row.members_json)};
}
export async function writePreparation(database:D1Database,identity:LobbyIdentity,room:PreparationState,preparation:LobbyPreparation,configuration=room.configuration, now=Date.now(),hostOnly=false) {
  const result=await database.prepare(`UPDATE lobby_sessions SET preparation_json=?,configuration_json=?,version=version+1
    WHERE id=? AND version=? AND closed_at IS NULL AND current_series_id IS NULL
      AND EXISTS(SELECT 1 FROM lobby_memberships m WHERE m.lobby_id=lobby_sessions.id AND m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>?
        AND (?=0 OR m.sequence=(SELECT MIN(sequence) FROM lobby_memberships WHERE lobby_id=lobby_sessions.id AND left_at IS NULL)))`)
    .bind(JSON.stringify(preparation),JSON.stringify(configuration),room.id,room.version,room.ownId,identityKey(identity),now,hostOnly?1:0).run();
  if(Number(result.meta?.changes??0)!==1)throw new ConflictError("Lobby changed. Refresh and retry.");
}
async function automaticTrainingDeck(database:D1Database,configuration:LobbyConfiguration):Promise<DeckRecord|null> {
  const pool=(await listAiDecks(database)).filter(item=>item.enabled && (item.deck.format??"standard")==="standard" && validateDeck(item.deck).isLegal).map(item=>item.deck);
  const remaining=[...pool];
  while(remaining.length){
    const preferred=preferredAiDeckCandidates(remaining,configuration.meta);
    if(!preferred.length)break;
    const candidate=preferred[crypto.getRandomValues(new Uint32Array(1))[0]%preferred.length];
    remaining.splice(remaining.indexOf(candidate),1);
    try {
      const deck=canonicalLobbyDeck(trainingOpponentDeck(configuration.format,candidate,configuration.meta),"training-bot");
      if(!deckProblem(deck,configuration,null))return deck;
    } catch { /* try another enabled deck, never an illegal fallback */ }
  }
  return null;
}
/** Initialize bot/rules automatically, with no public bot-selection command.
 * Ruleset updates clear readiness; decks remain selected for revalidation. */
export async function synchronizePreparation(database:D1Database,identity:LobbyIdentity,room:PreparationState) {
  if(room.currentSeriesId)return room;
  let next=room.preparation;
  let configuration=room.configuration;
  if(room.mode==="ranked"){
    const ruleset=await getActiveRankedRuleset(database);
    if(next.ruleset?.version!==ruleset.version || next.ruleset.deckSize!==ruleset.deckSize){
      configuration={structure:"bo3",format:"competitive",meta:DEFAULT_META};
      next={...clearPreparationReadiness(next),ruleset};
    }
  } else if(room.mode==="training" && (!next.aiDeck || deckProblem(next.aiDeck,configuration,null))){
    const aiDeck=await automaticTrainingDeck(database,configuration);
    if(aiDeck || next.aiDeck)next={...clearPreparationReadiness(next),aiDeck};
  }
  if(next!==room.preparation){
    await writePreparation(database,identity,room,next,configuration);
    const updated=await loadPreparation(database,identity);
    if(!updated)throw new ConflictError("Lobby membership changed.");
    return updated;
  }
  return room;
}
export function projectPreparation(room:PreparationState,now=Date.now()) {
  const ranked=room.mode==="ranked";
  const seats=room.members.map(member=>{
    const own=member.id===room.ownId;
    const prepared=room.preparation.members[member.id]??emptyPreparedMember();
    const connected=member.expires_at>now && now-member.last_seen_at<LOBBY_DISCONNECTED_AFTER_MS;
    const problem=own ? rosterProblem(prepared.decks,room.mode,room.configuration,room.preparation.ruleset) : null;
    return {membershipId:member.id,name:member.name,own,host:member.id===room.members[0]?.id,connected,
      ready:connected&&prepared.ready,deckCount:prepared.decks.length,
      decks:own ? prepared.decks : ranked ? [] : prepared.decks.map(deckPreview),
      ...(own?{problem,deckProblems:prepared.decks.map(d=>deckProblem(d,room.configuration,room.preparation.ruleset))}:{}),
    };
  });
  const ai=room.preparation.aiDeck;
  const aiReady=room.mode==="training" && Boolean(ai&&!deckProblem(ai,room.configuration,null));
  const required=room.mode==="training"?1:2;
  const canStart=!room.currentSeriesId&&room.members.length===required&&seats.every(s=>s.ready&&s.deckCount===requiredDeckCount(room.mode))&&
    room.members.every(m=>!rosterProblem(room.preparation.members[m.id]?.decks??[],room.mode,room.configuration,room.preparation.ruleset))&&(room.mode!=="training"||aiReady);
  return {version:room.version,configuration:room.configuration,seats,requiredDeckCount:requiredDeckCount(room.mode),
    canStart:canStart&&room.ownId===room.members[0]?.id,
    ai:room.mode==="training"?{name:"Mira Nova",ready:aiReady,deck:ai?deckPreview(ai):null}:null,
    ruleset:ranked&&room.preparation.ruleset?{version:room.preparation.ruleset.version,deckSize:room.preparation.ruleset.deckSize,restrictions:room.preparation.ruleset.restrictions,publishedAt:room.preparation.ruleset.publishedAt}:null};
}
export async function prepareRecovery(database:D1Database,identity:LobbyIdentity) {
  const room=await loadPreparation(database,identity);
  if(!room)return null;
  // Recovery is read-only. Initialization is performed by explicit sync, not
  // every heartbeat, and failed AI selection never prevents lobby admission.
  return projectPreparation(room);
}
export async function executePreparationCommand(database:D1Database,identity:LobbyIdentity,body:Record<string,unknown>) {
  await createLobbySessionService(database).expire();
  await applyDatabaseCardOverrides(database);
  const room=await loadPreparation(database,identity);
  if(!room||body.membershipId!==room.ownId)throw new AuthorizationError("Verified lobby membership required.");
  if(room.currentSeriesId)throw new ConflictError("Preparation is locked during a series.");
  if(body.action==="sync-preparation")return projectPreparation(await synchronizePreparation(database,identity,room));
  if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==room.version)throw new ConflictError("Lobby changed. Refresh and retry.");
  const synchronized=await synchronizePreparation(database,identity,room);
  if(synchronized.version!==room.version)throw new ConflictError("Lobby rules or AI assignment changed. Refresh and retry.");
  const own=room.preparation.members[room.ownId]??emptyPreparedMember();
  let next=room.preparation,configuration=room.configuration;
  if(body.action==="select-decks"){
    if(!Array.isArray(body.decks)||body.decks.length>requiredDeckCount(room.mode))throw new ValidationError("Invalid deck selection.");
    let decks:DeckRecord[];
    try{decks=body.decks.map(d=>canonicalLobbyDeck(d,room.ownId));}catch(error){throw new ValidationError(error instanceof Error?error.message:"Invalid deck");}
    const problem=rosterProblem(decks,room.mode,configuration,next.ruleset,false);
    if(problem)throw new ValidationError(problem);
    next={...next,members:{...next.members,[room.ownId]:{decks,ready:false}}};
  }else if(body.action==="set-ready"){
    if(typeof body.ready!=="boolean")throw new ValidationError("Invalid readiness.");
    if(body.ready){
      const problem=rosterProblem(own.decks,room.mode,configuration,next.ruleset);
      if(problem)throw new ValidationError(problem);
      const seat=room.members.find(m=>m.id===room.ownId)!;
      if(Date.now()-seat.last_seen_at>=LOBBY_DISCONNECTED_AFTER_MS)throw new ConflictError("Reconnect before readying.");
      if(room.mode==="training"&&(!next.aiDeck||deckProblem(next.aiDeck,configuration,null)))throw new ValidationError("No compatible AI deck");
    }
    next={...next,members:{...next.members,[room.ownId]:{...own,ready:body.ready}}};
  }else if(body.action==="update-settings"){
    if(room.members[0]?.id!==room.ownId||room.mode==="ranked")throw new AuthorizationError("These settings are locked.");
    if((body.structure!=="bo1"&&body.structure!=="bo3")||(body.format!=="standard"&&body.format!=="singleton")||!isLobbyMeta(body.meta))throw new ValidationError("Invalid lobby settings.");
    configuration={structure:body.structure,format:body.format,meta:body.meta};
    if(JSON.stringify(configuration)===JSON.stringify(room.configuration))return projectPreparation(room);
    next=clearPreparationReadiness(next);
    if(room.mode==="training"&&(configuration.format!==room.configuration.format||configuration.meta!==room.configuration.meta))
      next={...next,aiDeck:await automaticTrainingDeck(database,configuration)};
  }else throw new ValidationError("Unknown preparation command.");
  await writePreparation(database,identity,room,next,configuration,Date.now(),body.action==="update-settings");
  const updated=await loadPreparation(database,identity);
  if(!updated)throw new ConflictError("Lobby membership changed.");
  return projectPreparation(updated);
}
