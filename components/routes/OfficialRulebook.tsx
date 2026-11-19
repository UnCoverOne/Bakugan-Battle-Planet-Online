"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GLOSSARY_TERMS } from "../../lib/glossary";
import {
  RULEBOOK_IDS, ruleAnchor, selectRulebook, type VisibleRule,
} from "../../lib/rulebook-reader";
import styles from "./OfficialRulebook.module.css";
import { CompendiumSidebar } from "./CompendiumSidebar";
import { ContentsNavigation } from "./ContentsNavigation";

// Link only unambiguous reference vocabulary, not ordinary words such as "text".
// Keep official wording intact and link just the first use of a term in each rule.
const ordinaryWords = new Set(["art", "text", "name", "cards", "numbers", "symbols", "open", "stop"]);
const glossaryTargets = new Map(
  GLOSSARY_TERMS.filter(term => !ordinaryWords.has(term.title.toLowerCase()))
    .map(term => [term.title.toLowerCase(), term] as const),
);
for (const [alias, title] of [
  ["BPower", "B-Power"],
  ["BakuCores", "BakuCore"],
  ["Factions", "Faction"],
  ["Character Cards", "Character Card"],
  ["Evo Cards", "Evo"],
  ["Hero Cards", "Hero"],
  ["Flip Cards", "Flip"],
  ["Action Card", "Action Cards"],
] as const) {
  const term = GLOSSARY_TERMS.find(entry => entry.title === title);
  if (term) glossaryTargets.set(alias.toLowerCase(), term);
}
const escapePattern = (word: string) => word.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const termsPattern = new RegExp(
  "\\b(?:" + [...glossaryTargets.keys()].sort((a, b) => b.length - a.length)
    .map(escapePattern).join("|") + ")\\b", "gi",
);
const referencePattern = /\b(?:see\s+)?(?:rule|section)\s+(\d+(?:\.\d+)*)/gi;

function highlightText(text: string, search: string, key: string): ReactNode {
  const needle = search.trim().toLowerCase();
  if (!needle || !text.toLowerCase().includes(needle)) return text;
  const parts: ReactNode[] = [];
  const lowered = text.toLowerCase();
  let start = 0;
  let index: number;
  while ((index = lowered.indexOf(needle, start)) !== -1) {
    if (index > start) parts.push(text.slice(start, index));
    parts.push(<mark className={styles.highlight} key={key + "-" + index}>
      {text.slice(index, index + needle.length)}
    </mark>);
    start = index + needle.length;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

function inlineReferences(text: string, search: string): ReactNode[] {
  const chunks: ReactNode[] = [];
  const linkedTerms = new Set<string>();

  const addTerms = (fragment: string, prefix: string) => {
    let start = 0;
    const pattern = new RegExp(termsPattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fragment))) {
      if (match.index > start) chunks.push(highlightText(fragment.slice(start, match.index), search, prefix + "-plain-" + start));
      const term = glossaryTargets.get(match[0].toLowerCase());
      if (term && !linkedTerms.has(term.key)) {
        linkedTerms.add(term.key);
        chunks.push(<a key={prefix + "-term-" + match.index}
          className={styles.termLink} href={"/compendium/glossary#glossary-" + term.key}
          title={"Glossary: " + term.title}>
          {highlightText(match[0], search, prefix + "-term-" + match.index)}
        </a>);
      } else {
        chunks.push(highlightText(match[0], search, prefix + "-word-" + match.index));
      }
      start = pattern.lastIndex;
    }
    if (start < fragment.length) chunks.push(highlightText(fragment.slice(start), search, prefix + "-tail-" + start));
  };

  let start = 0;
  const references = new RegExp(referencePattern.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = references.exec(text))) {
    addTerms(text.slice(start, match.index), "pre-" + start);
    if (RULEBOOK_IDS.has(match[1])) {
      chunks.push(<a key={"reference-" + match.index} className={styles.crossref}
        href={ruleAnchor(match[1])}>
        {highlightText(match[0], search, "reference-" + match.index)}
      </a>);
    } else {
      chunks.push(highlightText(match[0], search, "missing-" + match.index));
    }
    start = references.lastIndex;
  }
  addTerms(text.slice(start), "end-" + start);
  return chunks;
}

function RuleParagraph({ rule, query }: { rule: VisibleRule; query: string }) {
  const depth = rule.id.split(".").length;
  return <li className={styles.rule} id={"rule-" + rule.id} data-depth={depth}>
    <div className={styles.ruleLine}>
      <a className={styles.number} href={ruleAnchor(rule.id)}
        aria-label={"Link to rule " + rule.id} title={"Link to rule " + rule.id}>
        {rule.id}
      </a>
      <div className={styles.ruleText}>{inlineReferences(rule.text, query)}</div>
    </div>
    {rule.children.length > 0 && <ol className={styles.subrules}>
      {rule.children.map(child => <RuleParagraph key={child.id} rule={child} query={query} />)}
    </ol>}
  </li>;
}

export function OfficialRulebook({ query = "", sidebarOpen, desktopSidebarVisible, onSidebarClose }: {
  query?: string;
  sidebarOpen: boolean;
  desktopSidebarVisible: boolean;
  onSidebarClose: () => void;
}) {
  const [anchor, setAnchor] = useState("");
  useEffect(() => {
    const readHash = () => setAnchor(window.location.hash.slice(1));
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
    };
  }, []);
  const selection = useMemo(() => selectRulebook(query, anchor), [query, anchor]);
  const contents = useMemo(() => [
    ...selection.chapters.map(chapter => ({
      id: "chapter-" + chapter.id,
      label: chapter.id + ". " + chapter.text,
      children: chapter.sections.map(section => ({
        id: "section-" + section.id, label: section.id + " " + section.text,
      })),
    })),
    ...(selection.errata.length ? [{ id: "rulebook-errata", label: "Errata" }] : []),
  ], [selection]);

  // After a direct link reveals a section hidden by search, scroll to its
  // stable source anchor. The target stays highlighted via :target.
  useEffect(() => {
    if (!anchor) return;
    const target = document.getElementById(anchor);
    if (!target) return;
    const frame = requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  return <div className={styles.reader} data-rulebook-reader data-compendium-reference-layout>
    <CompendiumSidebar as="nav" label="Contents" open={sidebarOpen}
      desktopVisible={desktopSidebarVisible} onClose={onSidebarClose}>
      <ContentsNavigation onNavigate={sidebarOpen ? onSidebarClose : undefined} items={contents} />
    </CompendiumSidebar>

    <main className={styles.main}>
      {selection.chapters.map(chapter => <section className={styles.chapter}
        id={"chapter-" + chapter.id} aria-labelledby={"chapter-title-" + chapter.id} key={chapter.id}>
        <header className={styles.chapterHeader}>
          <a className={styles.chapterLabel} href={ruleAnchor(chapter.id)}>CHAPTER {chapter.id}</a>
          <h2 id={"chapter-title-" + chapter.id}>{highlightText(chapter.text, query, "chapter-" + chapter.id)}</h2>
        </header>
        {chapter.sections.map(section => <section className={styles.section}
          key={section.id} id={"section-" + section.id}
          aria-labelledby={"section-title-" + section.id}>
          <div className={styles.sectionHeader}>
            <h3 id={"section-title-" + section.id}>
              <a className={styles.sectionNumber} href={ruleAnchor(section.id)}
                aria-label={"Link to section " + section.id}>{section.id}</a>
              {" "}{highlightText(section.text, query, "section-" + section.id)}
            </h3>
          </div>
          <ol className={styles.paragraphs}>
            {section.rules.map(rule => <RuleParagraph key={rule.id} rule={rule} query={query} />)}
          </ol>
        </section>)}
      </section>)}

      {selection.errata.length > 0 && <section className={styles.appendix}
        id="rulebook-errata" aria-labelledby="rulebook-errata-title">
        <header className={styles.chapterHeader}>
          <a className={styles.chapterLabel} href="#rulebook-errata">APPENDIX</a>
          <h2 id="rulebook-errata-title">{highlightText("Errata", query, "errata-heading")}</h2>
        </header>
        <ul className={styles.errataList} aria-label="Card errata from the official rulebook">
          {selection.errata.map(correction =>
            <li key={correction}>{inlineReferences(correction, query)}</li>)}
        </ul>
      </section>}

      {!selection.hasResults && <section className={styles.noResults} role="status">
        <h2>No matching rules</h2>
        <p>Try another search term to find a section or numbered rule.</p>
      </section>}
    </main>
  </div>;
}
