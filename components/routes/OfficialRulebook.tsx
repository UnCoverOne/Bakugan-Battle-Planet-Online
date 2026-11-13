"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "../../lib/official-rulebook";
import styles from "./OfficialRulebook.module.css";
import { ReferenceContentsDrawer } from "./ReferenceContentsDrawer";

type IndexedRule = { id: string; label: string; text: string; chapter: number; depth: number };
type RuleReturn = { targetId: string; originId: string; scrollY: number; previousHash: string };
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
function linkedText(text: string, currentId: string, onTerm: (rule: IndexedRule) => void, onCrossRef: (rule: IndexedRule, origin: string) => void) {
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
    if (target) chunks.push(<a key={match.index} href={target.depth === 1 ? `#chapter-${target.id}` : target.depth === 2 ? `#section-${target.id}` : `#rule-${target.id}`} className={styles.crossref} onClick={(event) => { event.preventDefault(); onCrossRef(target, currentId); }}>{match[0]}</a>);
    else chunks.push(match[0]);
    pos = references.lastIndex;
  }
  linkTerms(text.slice(pos), String(pos));
  return chunks;
}
function ReturnBar({ context, targetId, onReturn, onDismiss }: {
  context: RuleReturn | null; targetId: string; onReturn: () => void; onDismiss: () => void;
}) {
  if (context?.targetId !== targetId) return null;
  return <div className={styles.returnBar}>
    <button type="button" onClick={onReturn}>← Back to Rule {context.originId}</button>
    <button type="button" onClick={onDismiss} aria-label="Dismiss return link">×</button>
  </div>;
}
function RuleParagraph({ node, id, depth, onTerm, onCrossRef, returnContext, onReturn, onDismiss }: {
  node: OfficialRuleNode; id: string; depth: number; onTerm: (rule: IndexedRule) => void;
  onCrossRef: (rule: IndexedRule, origin: string) => void; returnContext: RuleReturn | null;
  onReturn: () => void; onDismiss: () => void;
}) {
  const content = <><span className={styles.number}>{id}</span><span>{linkedText(node.text, id, onTerm, onCrossRef)}</span></>;
  return <li id={`rule-${id}`} className={styles.rule} data-depth={depth}>
    <ReturnBar context={returnContext} targetId={id} onReturn={onReturn} onDismiss={onDismiss} />
    <div className={styles.ruleCopy}>{content}</div>
    {node.children.length > 0 && <ol className={styles.nestedList}>{node.children.map((child, i) =>
      <RuleParagraph key={i} node={child} id={`${id}.${i+1}`} depth={depth+1}
        onTerm={onTerm} onCrossRef={onCrossRef} returnContext={returnContext}
        onReturn={onReturn} onDismiss={onDismiss} />)}</ol>}
  </li>;
}

function matches(node: OfficialRuleNode, query: string): boolean {
  return node.text.toLowerCase().includes(query) || node.children.some((child) => matches(child, query));
}
export function OfficialRulebook({ query = "" }: { query?: string }) {
  const [term, setTerm] = useState<IndexedRule | null>(null);
  const [activeSection, setActiveSection] = useState("1.1");
  const [openChapters, setOpenChapters] = useState<number[]>([1]);
  const [returnContext, setReturnContext] = useState<RuleReturn | null>(null);
  const tocRef = useRef<HTMLDivElement>(null);
  const manualUntil = useRef(0);
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
  const filter = query.trim().toLowerCase();
  const hits = useMemo(() => filter ? indexed.filter((rule) => rule.depth >= 3 && rule.text.toLowerCase().includes(filter)) : [], [filter]);
  useEffect(() => {
    if (!term) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setTerm(null); };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [term]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = [...document.querySelectorAll<HTMLElement>('[id^="section-"]')];
      let current = sections[0];
      for (const element of sections) if (element.getBoundingClientRect().top <= 260) current = element;
      if (!current) return;
      const id = current.id.replace("section-", "");
      setActiveSection((previous) => previous === id ? previous : id);
      const chapter = Number(id.split(".")[0]);
      setOpenChapters((previous) => previous.includes(chapter) ? previous : [...previous, chapter]);
      if (Date.now() > manualUntil.current) {
        const toc = tocRef.current?.querySelector<HTMLElement>(`[data-rule-link="section-${id}"]`);
        const box = tocRef.current?.getBoundingClientRect();
        const rect = toc?.getBoundingClientRect();
        if (toc && box && rect && (rect.top < box.top + 40 || rect.bottom > box.bottom - 40)) toc.scrollIntoView({block:"nearest"});
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, {passive:true});
    return () => {removeEventListener("scroll", onScroll);cancelAnimationFrame(frame);};
  }, []);
  const handleCrossRef = (target: IndexedRule, originId: string) => {
    const hash = target.depth === 1 ? `chapter-${target.id}` : target.depth === 2 ? `section-${target.id}` : `rule-${target.id}`;
    setReturnContext({targetId:target.id,originId,scrollY:window.scrollY,previousHash:window.location.hash});
    window.history.pushState(null, "", "#"+hash);
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({block:"start"}));
  };
  const returnToOrigin = () => {
    if (!returnContext) return;
    window.history.replaceState(null, "", window.location.pathname+window.location.search+returnContext.previousHash);
    window.scrollTo({top:returnContext.scrollY});
    setReturnContext(null);
  };
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
    <ReferenceContentsDrawer className={styles.contents} label="Rulebook contents">
      <h2>Contents</h2>
      <div ref={tocRef} className={styles.tocScroll} onWheelCapture={() => {manualUntil.current=Date.now()+2600;}}
        onTouchStartCapture={() => {manualUntil.current=Date.now()+2600;}}>
        {OFFICIAL_RULEBOOK.map((chapter, i) => {
          const chapterId = i+1;
          const open = openChapters.includes(chapterId);
          return <div className={styles.tocChapter} key={chapterId}>
            <button type="button" aria-expanded={open} onClick={() => {manualUntil.current=Date.now()+2600;setOpenChapters((previous) => open ? previous.filter((value) => value !== chapterId) : [...previous,chapterId]);}}>
              {open ? "⌄" : "›"} {chapterId}. {chapter.text}
            </button>
            {open && <div className={styles.sectionLinks}>{chapter.children.map((section,j) => {
              const sectionId = `${chapterId}.${j+1}`;
              return <div key={sectionId}>
                <a data-rule-link={`section-${sectionId}`} aria-current={activeSection === sectionId ? "location" : undefined}
                  href={`#section-${sectionId}`} onClick={() => manualUntil.current=Date.now()+800}>
                  {sectionId} {section.text}
                </a>
                {section.children.filter((node) => node.children.length > 0).map((node) => {
                  const index=section.children.indexOf(node)+1;
                  return <a className={styles.tocSubsection} key={index}
                    href={`#rule-${sectionId}.${index}`}>{sectionId}.{index} {node.text}</a>;
                })}
              </div>;
            })}</div>}
          </div>;
        })}
        <a href="#rulebook-errata">Errata</a>
      </div>
    </ReferenceContentsDrawer>
    <main className={styles.main}>
      {filter && <section className={styles.searchResults} role="search" aria-label="Rulebook matches">
        <h2>{hits.length} matching rules</h2>
        <div>{hits.slice(0,100).map((hit) => <button type="button" key={hit.id} onClick={() => {
          const target=document.getElementById("rule-"+hit.id);
          target?.scrollIntoView({block:"start"});
          window.history.replaceState(null, "", "#rule-"+hit.id);
        }}><strong>{hit.id}</strong> {hit.text}</button>)}</div>
        {hits.length>100 && <p>Showing the first 100 matches; refine the search for more precise results.</p>}
      </section>}
      {OFFICIAL_RULEBOOK.map((chapter, i) => <section className={styles.chapter} id={`chapter-${i + 1}`} key={i}>
        <ReturnBar context={returnContext} targetId={String(i+1)} onReturn={returnToOrigin} onDismiss={() => setReturnContext(null)} />
        <h2>{i + 1}. {chapter.text}</h2>
        {chapter.children.map((section, j) => <section id={`section-${i + 1}.${j + 1}`} className={styles.section} key={j}>
          <ReturnBar context={returnContext} targetId={`${i+1}.${j+1}`} onReturn={returnToOrigin} onDismiss={() => setReturnContext(null)} />
          <h3>{i + 1}.{j + 1}. {section.text} <button type="button" className={styles.share} onClick={() => void navigator.clipboard?.writeText(`${location.origin}/compendium/rules#section-${i+1}.${j+1}`)}>Copy link</button></h3>
          <ol className={styles.paragraphs}>{section.children.map((node, k) => <RuleParagraph key={k} node={node} id={`${i + 1}.${j + 1}.${k + 1}`} depth={3}
            onTerm={setTerm} onCrossRef={handleCrossRef} returnContext={returnContext}
            onReturn={returnToOrigin} onDismiss={() => setReturnContext(null)} />)}</ol>
        </section>)}
      </section>)}

      <section className={styles.appendix} id="rulebook-errata"><h2>Errata</h2>
        <details className={styles.errata}><summary>Card errata from the official rulebook</summary><ul>
          <li>All Flow text is changed from “Flow: If you played another card this turn,” to “Flow: If this is not the first card you played this turn,”</li>
          <li>Diamond Fangzor, despite the toy paint, is intended to be played with the Pyrus Fangzor Character card.</li>
          <li>Hyper Gortion Ultra’s name is intended to be “Hyper Gorthion Ultra” and played with the Darkus Gorthion Ultra Character card.</li>
          <li>Titan Nillious text is changed from “Titan Haos Fangzor.” to “this.”</li>
          <li>Titan Nillious Ultra in some cases is missing a “3” before the Energy icon in its text. In all cases, the text should read “this costs 3 (Energy icon) less to play.”</li>
          <li>Maximus Dragonoid – “If you control Dan Kouzo, Wynton Styles, and Lia Venegas, you win the game.”</li>
        </ul></details>
      </section>

    </main>
    {term && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setTerm(null); }} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="rule-term-heading">
      <button type="button" className={styles.close} onClick={() => setTerm(null)} aria-label="Close explanation">×</button>
      <small>RULE {term.id}</small><h2 id="rule-term-heading">{term.label}</h2>
      <p>{byId.get(term.id + ".1")?.text || term.label}</p>
      <button type="button" onClick={() => jumpTo(term.id)}>Go to full rule →</button>
    </section></div>}
  </div>;
}
