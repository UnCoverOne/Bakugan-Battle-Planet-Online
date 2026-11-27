import {getDatabase,getSessionUser} from "../../../../lib/account-server";
import {assertSameOrigin,enforceD1RateLimit,requestClientKey} from "../../../../lib/request-security";
import {AuthenticationError,ValidationError,serverErrorResponse} from "../../../../lib/server-errors";
import {notifySocialUsers} from "../../../../lib/social-presence-server";
import {markMessagesRead,messageInbox,messageThread,reportMessagePeer,sendDirectMessage,setMessageBlock} from "../../../../lib/social-messages-server";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
function peer(value:unknown){
 if(typeof value!=="string"||!value.trim()||value.length>100)throw new ValidationError("Choose a Brawler.");
 return value.trim();
}
function cursor(value:unknown){
 const n=typeof value==="string"&&/^\d+$/.test(value)?Number(value):value;
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<1)throw new ValidationError("Invalid message cursor.");
 return n;
}
async function notify(ids:string[],actorId:string){
 try{await notifySocialUsers(ids,{type:"message.changed",actorId});}catch{/* polling recovers committed state */}
}
async function access(request:Request,write:boolean){
 const user=await getSessionUser(request);if(!user)throw new AuthenticationError();
 const db=await getDatabase();
 await enforceD1RateLimit(db,`social:messages:${write?"write":"read"}:${user.id}:${requestClientKey(request)}`,write?60:180,60000);
 return {db,user};
}
export async function GET(request:Request){
 const correlationId=crypto.randomUUID();
 try{
  const {db,user}=await access(request,false),params=new URL(request.url).searchParams;
  if(!params.has("peer"))return json({inbox:await messageInbox(db,user.id)});
  const before=params.get("before");
  return json({thread:await messageThread(db,user.id,peer(params.get("peer")),before===null?undefined:cursor(before))});
 }catch(error){return serverErrorResponse(error,correlationId,"Messages are unavailable.",{route:"/api/social/messages",method:"GET"});}
}
export async function POST(request:Request){
 const correlationId=crypto.randomUUID();
 try{
  assertSameOrigin(request);
  if(Number(request.headers.get("content-length")||0)>16384)throw new ValidationError("Request is too large.");
  const {db,user}=await access(request,true),raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>16384)throw new ValidationError("Request is too large.");
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();}catch{throw new ValidationError("Invalid message request.");}
  const target=peer(body.peer);
  switch(body.action){
   case "send":{
    const message=await sendDirectMessage(db,user.id,target,body.body,typeof body.clientId==="string"?body.clientId:"");
    await notify([user.id,target],user.id);return json({message},201);
   }
   case "read":{
    if(await markMessagesRead(db,user.id,target,cursor(body.through)))await notify([user.id],user.id);
    return json({ok:true});
   }
   case "block":case "unblock":
    await setMessageBlock(db,user.id,target,body.action==="block");await notify([user.id,target],user.id);return json({ok:true});
   case "report":
    await enforceD1RateLimit(db,`social:report:${user.id}`,5,60000);
    await reportMessagePeer(db,user.id,target,body.reason);return json({ok:true},201);
   default:throw new ValidationError("Unknown message action.");
  }
 }catch(error){return serverErrorResponse(error,correlationId,"Message action failed.",{route:"/api/social/messages",method:"POST"});}
}
