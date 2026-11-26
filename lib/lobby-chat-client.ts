export type LobbyChatMessage = { id:number; kind:"chat"|"system"; playerId:string|null; author:string; message:string; at:number };
export type LobbyChatPage = { membershipId:string; lobbyId:string; systemOnly:boolean; messages:LobbyChatMessage[]; hasOlder:boolean; readThrough:number; latest:number; unread:number };
/** A newest-page poll may overlap previously loaded pages. Keep older pages
 * when contiguous; on a gap reset to the new tail and offer older history. */
export function mergeLobbyChatPage(previous:LobbyChatPage|null,incoming:LobbyChatPage,older=false):LobbyChatPage {
  if(!previous||previous.membershipId!==incoming.membershipId||previous.lobbyId!==incoming.lobbyId)return incoming;
  const ids=new Set(previous.messages.map(message=>message.id));
  const overlap=incoming.messages.some(message=>ids.has(message.id));
  const contiguous=older||overlap||incoming.messages.length===0||previous.messages.length===0;
  if(!contiguous)return incoming;
  const messages=[...new Map([...previous.messages,...incoming.messages].map(message=>[message.id,message])).values()].sort((a,b)=>a.id-b.id);
  // Retain the newest 600 rendered entries. Older server history remains available.
  const limit=older?Math.max(600,messages.length):600;
  return {...incoming,messages:messages.slice(-limit),hasOlder:messages.length>limit||(older?incoming.hasOlder:previous.hasOlder||incoming.hasOlder),
    readThrough:Math.max(previous.readThrough,incoming.readThrough)};
}
