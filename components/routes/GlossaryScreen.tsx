"use client";

import { useEffect, useMemo, useState } from "react";
import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "../../lib/official-rulebook";
import { GLOSSARY_ENTRIES, SYMBOL_ENTRIES } from "../../lib/reference";
import { OriginalImage } from "../media/OriginalImage";
import styles from "./GlossaryScreen.module.css";

type Term = {
  title: string;
  key: string;
  category: string;
  definition: string;
  rule: string;
  editorial: boolean;
};
const makeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sourceTerms: Term[] = [];
OFFICIAL_RULEBOOK.forEach((chapter, i) => chapter.children.forEach((section, j) => {
  if (section.text === "General" || !section.children.length) return;
  const id = `${i + 1}.${j + 1}`;
  // The section's first numbered paragraph supplies the wording, without inventing a new definition.
  sourceTerms.push({ title: section.text, key: makeKey(section.text), category: chapter.text, definition: section.children[0].text, rule: id, editorial: false });
}));
const aliases = new Map<string,string>([
  ["b-power", "2.9"], ["bakucore", "1.12"], ["character-card", "3.2"],
  ["evo", "3.3"], ["hero", "3.4"], ["flip", "3.6"], ["faction", "1.6"],
  ["priority", "1.14"], ["reroll", "1.18"], ["selection", "1.13"],
  ["starting-player", "1.14"], ["free", "1.15"], ["team-attack", "5.12"],
  ["energy-cost", "2.3"], ["batch", "4.4"], ["damage", "1.16"],
  ["damage-rating", "2.10"], ["energy", "1.7"],
]);
const fullTerms: Term[] = (() => {
  const indexed = new Map<string,Term>();
  sourceTerms.forEach((entry) => indexed.set(entry.key, entry));
  GLOSSARY_ENTRIES.forEach((entry) => {
    const key = makeKey(entry.title);
    const rule = aliases.get(key) || (/^\d+(?:\.\d+)+/.exec(entry.sourceSection)?.[0] ?? "");
    const original = sourceTerms.find((candidate) => candidate.rule === rule);
    const existing = indexed.get(key);
    indexed.set(key, {
      title: entry.title, key, category: entry.category,
      definition: original?.definition || existing?.definition || entry.body,
      rule, editorial: !(original || existing),
    });
  });
  return [...indexed.values()].sort((a,b) => a.title.localeCompare(b.title));
})();
const letters = [...new Set(fullTerms.map((entry) => entry.title[0].toUpperCase()))].sort();
const getRule = (id: string): OfficialRuleNode | undefined => {
  const indexes = id.split(".").map((value) => Number(value)-1);
  return indexes.reduce<OfficialRuleNode | undefined>((node, i, position) => position === 0 ? OFFICIAL_RULEBOOK[i] : node?.children[i], undefined);
};
const sections = [...new Set(fullTerms.map((entry) => entry.category))].sort();
export function GlossaryScreen({ query = "" }: { query?: string }) {
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Term | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => fullTerms.filter((term) =>
    (category === "All" || term.category === category)
    && (!normalized || [term.title,term.definition,term.category,term.rule].some((part) => part.toLowerCase().includes(normalized)))
  ),[category,normalized]);
  useEffect(() => {
    if (!selected) return;
    const dismiss = (event:KeyboardEvent) => {if(event.key === "Escape") setSelected(null);};
    addEventListener("keydown",dismiss);
    return () => removeEventListener("keydown",dismiss);
  }, [selected]);
  const byLetter = letters.map((letter) => ({letter,items:filtered.filter((item)=>item.title.toUpperCase().startsWith(letter))})).filter((group)=>group.items.length);
  return <div className={styles.layout}>
    <aside className={styles.rail} aria-label="Glossary navigation">
      <h2>Contents</h2>
      <a href="#glossary-icons">Printed icons</a>
      <div className={styles.alphabet} aria-label="Jump to letter">
        {letters.map((letter)=><a key={letter} href={`#glossary-letter-${letter}`} aria-label={`Jump to ${letter}`}>{letter}</a>)}
      </div>
      <h3>Categories</h3>
      <button type="button" aria-pressed={category==="All"} onClick={()=>setCategory("All")}>All terms</button>
      {sections.map((section)=><button key={section} type="button" aria-pressed={category===section} onClick={()=>setCategory(section)}>{section}</button>)}
    </aside>
    <main className={styles.main}>
      <section className={styles.printedIcons} id="glossary-icons" aria-labelledby="glossary-icons-heading">
        <div className={styles.iconHeading}><h2 id="glossary-icons-heading">Printed Icons</h2><span className={styles.iconCount}>{SYMBOL_ENTRIES.length}</span></div>
        <div className={styles.iconGrid}>{SYMBOL_ENTRIES.map((symbol) => <article className={styles.iconCard} key={symbol.token}>
          <OriginalImage className={styles.iconArtwork} src={symbol.asset} alt="" />
          <strong>{symbol.name}</strong><p>{symbol.description}</p>
        </article>)}</div>
      </section>
      {byLetter.length ? byLetter.map(({letter,items})=><section key={letter} className={styles.group} id={`glossary-letter-${letter}`}>
        <h2>{letter}</h2><div className={styles.entries}>{items.map((item)=><article key={item.key} className={styles.entry} id={`glossary-${item.key}`}>
          <div className={styles.entryHeading}><h3>{item.title}</h3></div>
          <p>{item.definition}</p>
          <footer><span>{item.category}</span>{item.editorial && <span>Site reference</span>}{item.rule && <a href={`/compendium/rules#section-${item.rule}`}>Rule {item.rule} →</a>}<button type="button" onClick={()=>setSelected(item)}>Details</button></footer>
        </article>)}</div>
      </section>) : <section className={styles.empty} role="status"><h2>No matching glossary entries</h2><p>Try a different term or clear the category filter.</p><button type="button" onClick={()=>{setCategory("All");}}>Clear filters</button></section>}
    </main>
    {selected && <div role="presentation" className={styles.backdrop} onMouseDown={(event)=>{if(event.target===event.currentTarget)setSelected(null);}}><section role="dialog" aria-modal="true" aria-labelledby="glossary-dialog-title" className={styles.modal}>
      <button className={styles.close} type="button" aria-label="Close definition" onClick={()=>setSelected(null)}>×</button>
      <span className={styles.eyebrow}>{selected.category}</span><h2 id="glossary-dialog-title">{selected.title}</h2>
      <p>{selected.definition}</p>
      {selected.rule && <><h3>Original rulebook context</h3><div className={styles.context}>{getRule(selected.rule)?.children.slice(0,5).map((node,i)=><p key={i}><strong>{selected.rule}.{i+1}</strong> {node.text}</p>)}</div><a href={`/compendium/rules#section-${selected.rule}`}>Read complete rule {selected.rule} →</a></>}
      {!selected.rule && <p className={styles.count}>Site glossary reference; no exact numbered rule was identified.</p>}
    </section></div>}
  </div>;
}
