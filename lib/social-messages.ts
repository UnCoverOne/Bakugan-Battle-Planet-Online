export const MESSAGE_MAX_LENGTH=2000;
export const MESSAGE_PAGE_SIZE=50;
export type DirectMessage={id:number;senderId:string;recipientId:string;body:string;createdAt:number};
export type ConversationSummary={peerId:string;latest:DirectMessage;unread:number};
export type MessageInbox={conversations:ConversationSummary[];blockedIds:string[];unreadCount:number};
export type MessageThread={messages:DirectMessage[];hasOlder:boolean;canSend:boolean;blockedByViewer:boolean};
export const EMPTY_INBOX:MessageInbox={conversations:[],blockedIds:[],unreadCount:0};
export function normalizeMessage(value:unknown){
 return typeof value==="string"?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").trim():"";
}
export function mergeMessages(current:DirectMessage[],incoming:DirectMessage[]){
 const byId=new Map(current.map(m=>[m.id,m]));
 for(const m of incoming)byId.set(m.id,m);
 return [...byId.values()].sort((a,b)=>a.id-b.id);
}
