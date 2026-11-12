import { getDatabase } from "./account-server";
import { listPublishedPatches, type ManagedPatch } from "./patch-notes-server";
import { WEBSITE_PATCHES } from "./content/website-updates";

export async function publicWebsitePatches():Promise<ManagedPatch[]> {
  try {
    return await listPublishedPatches(await getDatabase());
  } catch {
    // If D1 is unavailable, keep the bundled development note visible.
    return WEBSITE_PATCHES.map(p=>({
      version:p.version,title:p.title,summary:p.summary,status:"published" as const,
      publishedAt:p.publishedAt,revision:0,updatedAt:0,updatedBy:"",
      sections:p.sections.map((s,i)=>({
        id:`built-in-${i}`,title:s.title,
        changes:s.items.map((item,j)=>({
          id:`built-in-${i}-${j}`,type:"general" as const,
          title:item,elementId:"",before:"",after:"",explanation:"",
          classification:"adjustment" as const,
        })),
      })),
    }));
  }
}
