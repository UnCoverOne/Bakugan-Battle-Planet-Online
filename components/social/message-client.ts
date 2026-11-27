import {readJsonResponse} from "../../lib/json-response";
export async function messageRequest<T>(query="",body?:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
 const timeout=AbortSignal.timeout(12000);
 const response=await fetch("/api/social/messages"+(query?"?"+query:""),{
 cache:"no-store",signal:signal?AbortSignal.any([signal,timeout]):timeout,
 ...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})
 });
 const result=await readJsonResponse(response,"Invalid message response.") as T&{error?:string};
 if(!response.ok)throw new Error(result.error??"Messages unavailable.");
 return result;
}
