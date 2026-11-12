"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManagedPatch, PatchChange, PatchElement, PatchSection } from "../../lib/patch-notes-server";
import styles from "./AdminPatchEditor.module.css";

const TYPES: {value:PatchChange["type"];label:string}[]=[
  {value:"card",label:"Card"},{value:"bakugan",label:"Bakugan"},{value:"core",label:"BakuCore"},
  {value:"mechanic",label:"Mechanic"},{value:"fix",label:"Bug fix"},{value:"general",label:"General"},
];
const newId=()=>crypto.randomUUID();
function newChange(type:PatchChange["type"]):PatchChange {
  return {id:newId(),type,title:"",elementId:"",before:"",after:"",explanation:"",
    classification:type==="fix"?"fix":type==="general"?"new":"adjustment"};
}
const newSection=():PatchSection=>({id:newId(),title:"New section",changes:[]});
function newPatch():ManagedPatch {
  return {version:"",title:"",summary:"",status:"draft",publishedAt:null,sections:[newSection()],
    revision:0,updatedAt:0,updatedBy:""};
}
function validVersion(v:string){return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v);}
type Listing={patches:ManagedPatch[];elements:PatchElement[]};

export function AdminPatchEditor() {
  const [listing,setListing]=useState<Listing>({patches:[],elements:[]});
  const [patch,setPatch]=useState<ManagedPatch|null>(null);
  const [selected,setSelected]=useState("");
  const [view,setView]=useState<"edit"|"preview">("edit");
  const [outlineOpen,setOutlineOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [dirty,setDirty]=useState(false);
  const [search,setSearch]=useState("");
  const [elementPicker,setElementPicker]=useState<string|false>(false);
  const saveLock=useRef(false);

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      const response=await fetch("/api/admin/patch-notes",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Unable to load patch notes.");
      setListing({patches:result.patches,elements:result.elements});
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"Unable to load data.");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!dirty)return;
    const handler=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",handler);
    return ()=>window.removeEventListener("beforeunload",handler);
  },[dirty]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"&&patch){event.preventDefault();void save("draft");}};
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  });

  const update=(fn:(current:ManagedPatch)=>ManagedPatch)=>{
    setPatch(current=>current?fn(current):current);
    setDirty(true);setMessage("");
  };
  const editSection=(id:string,fn:(s:PatchSection)=>PatchSection)=>
    update(p=>({...p,sections:p.sections.map(s=>s.id===id?fn(s):s)}));
  const editChange=(sid:string,id:string,fn:(c:PatchChange)=>PatchChange)=>
    editSection(sid,s=>({...s,changes:s.changes.map(c=>c.id===id?fn(c):c)}));
  const move=<T,>(arr:T[],index:number,dir:number)=>{
    const target=index+dir;if(target<0||target>=arr.length)return arr;
    const next=[...arr];[next[index],next[target]]=[next[target],next[index]];return next;
  };
  const begin=(p:ManagedPatch)=>{
    if(dirty&&!confirm("Discard unsaved edits?"))return;
    const copy=structuredClone(p);
    setPatch(copy);setSelected(copy.sections[0]?.id||"");setDirty(false);setError("");setMessage("");
    setView("edit");setOutlineOpen(false);
  };
  const save=async(mode:"draft"|"published"|"archived")=>{
    if(!patch||saveLock.current)return;
    if(!validVersion(patch.version)){setError("Enter a semantic version (for example, 0.4.1).");return;}
    if(!patch.title.trim()){setError("Give the patch a title.");return;}
    if(mode==="published"&&!patch.sections.some(s=>s.changes.some(c=>c.title.trim()&&(c.before.trim()||c.after.trim()||c.explanation.trim())))){
      setError("Publishing requires at least one titled, explained change.");return;
    }
    if(mode==="published" && patch.status!=="published" && !confirm(`Publish v${patch.version} to all visitors?`))return;
    if(mode==="archived"&&!confirm(`Archive v${patch.version} and remove it from the public patch history?`))return;
    if(mode==="draft"&&patch.status==="published") mode="published";
    saveLock.current=true;setBusy(true);setError("");
    try{
      const response=await fetch("/api/admin/patch-notes",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({patch:{...patch,status:mode},expectedRevision:patch.revision}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Unable to save patch.");
      setPatch(result.patch);setDirty(false);
      setMessage(mode==="published"?"Published changes saved.":mode==="archived"?"Patch archived.":"Draft saved.");
      setListing(old=>({...old,patches:[result.patch,...old.patches.filter(p=>p.version!==result.patch.version)]}));
    }catch(e){setError(e instanceof Error?e.message:"Save failed.");}
    finally{saveLock.current=false;setBusy(false);}
  };
  const active=patch?.sections.find(s=>s.id===selected)??patch?.sections[0];
  const filtered=useMemo(()=>listing.patches.filter(p=>
    `${p.version} ${p.title} ${p.status}`.toLowerCase().includes(query.toLowerCase())
  ),[listing.patches,query]);
  const catalog=useMemo(()=>listing.elements.filter(e=>
    `${e.name} ${e.id}`.toLowerCase().includes(search.toLowerCase())
  ).slice(0,35),[listing.elements,search]);
  const duplicate=(s:PatchSection,c:PatchChange)=>editSection(s.id,x=>({...x,changes:[
    ...x.changes.slice(0,x.changes.findIndex(v=>v.id===c.id)+1),
    {...c,id:newId(),title:c.title?c.title+" (copy)":""},
    ...x.changes.slice(x.changes.findIndex(v=>v.id===c.id)+1),
  ]}));
  return <section className={styles.root}>
    {error?<div className={styles.error} role="alert">{error}</div>:null}
    {message?<div className={styles.success} role="status">{message}</div>:null}
    {!patch?<>
      <div className={styles.toolbar}>
        <div><span className={styles.eyebrow}>CONTENT MANAGEMENT</span><h2>Patch Notes</h2><p>Create and publish structured game updates.</p></div>
        <button className={styles.primary} onClick={()=>begin(newPatch())}>+ New Patch</button>
      </div>
      <label className={styles.searchLabel}>Search patches
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search versions, titles, status…" />
      </label>
      {loading?<p>Loading patches…</p>:null}
      <div className={styles.patchList}>
        {filtered.map(p=><button key={p.version} className={styles.patchRow} onClick={()=>begin(p)}>
          <strong>v{p.version}</strong><span>{p.title}</span><small>{p.status}</small><span aria-hidden="true">›</span>
        </button>)}
        {!loading&&!filtered.length?<p>No saved patches found. Create a new draft to get started.</p>:null}
      </div>
    </>:<>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button onClick={()=>{if(dirty&&!confirm("Discard unsaved edits?"))return;setPatch(null);setError("");setMessage("");setDirty(false);void load();}}>← Patches</button>
          <div><strong>{patch.version?`v${patch.version}`:"New patch"}</strong><small>{dirty?"Unsaved changes":patch.status==="published"?"Published":patch.status==="archived"?"Archived":"Draft"}</small></div>
        </div>
        <div className={styles.toolbarActions}>
          <button onClick={()=>setOutlineOpen(v=>!v)} className={styles.outlineToggle}>Outline</button>
          <button onClick={()=>setView(v=>v==="edit"?"preview":"edit")}>{view==="edit"?"Preview":"Edit"}</button>
          <button onClick={()=>void save("draft")} disabled={busy||(!dirty&&patch.revision>0)}>Save Draft</button>
          <button className={styles.primary} onClick={()=>void save("published")} disabled={busy}>Publish</button>
        </div>
      </div>
      <div className={styles.editorLayout}>
        <aside className={`${styles.outline} ${outlineOpen?styles.outlineVisible:""}`}>
          <strong className={styles.eyebrow}>PATCH OUTLINE</strong>
          <button className={selected===""?styles.selected:""} onClick={()=>{setSelected("");setOutlineOpen(false);}}>Overview</button>
          {patch.sections.map((s,i)=><div className={styles.outlineEntry} key={s.id}>
            <button className={selected===s.id?styles.selected:""} onClick={()=>{setSelected(s.id);setOutlineOpen(false);}}>{s.title} <small>{s.changes.length}</small></button>
            <div className={styles.miniActions}>
              <button title="Move section up" aria-label={`Move ${s.title} up`} disabled={!i} onClick={()=>update(p=>({...p,sections:move(p.sections,i,-1)}))}>↑</button>
              <button title="Move section down" aria-label={`Move ${s.title} down`} disabled={i===patch.sections.length-1} onClick={()=>update(p=>({...p,sections:move(p.sections,i,1)}))}>↓</button>
            </div>
          </div>)}
          <button className={styles.addLink} onClick={()=>{const s=newSection();update(p=>({...p,sections:[...p.sections,s]}));setSelected(s.id);setOutlineOpen(false);}}>+ Add section</button>
          {patch.revision>0?<button className={styles.archive} onClick={()=>void save("archived")}>Archive patch</button>:null}
        </aside>
        <div className={styles.canvas}>
          {view==="preview"?<div className={styles.preview}>
            <span className={styles.eyebrow}>PUBLIC PAGE PREVIEW · {patch.status.toUpperCase()}</span>
            <h2>{patch.title||"Untitled patch"}</h2><p>v{patch.version||"—"} · {patch.summary}</p>
            {patch.sections.map(s=><section key={s.id}><h3>{s.title}</h3>
              {s.changes.map(c=><article key={c.id}><h4>{c.title||"Untitled change"}</h4>
                {c.elementId?<small>{listing.elements.find(e=>e.id===c.elementId)?.name||c.elementId}</small>:null}
                {(c.before||c.after)?<div className={styles.comparison}><div><small>Before</small><p>{c.before||"—"}</p></div><div><small>After</small><p>{c.after||"—"}</p></div></div>:null}
                <p>{c.explanation}</p></article>)}
            </section>)}
          </div>:selected===""?<div className={styles.form}>
            <h2>Patch Details</h2>
            <label>Version <input placeholder="0.4.1" value={patch.version} disabled={patch.revision>0} onChange={e=>update(p=>({...p,version:e.target.value}))}/></label>
            <label>Title <input value={patch.title} onChange={e=>update(p=>({...p,title:e.target.value}))} placeholder="Patch title"/></label>
            <label>Summary <textarea value={patch.summary} rows={3} onChange={e=>update(p=>({...p,summary:e.target.value}))} placeholder="What should players know about this update?"/></label>
            <p className={styles.hint}>Version IDs cannot be changed after the first save, so existing links remain stable. Publishing does not change the deployed software version.</p>
            <button onClick={()=>setSelected(patch.sections[0]?.id||"")} disabled={!patch.sections.length}>Edit sections →</button>
          </div>:active?<div className={styles.form}>
            <div className={styles.sectionHead}>
              <label>Section title <input value={active.title} onChange={e=>editSection(active.id,s=>({...s,title:e.target.value}))}/></label>
              <button className={styles.danger} onClick={()=>{if(!confirm("Remove this section and all its entries?"))return;update(p=>({...p,sections:p.sections.filter(s=>s.id!==active.id)}));setSelected("");}}>Remove section</button>
            </div>
            {active.changes.map((c,i)=><article className={styles.changeEditor} key={c.id}>
              <div className={styles.changeHeader}>
                <strong>Change {i+1}</strong>
                <div className={styles.miniActions}>
                  <button title="Move up" disabled={!i} onClick={()=>editSection(active.id,s=>({...s,changes:move(s.changes,i,-1)}))}>↑</button>
                  <button title="Move down" disabled={i===active.changes.length-1} onClick={()=>editSection(active.id,s=>({...s,changes:move(s.changes,i,1)}))}>↓</button>
                  <button title="Duplicate" onClick={()=>duplicate(active,c)}>Duplicate</button>
                  <button title="Delete" onClick={()=>{if(confirm("Delete this change?"))editSection(active.id,s=>({...s,changes:s.changes.filter(x=>x.id!==c.id)}));}}>Delete</button>
                </div>
              </div>
              <div className={styles.two}>
                <label>Type <select value={c.type} onChange={e=>editChange(active.id,c.id,v=>({...v,type:e.target.value as PatchChange["type"]}))}>
                  {TYPES.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}
                </select></label>
                <label>Classification <select value={c.classification} onChange={e=>editChange(active.id,c.id,v=>({...v,classification:e.target.value as PatchChange["classification"]}))}>
                  {["adjustment","buff","nerf","fix","new"].map(v=><option key={v}>{v}</option>)}
                </select></label>
              </div>
              <label>Change title <input value={c.title} onChange={e=>editChange(active.id,c.id,v=>({...v,title:e.target.value}))} placeholder="Describe the change briefly"/></label>
              {["card","bakugan","core"].includes(c.type)?<div className={styles.elementSelect}>
                <label>Catalogue element <input readOnly value={listing.elements.find(e=>e.id===c.elementId)?.name||c.elementId} placeholder="Select an element…" onClick={()=>{setElementPicker(c.id);setSearch("");}}/></label>
                <button onClick={()=>{setElementPicker(c.id);setSearch("");}}>Find</button>
                {c.elementId?<button onClick={()=>editChange(active.id,c.id,v=>({...v,elementId:""}))}>Clear</button>:null}
              </div>:null}
              <div className={styles.two}>
                <label>Before <textarea rows={3} value={c.before} onChange={e=>editChange(active.id,c.id,v=>({...v,before:e.target.value}))} placeholder="Previous stat, effect or behaviour"/></label>
                <label>After <textarea rows={3} value={c.after} onChange={e=>editChange(active.id,c.id,v=>({...v,after:e.target.value}))} placeholder="New stat, effect or behaviour"/></label>
              </div>
              <label>Explanation <textarea rows={4} value={c.explanation} onChange={e=>editChange(active.id,c.id,v=>({...v,explanation:e.target.value}))} placeholder="Impact, reasoning, edge cases or examples…"/></label>
            </article>)}
            <div className={styles.quickAdd}><span>+ Add change</span>{TYPES.map(t=><button key={t.value} onClick={()=>editSection(active.id,s=>({...s,changes:[...s.changes,newChange(t.value)]}))}>{t.label}</button>)}</div>
          </div>:<p>Select a section from the outline.</p>}
        </div>
      </div>
      <div className={styles.mobileActions}><button onClick={()=>void save("draft")} disabled={busy}>Save Draft</button><button className={styles.primary} onClick={()=>void save("published")} disabled={busy}>Publish</button></div>
      {elementPicker?<div className={styles.modalBackdrop} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setElementPicker(false);}}>
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Select a catalogue element">
          <div className={styles.modalHeader}><strong>Select game element</strong><button onClick={()=>setElementPicker(false)}>Close</button></div>
          <input autoFocus placeholder="Search by name or catalogue ID…" value={search} onChange={e=>setSearch(e.target.value)}/>
          <div className={styles.catalogResults}>{catalog.filter(e=>{
            const c=active?.changes.find(x=>x.id===elementPicker);
            return !c||e.kind===c.type;
          }).map(e=><button key={e.id} onClick={()=>{editChange(active!.id,elementPicker,v=>({...v,elementId:e.id,title:v.title||e.name}));setElementPicker(false);}}>
            {e.art?<img src={e.art} alt="" loading="lazy"/>:null}<span><strong>{e.name}</strong><small>{e.id}</small></span>
          </button>)}</div>
        </div>
      </div>:null}
    </>}
  </section>;
}
