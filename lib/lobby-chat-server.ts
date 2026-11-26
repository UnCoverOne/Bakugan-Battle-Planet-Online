import { LOBBY_DISCONNECTED_AFTER_MS, type LobbyIdentity } from "./lobby-session";
import { normalizeChatMessage } from "./chat";
import { AuthorizationError, ConflictError, RateLimitError, ValidationError } from "./server-errors";

const PAGE_SIZE=60;
type Seat={lobby_id:string;mode:string;visible_from:number;read_through:number};
type MessageRow={sequence:number;membership_id:string|null;kind:"chat"|"system";author:string;message:string;created_at:number};
const key=(identity:LobbyIdentity)=>`${identity.kind}:${identity.id}`;
const activePredicate=`m.id=? AND m.identity_key=? AND m.left_at IS NULL AND m.expires_at>? AND l.closed_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM lobby_series_departures d WHERE d.series_id=l.current_series_id AND d.membership_id=m.id)`;
async function seatFor(database:D1Database,identity:LobbyIdentity,membershipId:string,now:number) {
  const seat=await database.prepare(`SELECT m.lobby_id,l.mode,c.visible_from,c.read_through
    FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id JOIN lobby_chat_cursors c ON c.membership_id=m.id
    WHERE ${activePredicate}`).bind(membershipId,key(identity),now).first<Seat>();
  if(!seat)throw new AuthorizationError("Active lobby membership required.");
  return seat;
}
export async function readLobbyChat(database:D1Database,identity:LobbyIdentity,membershipId:string,before?:number,now=Date.now()) {
  const seat=await seatFor(database,identity,membershipId,now);
  // Observe another member's absence once. Heartbeats restore the connection
  // flag transactionally; a page or gameplay socket change does not do so.
  await database.prepare(`UPDATE lobby_chat_cursors SET connected=0,observed_at=?
    WHERE connected=1 AND membership_id IN (SELECT id FROM lobby_memberships
      WHERE lobby_id=? AND left_at IS NULL AND last_seen_at<=? AND expires_at>?)`)
    .bind(now,seat.lobby_id,now-LOBBY_DISCONNECTED_AFTER_MS,now).run();
  const results=await database.batch([
    database.prepare(`SELECT sequence,membership_id,kind,author,message,created_at FROM lobby_chat_messages
      WHERE lobby_id=? AND sequence>=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?`)
      .bind(seat.lobby_id,seat.visible_from,before??null,before??null,PAGE_SIZE+1),
    database.prepare(`SELECT c.read_through AS readThrough,
      COALESCE(MAX(msg.sequence),0) AS latest,
      COALESCE(SUM(CASE WHEN msg.sequence>c.read_through AND (msg.kind='system' OR msg.membership_id<>m.id) THEN 1 ELSE 0 END),0) AS unread
      FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id JOIN lobby_chat_cursors c ON c.membership_id=m.id
      LEFT JOIN lobby_chat_messages msg ON msg.lobby_id=m.lobby_id AND msg.sequence>=c.visible_from
      WHERE ${activePredicate} GROUP BY m.id,c.read_through`).bind(membershipId,key(identity),now),
  ]);
  const summary=results[1].results?.[0] as {readThrough:number;latest:number;unread:number}|undefined;
  if(!summary)throw new AuthorizationError("Lobby membership ended.");
  const rows=(results[0].results??[]) as MessageRow[];
  return {membershipId,lobbyId:seat.lobby_id,systemOnly:seat.mode==="training",
    messages:rows.slice(0,PAGE_SIZE).reverse().map(row=>({id:row.sequence,kind:row.kind,playerId:row.membership_id,author:row.author,message:row.message,at:row.created_at})),
    hasOlder:rows.length>PAGE_SIZE,...summary};
}
export async function sendLobbyChat(database:D1Database,identity:LobbyIdentity,membershipId:string,commandId:string,raw:unknown,now=Date.now()) {
  const seat=await seatFor(database,identity,membershipId,now);
  if(seat.mode==="training")throw new AuthorizationError("Training chat displays system messages only.");
  if(typeof raw!=="string"||raw.length>2000||!/^[A-Za-z0-9_-]{1,128}$/.test(commandId))throw new ValidationError("Invalid chat message.");
  const message=normalizeChatMessage(raw);
  if(!message)throw new ValidationError("Enter a chat message.");
  const receipt=()=>database.prepare("SELECT sequence,message FROM lobby_chat_messages WHERE membership_id=? AND command_id=? AND kind='chat'")
    .bind(membershipId,commandId).first<{sequence:number;message:string}>();
  let prior=await receipt();
  if(!prior){
    try{
      await database.prepare(`INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at,command_id)
        SELECT m.lobby_id,m.id,'chat',n.name,?,?,? FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
        JOIN lobby_chat_member_names n ON n.id=m.id WHERE ${activePredicate} AND l.mode<>'training'
        AND NOT EXISTS(SELECT 1 FROM lobby_chat_messages WHERE membership_id=m.id AND command_id=?)`)
        .bind(message,now,commandId,membershipId,key(identity),now,commandId).run();
    }catch(error){
      const detail=error instanceof Error?error.message:"";
      if(detail.includes("LOBBY_CHAT_RATE_LIMIT"))throw new RateLimitError(60,"Too many chat messages. Try again shortly.");
      if(detail.includes("LOBBY_CHAT_FORBIDDEN"))throw new AuthorizationError("Active lobby membership required.");
      throw error;
    }
    prior=await receipt();
  }
  if(!prior)throw new ConflictError("Lobby changed before the message was sent.");
  if(prior.message!==message)throw new ConflictError("Chat command was already used for a different message.");
  return prior.sequence;
}
export async function markLobbyChatRead(database:D1Database,identity:LobbyIdentity,membershipId:string,through:number,now=Date.now()) {
  if(!Number.isSafeInteger(through)||through<1)throw new ValidationError("Invalid chat cursor.");
  const seat=await seatFor(database,identity,membershipId,now);
  const result=await database.prepare(`UPDATE lobby_chat_cursors SET read_through=MAX(read_through,?)
    WHERE membership_id=? AND EXISTS(SELECT 1 FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
      WHERE ${activePredicate}) AND EXISTS(SELECT 1 FROM lobby_chat_messages
      WHERE lobby_id=? AND sequence=? AND sequence>=lobby_chat_cursors.visible_from)`)
    .bind(through,membershipId,membershipId,key(identity),now,seat.lobby_id,through).run();
  if(Number(result.meta?.changes??0)!==1)throw new ConflictError("Chat cursor or membership changed.");
}
