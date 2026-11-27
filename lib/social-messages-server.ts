import type {AccountDatabase} from "./account-server";
import {AuthorizationError,ConflictError,ValidationError} from "./server-errors";
import {MESSAGE_MAX_LENGTH,MESSAGE_PAGE_SIZE,normalizeMessage,type DirectMessage,type MessageInbox,type MessageThread} from "./social-messages";
type Row={id:number;sender_id:string;recipient_id:string;body:string;created_at:number};
const convert=(r:Row):DirectMessage=>({id:r.id,senderId:r.sender_id,recipientId:r.recipient_id,body:r.body,createdAt:r.created_at});
const visible=(column:string)=>`EXISTS(SELECT 1 FROM users u WHERE u.id=${column} AND NOT EXISTS(SELECT 1 FROM account_bans b WHERE b.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM social_hidden_accounts h WHERE h.user_id=u.id))`;
const pair="(sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)";
async function requirePeer(db:AccountDatabase,viewer:string,peer:string){
 if(!peer||viewer===peer)throw new ValidationError("Choose another Brawler.");
 for(const id of [viewer,peer]){
  const row=await db.prepare(`SELECT 1 WHERE ${visible("?")}`).bind(id).first();
  if(!row)throw new AuthorizationError("This conversation is unavailable.");
 }
}
async function blockState(db:AccountDatabase,viewer:string,peer:string){
 const rows=await db.prepare("SELECT blocker_id FROM social_message_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").bind(viewer,peer,peer,viewer).all<{blocker_id:string}>();
 return {canSend:!rows.results?.length,blockedByViewer:Boolean(rows.results?.some(r=>r.blocker_id===viewer))};
}
export async function messageInbox(db:AccountDatabase,viewer:string):Promise<MessageInbox>{
 const [rows,blocks]=await Promise.all([
 db.prepare(`WITH peers AS (
 SELECT recipient_id AS peer,id,0 AS unread FROM social_messages WHERE sender_id=?
 UNION ALL SELECT sender_id AS peer,id,CASE WHEN read_at IS NULL THEN 1 ELSE 0 END AS unread FROM social_messages WHERE recipient_id=?
 ),latest AS (SELECT peer,MAX(id) AS latest_id,SUM(unread) AS unread FROM peers GROUP BY peer)
 SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,l.peer,l.unread FROM latest l JOIN social_messages m ON m.id=l.latest_id WHERE ${visible("l.peer")} AND ${visible("?")} ORDER BY m.id DESC`).bind(viewer,viewer,viewer).all<Row&{peer:string;unread:number}>(),
 db.prepare("SELECT blocked_id FROM social_message_blocks WHERE blocker_id=?").bind(viewer).all<{blocked_id:string}>()
 ]);
 const conversations=(rows.results??[]).map(r=>({peerId:r.peer,latest:convert(r),unread:Number(r.unread)}));
 return {conversations,blockedIds:(blocks.results??[]).map(r=>r.blocked_id),unreadCount:conversations.reduce((n,c)=>n+c.unread,0)};
}
export async function messageThread(db:AccountDatabase,viewer:string,peer:string,before?:number):Promise<MessageThread>{
 await requirePeer(db,viewer,peer);
 const [rows,state]=await Promise.all([
 db.prepare(`SELECT id,sender_id,recipient_id,body,created_at FROM social_messages WHERE (${pair}) AND id<? ORDER BY id DESC LIMIT ?`).bind(viewer,peer,peer,viewer,before??Number.MAX_SAFE_INTEGER,MESSAGE_PAGE_SIZE+1).all<Row>(),
 blockState(db,viewer,peer)]);
 const result=rows.results??[];
 return {messages:result.slice(0,MESSAGE_PAGE_SIZE).reverse().map(convert),hasOlder:result.length>MESSAGE_PAGE_SIZE,...state};
}
export async function sendDirectMessage(db:AccountDatabase,viewer:string,peer:string,raw:unknown,clientId:string){
 await requirePeer(db,viewer,peer);
 const body=normalizeMessage(raw);
 if(!body||body.length>MESSAGE_MAX_LENGTH)throw new ValidationError("Write between 1 and 2,000 characters.");
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(clientId))throw new ValidationError("Invalid message identifier.");
 const existing=()=>db.prepare("SELECT id,sender_id,recipient_id,body,created_at FROM social_messages WHERE sender_id=? AND client_id=?").bind(viewer,clientId).first<Row>();
 let row=await existing();
 if(!row){
  await db.prepare(`INSERT OR IGNORE INTO social_messages(sender_id,recipient_id,client_id,body,created_at)
  SELECT ?,?,?,?,? WHERE ${visible("?")} AND ${visible("?")} AND NOT EXISTS(SELECT 1 FROM social_message_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?))`).bind(viewer,peer,clientId,body,Date.now(),viewer,peer,viewer,peer,peer,viewer).run();
  row=await existing();
 }
 if(!row)throw new AuthorizationError("This conversation is not accepting messages.");
 if(row.recipient_id!==peer||row.body!==body)throw new ConflictError("That message identifier has already been used.");
 return convert(row);
}
export async function markMessagesRead(db:AccountDatabase,viewer:string,peer:string,through:number){
 await requirePeer(db,viewer,peer);
 const result=await db.prepare("UPDATE social_messages SET read_at=? WHERE recipient_id=? AND sender_id=? AND id<=? AND read_at IS NULL").bind(Date.now(),viewer,peer,through).run();
 return Number(result.meta.changes??0);
}
export async function setMessageBlock(db:AccountDatabase,viewer:string,peer:string,blocked:boolean){
 await requirePeer(db,viewer,peer);
 if(blocked)await db.batch([
 db.prepare("INSERT OR IGNORE INTO social_message_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").bind(viewer,peer,Date.now()),
 db.prepare("UPDATE social_messages SET read_at=? WHERE recipient_id=? AND sender_id=? AND read_at IS NULL").bind(Date.now(),viewer,peer)]);
 else await db.prepare("DELETE FROM social_message_blocks WHERE blocker_id=? AND blocked_id=?").bind(viewer,peer).run();
}
export async function reportMessagePeer(db:AccountDatabase,viewer:string,peer:string,reason:unknown){
 await requirePeer(db,viewer,peer);
 const details=normalizeMessage(reason);
 if(details.length<20||details.length>1800)throw new ValidationError("Describe the issue in 20–1,800 characters.");
 const now=Date.now();
 // Submit only the reporter's explicit description to the existing feedback queue.
 await db.prepare("INSERT INTO feedback_reports(id,user_id,kind,message,source_url,submitted_at,updated_at) VALUES(?,?,'issue',?,?,?,?)").bind(crypto.randomUUID(),viewer,`Brawler report (account ${peer}):\n${details}`,`/brawlers/${encodeURIComponent(peer)}`,now,now).run();
}
