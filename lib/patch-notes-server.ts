import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import { ValidationError, ConflictError } from "./server-errors";
import { WEBSITE_PATCHES, type WebsitePatch } from "./content/website-updates";

export type PatchElement = { id: string; name: string; kind: "card" | "bakugan" | "core"; art?: string };
export type PatchChange = {
  id: string; type: "card" | "bakugan" | "core" | "mechanic" | "fix" | "general";
  title: string; elementId: string; before: string; after: string; explanation: string;
  classification: "buff" | "nerf" | "adjustment" | "fix" | "new";
};
export type PatchSection = { id: string; title: string; changes: PatchChange[] };
export type ManagedPatch = {
  version: string; title: string; summary: string;
  status: "draft" | "published" | "archived";
  publishedAt: string | null; sections: PatchSection[];
  revision: number; updatedAt: number; updatedBy: string;
};

const RESOURCE = "website-patch";
const types = new Set(["card","bakugan","core","mechanic","fix","general"]);
const classifications = new Set(["buff","nerf","adjustment","fix","new"]);
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0,max) : "";

function cleanChange(value: unknown, i: number): PatchChange {
  const x = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: text(x.id,64) || `change-${i}`,
    type: typeof x.type === "string" && types.has(x.type) ? x.type as PatchChange["type"] : "general",
    title: text(x.title,160),
    elementId: text(x.elementId,160),
    before: text(x.before,4000), after: text(x.after,4000),
    explanation: text(x.explanation,8000),
    classification: typeof x.classification === "string" && classifications.has(x.classification) ? x.classification as PatchChange["classification"] : "adjustment",
  };
}

export function normalizePatch(raw: unknown): ManagedPatch {
  const x = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const version = text(x.version,40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new ValidationError("Use a semantic version such as 0.4.1.");
  }
  const title = text(x.title,160);
  if (!title) throw new ValidationError("A patch title is required.");
  const sections = Array.isArray(x.sections) ? x.sections.slice(0,30).map((section,i) => {
    const s = section && typeof section === "object" ? section as Record<string,unknown> : {};
    return {
      id: text(s.id,64) || `section-${i}`,
      title: text(s.title,120) || "Changes",
      changes: Array.isArray(s.changes) ? s.changes.slice(0,100).map(cleanChange) : [],
    };
  }) : [];
  const status = x.status === "published" || x.status === "archived" ? x.status : "draft";
  if (status === "published" && !sections.some(s=>s.changes.some(c=>c.title && (c.explanation || c.before || c.after)))) {
    throw new ValidationError("Add at least one described change before publishing.");
  }
  return {
    version,title,summary:text(x.summary,1000),status,
    publishedAt: typeof x.publishedAt === "string" ? x.publishedAt : null,
    sections,
    revision:Number.isSafeInteger(x.revision) ? Number(x.revision) : 0,
    updatedAt:0,updatedBy:"",
  };
}

type Row = { resource_id:string; data_json:string; enabled:number; updated_at:number; updated_by:string };
async function rows(db:AccountDatabase, includeDrafts:boolean):Promise<Row[]> {
  await ensureAdministrationSchema(db);
  const r = await db.prepare(
    `SELECT resource_id,data_json,enabled,updated_at,updated_by FROM admin_resources WHERE resource_type = ? ${includeDrafts ? "" : "AND enabled = 1"} ORDER BY updated_at DESC`
  ).bind(RESOURCE).all<Row>();
  return r.results ?? [];
}
function parseRow(row:Row):ManagedPatch|null {
  try {
    const patch = normalizePatch(JSON.parse(row.data_json));
    return { ...patch, revision:Number(JSON.parse(row.data_json).revision)||0,updatedAt:row.updated_at,updatedBy:row.updated_by };
  } catch { return null; }
}
export async function listManagedPatches(db:AccountDatabase) {
  return (await rows(db,true)).map(parseRow).filter((x):x is ManagedPatch => Boolean(x))
    .sort((a,b)=>b.updatedAt-a.updatedAt);
}
function defaultAsManaged(p:WebsitePatch):ManagedPatch {
  return {
    version:p.version,title:p.title,summary:p.summary,
    status:"published",publishedAt:p.publishedAt,
    sections:p.sections.map((s,i)=>({
      id:`initial-${i}`,title:s.title,
      changes:s.items.map((item,j)=>({
        id:`initial-${i}-${j}`,type:"general",title:item,elementId:"",
        before:"",after:"",explanation:"",classification:"adjustment",
      })),
    })),
    revision:0,updatedAt:0,updatedBy:"",
  };
}
export async function listPublishedPatches(db:AccountDatabase):Promise<ManagedPatch[]> {
  const managed = (await rows(db,false)).map(parseRow)
    .filter((x):x is ManagedPatch => Boolean(x) && x.status==="published");
  const ids = new Set((await rows(db,true)).map(r=>r.resource_id));
  return [...managed,...WEBSITE_PATCHES.filter(p=>!ids.has(p.version)).map(defaultAsManaged)]
    .sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
}
export async function saveManagedPatch(db:AccountDatabase,input:unknown,administratorId:string,expectedRevision:number) {
  const patch = normalizePatch(input);
  if (!Number.isInteger(expectedRevision)||expectedRevision<0) throw new ValidationError("Revision is invalid.");
  await ensureAdministrationSchema(db);
  const prior = await db.prepare("SELECT data_json FROM admin_resources WHERE resource_type=? AND resource_id=?")
    .bind(RESOURCE,patch.version).first<{data_json:string}>();
  const oldRevision = prior ? Number(JSON.parse(prior.data_json).revision)||0 : 0;
  if (oldRevision!==expectedRevision) throw new ConflictError("This patch was changed elsewhere. Reload before saving.");
  if (!prior && expectedRevision!==0) throw new ConflictError("Patch no longer exists.");
  if (!prior && WEBSITE_PATCHES.some(p=>p.version===patch.version) && patch.status==="draft") {
    throw new ValidationError("The bundled version is already public. Save it as published or archived.");
  }
  const now=Date.now();
  const next={...patch,revision:oldRevision+1,updatedAt:now,updatedBy:administratorId,
    publishedAt:patch.status==="published" ? patch.publishedAt || new Date(now).toISOString() : patch.publishedAt};
  // A conditional update prevents lost work when two administrators save concurrently.
  if(prior) {
    const result=await db.prepare("UPDATE admin_resources SET data_json=?,enabled=?,updated_by=?,updated_at=? WHERE resource_type=? AND resource_id=? AND json_extract(data_json,'$.revision')=?")
      .bind(JSON.stringify(next),next.status==="published"?1:0,administratorId,now,RESOURCE,patch.version,oldRevision).run();
    if(!result.meta.changes) throw new ConflictError("A newer revision exists. Reload before saving.");
  } else {
    await db.prepare("INSERT INTO admin_resources (resource_type,resource_id,data_json,enabled,updated_by,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(RESOURCE,patch.version,JSON.stringify(next),next.status==="published"?1:0,administratorId,now).run();
  }
  return next;
}
