"use client";

import { useEffect, useMemo, useState } from "react";
import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "../../lib/official-rulebook";
import { GLOSSARY_ENTRIES, SYMBOL_ENTRIES } from "../../lib/reference";
import { OriginalImage } from "../media/OriginalImage";
import styles from "./OfficialRulebook.module.css";

type IndexedRule = { id: string; label: string; text: string; chapter: number; depth: number };
const indexed: IndexedRule[] = [];
const walk = (nodes: OfficialRuleNode[], prefix = "", chapter = 0) => {
  nodes.forEach((node, i) => {
    const id = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    indexed.push({ id, label: node.text, text: node.text, chapter: chapter || i + 1, depth: id.split(".").length });
    walk(node.children, id, chapter || i + 1);
  });
};
walk(OFFICIAL_RULEBOOK);
const byId = new Map(indexed.map((rule) => [rule.id, rule]));
const termRules = indexed
  .filter((rule) => rule.depth === 2 && rule.label !== "General" && rule.label.length >= 4)
  .sort((a, b) => b.label.length - a.label.length);
const excludedTerms = new Set(["name", "art", "text", "cards", "general", "type line", "legal text", "collection number", "set indicator", "hero id", "evo id", "card types", "numbers"]);
const terms = [...new Map(termRules.filter((rule) => !excludedTerms.has(rule.label.toLowerCase())).map((rule) => [rule.label.toLowerCase(), rule])).values()];
const aliases = new Map([["faction", "1.6"], ["bakucore", "1.12"], ["bakugan", "1.11"], ["priority", "1.14"], ["energy", "1.7"], ["damage", "1.16"], ["reroll", "1.18"]]);
const termPattern = new RegExp("\\b(" + [...aliases.keys(), ...terms.map((term) => term.label.replace(/[^a-z0-9 -]/gi, ""))].join("|") + ")\\b", "gi");
const glossary = GLOSSARY_ENTRIES.map((entry) => ({ title: entry.title, body: entry.body }));
function linkedText(text: string, currentId: string, onTerm: (rule: IndexedRule) => void) {
  const references = /\b(?:see )?(?:rule|section)\s+(\d+(?:\.\d+)*)(?:\.)?/gi;
  const chunks: React.ReactNode[] = [];
  let pos = 0, match: RegExpExecArray | null;
  const linkTerms = (fragment: string, key: string) => {
    const pattern = new RegExp(termPattern.source, "gi");
    let start = 0, found: RegExpExecArray | null;
    while ((found = pattern.exec(fragment))) {
      if (found.index > start) chunks.push(fragment.slice(start, found.index));
      const term = byId.get(aliases.get(found[0].toLowerCase()) ?? "") || terms.find((candidate) => candidate.label.toLowerCase() === found![0].toLowerCase());
      if (term && term.id !== currentId) chunks.push(<button type="button" key={key + found.index} className={styles.term} onClick={() => onTerm(term)} title={`Explain ${term.label}`}>{found[0]}</button>);
      else chunks.push(found[0]);
      start = pattern.lastIndex;
    }
    chunks.push(fragment.slice(start));
  };
  while ((match = references.exec(text))) {
    linkTerms(text.slice(pos, match.index), String(pos));
    const target = byId.get(match[1]);
    if (target) chunks.push(<a key={match.index} href={target.depth === 1 ? `#chapter-${target.id}` : target.depth === 2 ? `#section-${target.id}` : `#rule-${target.id}`} className={styles.crossref}>{match[0]}</a>);
    else chunks.push(match[0]);
    pos = references.lastIndex;
  }
  linkTerms(text.slice(pos), String(pos));
  return chunks;
}
function RuleParagraph({ node, id, depth, onTerm, filter }: { node: OfficialRuleNode; id: string; depth: number; onTerm: (rule: IndexedRule) => void; filter: string }) {
  const hit = !filter || node.text.toLowerCase().includes(filter) || node.children.some((child) => matches(child, filter));
  if (!hit) return null;
  const content = <><span className={styles.number}>{id}</span><span>{linkedText(node.text, id, onTerm)}</span></>;
  return <li id={`rule-${id}`} className={styles.rule} data-depth={depth}>
    {node.children.length ? <details open={Boolean(filter) || depth < 4} className={styles.nested}><summary>{content}</summary><ol>{node.children.map((child, i) => <RuleParagraph key={i} node={child} id={`${id}.${i + 1}`} depth={depth + 1} onTerm={onTerm} filter={filter} />)}</ol></details> : <div className={styles.ruleCopy}>{content}</div>}
  </li>;
}
function matches(node: OfficialRuleNode, query: string): boolean {
  return node.text.toLowerCase().includes(query) || node.children.some((child) => matches(child, query));
}
export function OfficialRulebook({ query = "" }: { query?: string }) {
  const [localQuery, setLocalQuery] = useState("");
  const [term, setTerm] = useState<IndexedRule | null>(null);
  const [showGlossary, setShowGlossary] = useState(false);
  useEffect(() => {
    const reveal = () => {
      const match = window.location.hash.match(/^#rule-(\d+(?:\.\d+)*)$/);
      if (!match) return;
      const id = match[1];
      document.querySelectorAll(`[id^="rule-"] details`).forEach((element) => {
        const owner = element.closest("[id]");
        if (owner && id.startsWith(owner.id.replace("rule-", "") + ".")) (element as HTMLDetailsElement).open = true;
      });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  const filter = (query || localQuery).trim().toLowerCase();
  const hits = useMemo(() => indexed.filter((rule) => rule.depth >= 3 && rule.text.toLowerCase().includes(filter)).length, [filter]);
  useEffect(() => {
    if (!term) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setTerm(null); };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [term]);
  const jumpTo = (id: string) => {
    setTerm(null);
    // Nested rules may be collapsed; reveal ancestors before scrolling.
    document.querySelectorAll(`[id^="rule-"] details`).forEach((element) => {
      const owner = element.closest("[id]");
      if (owner && id.startsWith(owner.id.replace("rule-", "") + ".")) (element as HTMLDetailsElement).open = true;
    });
    window.location.hash = id.split(".").length === 2 ? `section-${id}` : `rule-${id}`;
  };
  return <div className={styles.reader} data-rulebook-reader>
    <nav className={styles.contents} aria-label="Rulebook contents">
      <h2>Contents</h2>
      <a href="#rulebook-icons">Printed icons</a>
      <a href="#rulebook-introduction">Introduction & errata</a>
      {OFFICIAL_RULEBOOK.map((chapter, i) => <details key={i} open={i === 0 || Boolean(filter)}><summary><a href={`#chapter-${i + 1}`}>{i + 1}. {chapter.text}</a></summary><div className={styles.sectionLinks}>{chapter.children.map((section, j) => <a key={j} href={`#section-${i + 1}.${j + 1}`}>{i + 1}.{j + 1} {section.text}</a>)}</div></details>)}
      <a href="#rulebook-glossary" onClick={() => setShowGlossary(true)}>Glossary</a>
    </nav>
    <main className={styles.main}>
      <section className={`panel ${styles.printedIcons}`} id="rulebook-icons" aria-labelledby="printed-icons-heading">
        <div className="panel-heading"><h2 id="printed-icons-heading">Printed icons</h2><span className={styles.iconCount}>{SYMBOL_ENTRIES.length}</span></div>
        <div className={styles.icons} data-icon-grid>{SYMBOL_ENTRIES.map((symbol) => <article data-icon-card key={symbol.token}><OriginalImage src={symbol.asset} alt="" /><strong>{symbol.name}</strong><p>{symbol.description}</p></article>)}</div>
      </section>
      <div className={styles.header} id="rulebook-introduction">
        <span className={styles.eyebrow}>BAKUGAN BATTLE PLANET · OFFICIAL COMPLETE RULEBOOK</span>
        <h2>Rules & Glossary</h2>
        <p>The official advanced TCG rulebook, preserving its original wording, rule order and nested paragraphs. Select underlined terms for explanations; select rule numbers to jump to the referenced passage.</p>
        <label className={styles.search}>Search rule text<input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="Find a rule, number, or keyword…" type="search" /></label>
        {filter && <p role="status">{hits} matching rule paragraphs</p>}
        <details className={styles.errata}><summary>Card errata from the official rulebook</summary><ul>
          <li>All Flow text is changed from “Flow: If you played another card this turn,” to “Flow: If this is not the first card you played this turn,”</li>
          <li>Diamond Fangzor, despite the toy paint, is intended to be played with the Pyrus Fangzor Character card.</li>
          <li>Hyper Gortion Ultra’s name is intended to be “Hyper Gorthion Ultra” and played with the Darkus Gorthion Ultra Character card.</li>
          <li>Titan Nillious text is changed from “Titan Haos Fangzor.” to “this.”</li>
          <li>Titan Nillious Ultra in some cases is missing a “3” before the Energy icon in its text. In all cases, the text should read “this costs 3 (Energy icon) less to play.”</li>
          <li>Maximus Dragonoid – “If you control Dan Kouzo, Wynton Styles, and Lia Venegas, you win the game.”</li>
        </ul></details>
      </div>
      {OFFICIAL_RULEBOOK.map((chapter, i) => (!filter || matches(chapter, filter)) && <section className={styles.chapter} id={`chapter-${i + 1}`} key={i}>
        <h2>{i + 1}. {chapter.text}</h2>
        {chapter.children.map((section, j) => (!filter || matches(section, filter)) && <section id={`section-${i + 1}.${j + 1}`} className={styles.section} key={j}>
          <h3>{i + 1}.{j + 1}. {section.text} <button type="button" className={styles.share} onClick={() => void navigator.clipboard?.writeText(`${location.origin}/compendium/rules#section-${i + 1}.${j + 1}`)}>Copy link</button></h3>
          <ol className={styles.paragraphs}>{section.children.map((node, k) => <RuleParagraph key={k} node={node} id={`${i + 1}.${j + 1}.${k + 1}`} depth={3} onTerm={setTerm} filter={filter} />)}</ol>
        </section>)}
      </section>)}
      <section className={styles.appendix} id="rulebook-glossary"><h2>Glossary</h2><button type="button" onClick={() => setShowGlossary(!showGlossary)} aria-expanded={showGlossary}>{showGlossary ? "Hide glossary entries" : `Show ${glossary.length} glossary entries`}</button>{showGlossary && <dl>{glossary.map((entry) => <div key={entry.title}><dt>{entry.title}</dt><dd>{entry.body}</dd></div>)}</dl>}</section>

    </main>
    {term && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setTerm(null); }} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="rule-term-heading">
      <button type="button" className={styles.close} onClick={() => setTerm(null)} aria-label="Close explanation">×</button>
      <small>RULE {term.id}</small><h2 id="rule-term-heading">{term.label}</h2>
      <p>{byId.get(term.id + ".1")?.text || term.label}</p>
      <button type="button" onClick={() => jumpTo(term.id)}>Go to full rule →</button>
    </section></div>}
  </div>;
}
