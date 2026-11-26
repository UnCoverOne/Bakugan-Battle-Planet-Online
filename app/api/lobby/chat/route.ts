import { getDatabase } from "../../../../lib/account-server";
import { PERSISTENT_LOBBY_ENABLED } from "../../../../lib/lobby-cutover";
import { resolveLobbyIdentities } from "../../../../lib/lobby-identity-server";
import { createLobbySessionService } from "../../../../lib/lobby-session-server";
import { readLobbyChat,sendLobbyChat,markLobbyChatRead } from "../../../../lib/lobby-chat-server";
import { assertSameOrigin,enforceD1RateLimit,requestClientKey } from "../../../../lib/request-security";
import { AuthenticationError,AuthorizationError,ConflictError,ServiceUnavailableError,ValidationError,serverErrorResponse } from "../../../../lib/server-errors";

export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    if(!PERSISTENT_LOBBY_ENABLED)throw new ServiceUnavailableError("Persistent lobby integration is not yet enabled.");
    assertSameOrigin(request);
    const database=await getDatabase(),identities=await resolveLobbyIdentities(database,request);
    if(!identities.primary)throw new AuthenticationError("Verified lobby identity required.");
    await enforceD1RateLimit(database,`lobby-chat:${requestClientKey(request)}`,120,60000);
    const raw=await request.text();
    if(new TextEncoder().encode(raw).byteLength>8192)throw new ValidationError("Chat request too large.");
    let body:Record<string,unknown>;
    try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error();body=parsed;}catch{throw new ValidationError("Invalid chat request.");}
    if(typeof body.membershipId!=="string"||!body.membershipId)throw new AuthorizationError("Active lobby membership required.");
    const service=createLobbySessionService(database);
    if(identities.account&&identities.guest&&await service.activeMembership(identities.guest))throw new ConflictError("Resolve lobby membership first.");
    const member=await service.activeMembership(identities.primary);
    if(member?.id!==body.membershipId)throw new AuthorizationError("Active lobby membership required.");
    let sent:number|undefined;
    if(body.action==="send"){
      if(typeof body.commandId!=="string")throw new ValidationError("Invalid chat command.");
      sent=await sendLobbyChat(database,identities.primary,member.id,body.commandId,body.message);
    }else if(body.action==="read"){
      if(typeof body.through!=="number")throw new ValidationError("Invalid chat cursor.");
      await markLobbyChatRead(database,identities.primary,member.id,body.through);
    }else if(body.action!=="history")throw new ValidationError("Unknown chat command.");
    if(body.before!==undefined&&(!Number.isSafeInteger(body.before)||Number(body.before)<1||body.action!=="history"))throw new ValidationError("Invalid history cursor.");
    const page=await readLobbyChat(database,identities.primary,member.id,typeof body.before==="number"?body.before:undefined);
    return Response.json({...page,sent},{headers:{"cache-control":"no-store, max-age=0"}});
  }catch(error){return serverErrorResponse(error,crypto.randomUUID(),"Lobby chat unavailable.",{route:"/api/lobby/chat",method:"POST"});}
}
