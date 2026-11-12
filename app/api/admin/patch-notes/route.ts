import { getDatabase, requireAdministrator } from "../../../../lib/account-server";
import { listManagedPatches, saveManagedPatch } from "../../../../lib/patch-notes-server";
import { CARDS, BAKUGAN, CORES } from "../../../../lib/data";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../../lib/request-security";
import { serverErrorResponse, ValidationError } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});

export async function GET(request:Request) {
  const correlationId=request.headers.get("x-correlation-id")||crypto.randomUUID();
  try {
    await requireAdministrator(request);
    const db=await getDatabase();
    const patches=await listManagedPatches(db);
    const elements=[
      ...CARDS.filter(c=>c.type!=="Character").map(c=>({id:c.catalogId,name:c.displayName||c.name,kind:"card",art:c.art,set:c.set})),
      ...BAKUGAN.map(b=>({id:b.id,name:b.name,kind:"bakugan",art:b.art})),
      ...CORES.map(c=>({id:c.catalogId,name:c.name,kind:"core",art:c.art})),
    ];
    return json({patches,elements});
  } catch(error) {
    return serverErrorResponse(error,correlationId,"Patch notes administration is unavailable.",{route:"/api/admin/patch-notes",method:"GET"});
  }
}
export async function POST(request:Request) {
  const correlationId=request.headers.get("x-correlation-id")||crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator=await requireAdministrator(request);
    const db=await getDatabase();
    await enforceD1RateLimit(db,`admin-patches:${administrator.id}:${requestClientKey(request)}`,60,60_000);
    const raw=await request.text();
    if(new TextEncoder().encode(raw).byteLength>200_000) throw new ValidationError("Patch notes exceed the 200 KB limit.");
    let body:Record<string,unknown>;
    try { body=JSON.parse(raw) as Record<string,unknown>; } catch { throw new ValidationError("Invalid JSON."); }
    const patch=await saveManagedPatch(db,body.patch,administrator.id,Number(body.expectedRevision));
    return json({patch});
  } catch(error) {
    return serverErrorResponse(error,correlationId,"Patch notes could not be saved.",{route:"/api/admin/patch-notes",method:"POST"});
  }
}
