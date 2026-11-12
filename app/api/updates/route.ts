import { publicWebsitePatches } from "../../../lib/patch-notes-public";
export const dynamic="force-dynamic";
export async function GET() {
  const patches=await publicWebsitePatches();
  return Response.json({latest:patches[0]?{
    version:patches[0].version,title:patches[0].title,
    status:patches[0].publishedAt?"Published":"Development update",
    publishedAt:patches[0].publishedAt,
  }:null},{headers:{"cache-control":"no-store"}});
}
