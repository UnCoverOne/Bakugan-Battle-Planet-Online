"use client";
import { useMemo, useState } from "react";
import { PUBLISHED_RULINGS } from "../../lib/reference";
import chrome from "./ReferenceChrome.module.css";
import styles from "./RulingsReference.module.css";

export function RulingsReference({ onSubmit, onCopy }: {onSubmit:()=>void;onCopy:(path:string,label:string)=>Promise<void>}) {
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("All");
  const categories=[...new Set(PUBLISHED_RULINGS.map(r=>r.category))].sort();
  const normalized=query.trim().toLowerCase();
  const matches=useMemo(()=>PUBLISHED_RULINGS.filter(r=>(category==="All"||r.category===category)&&(!normalized||[r.title,r.body,r.category,r.sourceSection].join(" ").toLowerCase().includes(normalized))),[category,normalized]);
  return <div className={chrome.layout}>
    <nav className={chrome.contents} aria-label="Rulings contents">
      <h2>Contents</h2>
      <a href="#rulings-search">Search rulings</a>
      <h3>Categories</h3>
      <button type="button" aria-pressed={category==="All"} onClick={()=>setCategory("All")}>All rulings</button>
      {categories.map(c=><button type="button" key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}
      <h3>Rulings</h3>
      {matches.map(r=><a key={r.slug} href={`#ruling-${r.slug}`}>{r.title}</a>)}
    </nav>
    <main className={chrome.main}>
      <section className={chrome.searchPanel} id="rulings-search">
        <label>Search rulings<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search questions, rulings, categories…" /></label>
        <p role="status">{matches.length} of {PUBLISHED_RULINGS.length} published rulings</p>
      </section>
      <section className={styles.heading}><h2>Rulings</h2><button type="button" onClick={onSubmit}>Submit a question</button></section>
      <div className={styles.list}>
        {matches.map(r=><article id={`ruling-${r.slug}`} className={styles.article} key={r.slug}>
          <div className={styles.meta}><span>Published</span><span>Developer response</span></div>
          <h2>{r.title}</h2><p>{r.body}</p>
          <footer><small>{r.sourceSection} · Reviewed {r.reviewedAt}</small><button type="button" onClick={()=>void onCopy(`/compendium/rulings#ruling-${r.slug}`,r.title)}>Copy link</button></footer>
        </article>)}
        {matches.length===0 && <section className={styles.article} role="status"><h2>No rulings found</h2><p>Try another search or select All rulings.</p><button type="button" onClick={()=>{setQuery("");setCategory("All");}}>Clear filters</button></section>}
      </div>
    </main>
  </div>;
}
