"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GLOSSARY_TERMS } from "../../lib/glossary";
import { RULEBOOK_ERRATA, rulebookAnchor, selectRulebook, type VisibleRule } from "../../lib/rulebook-reader";
import styles from "./OfficialRulebook.module.css";
import { CompendiumSidebar } from "./CompendiumSidebar";
import { ContentsNavigation } from "./ContentsNavigation";

// Avoid automatically linking ordinary words that can be mistaken for game terms.
const ambiguousTerms = new Set([
  "art", "cards", "name", "text", "numbers", "cost", "open", "stop",
  "charge", "spend", "hand", "deck", "effects", "hero", "flip",
]);
const terms = GLOSSARY_TERMS.filter(term =>
  !ambiguousTerms.has(term.title.toLowerCase()) && !term.title.includes("(")
).sort((a, b) => b.title.length - a.title.length);
const termsByName = new Map(terms.map(term => [term.title.toLowerCase(), term]));
const escapeRegex = (text: string) => text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const glossaryPattern = new RegExp("\\b(" + terms.map(term => escapeRegex(term.title)).join("|") + ")\\b", "gi");
const referencePattern = /\b(?:see\s+)?(?:rule|section)\s+(\d+(?:\.\d+)*)(?:\.)?/gi;

function highlighted(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let pos = lower.indexOf(query);
  while (pos !== -1) {
    if (pos > cursor) parts.push(text.slice(cursor, pos));
    parts.push(<mark key={pos} className={styles.highlight}>{text.slice(pos, pos + query.length)}</mark>);
    cursor = pos + query.length;
    pos = lower.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}
function linkedTerms(text: string, query: string, key: string): ReactNode[] {
  const pieces: ReactNode[] = [];
  const pattern = new RegExp(glossaryPattern.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) pieces.push(<span key={key + "-plain-" + cursor}>{highlighted(text.slice(cursor, match.index), query)}</span>);
    const term = termsByName.get(match[0].toLowerCase());
    if (term) pieces.push(
      <a key={key + "-term-" + match.index} className={styles.glossaryLink}
        href={"/compendium/glossary#glossary-" + term.key} title={"Glossary: " + term.title}>
        {highlighted(match[0], query)}
      </a>
    );
    else pieces.push(<span key={key + "-unlinked-" + match.index}>{highlighted(match[0], query)}</span>);
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) pieces.push(<span key={key + "-tail-" + cursor}>{highlighted(text.slice(cursor), query)}</span>);
  return pieces;
}
function linkedText(text: string, query: string): ReactNode[] {
  const chunks: ReactNode[] = [];
  const references = new RegExp(referencePattern.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = references.exec(text))) {
    chunks.push(...linkedTerms(text.slice(cursor, match.index), query, "part-" + cursor));
    const anchor = rulebookAnchor(match[1]);
    if (anchor) chunks.push(
      <a key={"reference-" + match.index} className={styles.crossref}
        href={"/compendium/rules#" + anchor}>{highlighted(match[0], query)}</a>
    );
    else chunks.push(<span key={"unresolved-" + match.index}>{highlighted(match[0], query)}</span>);
    cursor = references.lastIndex;
  }
  chunks.push(...linkedTerms(text.slice(cursor), query, "part-" + cursor));
  return chunks;
}

function RuleParagraph({ rule, query }: { rule: VisibleRule; query: string }) {
  return <li className={styles.rule} id={"rule-" + rule.id}>
    <div className={styles.ruleRow}>
      <a className={styles.number} href={"#rule-" + rule.id}
        aria-label={"Link to rule " + rule.id} title={"Link to rule " + rule.id}>
        {highlighted(rule.id, query)}
      </a>
      <div className={styles.ruleCopy}>{linkedText(rule.text, query)}</div>
    </div>
    {rule.children.length > 0 && <ol className={styles.ruleList}>
      {rule.children.map(child => <RuleParagraph key={child.id} rule={child} query={query} />)}
    </ol>}
  </li>;
}

export function OfficialRulebook({ query = "", sidebarOpen, desktopSidebarVisible, onSidebarClose }: {
  query?: string; sidebarOpen: boolean; desktopSidebarVisible: boolean; onSidebarClose: () => void;
}) {
  const normalized = query.trim().toLowerCase();
  const [target, setTarget] = useState("");
  useEffect(() => {
    const readHash = () => setTarget(window.location.hash.slice(1));
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
    };
  }, []);
  const { chapters, errata } = useMemo(() => selectRulebook(normalized, target), [normalized, target]);
  useEffect(() => {
    // A direct link must still be revealed while the query hides unrelated rules.
    if (!normalized || !target) return;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({
      block: "start", behavior: "auto",
    }));
    return () => cancelAnimationFrame(frame);
  }, [normalized, target]);
  const hasResults = chapters.length > 0 || errata.length > 0;
  return <div className={styles.reader} data-rulebook-reader data-compendium-reference-layout>
    <CompendiumSidebar as="nav" label="Contents" open={sidebarOpen}
      desktopVisible={desktopSidebarVisible} onClose={onSidebarClose}>
      <ContentsNavigation onNavigate={sidebarOpen ? onSidebarClose : undefined} items={[
        ...chapters.map(chapter => ({
          id: "chapter-" + chapter.id, label: chapter.id + ". " + chapter.text,
          children: chapter.sections.map(section => ({
            id: "section-" + section.id, label: section.id + " " + section.text,
          })),
        })),
        ...(errata.length ? [{ id: "rulebook-errata", label: "Errata" }] : []),
      ]} />
    </CompendiumSidebar>
    <main className={styles.main}>
      {normalized && <p className={styles.searchStatus} role="status">Results for <strong>{query.trim()}</strong></p>}
      {chapters.map(chapter => <section className={styles.chapter}
        id={"chapter-" + chapter.id} key={chapter.id} aria-labelledby={"chapter-title-" + chapter.id}>
        <div className={styles.chapterHeading}>
          <a className={styles.chapterNumber} href={"#chapter-" + chapter.id}
            aria-label={"Link to chapter " + chapter.id}>CHAPTER {highlighted(chapter.id, normalized)}</a>
          <h2 id={"chapter-title-" + chapter.id}>{highlighted(chapter.text, normalized)}</h2>
        </div>
        {chapter.sections.map(section => <section className={styles.section}
          id={"section-" + section.id} key={section.id}
          aria-labelledby={"section-title-" + section.id.replaceAll(".", "-")}>
          <h3 id={"section-title-" + section.id.replaceAll(".", "-")}>
            <a className={styles.sectionNumber} href={"#section-" + section.id}
              aria-label={"Link to section " + section.id}>{highlighted(section.id, normalized)}</a>
            <span>{highlighted(section.text, normalized)}</span>
          </h3>
          <ol className={styles.ruleList}>
            {section.rules.map(rule => <RuleParagraph key={rule.id} rule={rule} query={normalized} />)}
          </ol>
        </section>)}
      </section>)}
      {errata.length > 0 && <section className={styles.appendix} id="rulebook-errata"
        aria-labelledby="rulebook-errata-heading">
        <h2 id="rulebook-errata-heading">Errata</h2>
        <p className={styles.errataIntro}>Card errata from the official rulebook</p>
        <ul className={styles.errataList}>
          {errata.map(correction =>
            <li key={RULEBOOK_ERRATA.indexOf(correction)}>{highlighted(correction, normalized)}</li>)}
        </ul>
      </section>}
      {!hasResults && <section className={styles.empty} role="status">
        <h2>No matching rules or errata</h2><p>Try a different search.</p>
      </section>}
    </main>
  </div>;
}
