"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CARDS } from "../../lib/data";
import { cardSetCode } from "../../lib/content/catalogue";
import { DEVELOPER_RULINGS, RULING_CATEGORIES, type RulingRecord } from "../../lib/developer-rulings";
import { rulingMatchLocation, rulingTranscriptBlocks, type TranscriptKind } from "../../lib/rulings-reader";
import chrome from "./ReferenceChrome.module.css";
import styles from "./RulingsReference.module.css";
import { CompendiumSidebar } from "./CompendiumSidebar";
import { ContentsNavigation } from "./ContentsNavigation";

// Keep the established player-facing topic order and original question identifiers.
const categories = [
  RULING_CATEGORIES[0], RULING_CATEGORIES[1], RULING_CATEGORIES[5],
  RULING_CATEGORIES[3], RULING_CATEGORIES[2], RULING_CATEGORIES[4],
  RULING_CATEGORIES[6],
];
const sectionId = (value: string) => "rulings-category-" +
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normalizeCardName = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

const referencedRuleLink = (phrase: string): string => {
  const digits = phrase.match(/\d+(?:\.\d+)+/);
  if (digits) return "/compendium/rules#" +
    (digits[0].split(".").length === 2 ? "section-" : "rule-") + digits[0];
  if (/errata|eratta/i.test(phrase)) return "/compendium/rules#rulebook-errata";
  return "/compendium/rules";
};

function highlightText(value: string, query: string, source = false): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle || !value.toLowerCase().includes(needle)) return value;
  const results: ReactNode[] = [];
  const lowered = value.toLowerCase();
  let cursor = 0;
  let index = lowered.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) results.push(value.slice(cursor, index));
    results.push(<mark key={index} className={styles.highlight}
      data-source-match={source ? "" : undefined}>
      {value.slice(index, index + needle.length)}
    </mark>);
    cursor = index + needle.length;
    index = lowered.indexOf(needle, cursor);
  }
  if (cursor < value.length) results.push(value.slice(cursor));
  return results;
}

function linkOriginalReferences(value: string, query: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /\b(?:rule|section)\s+\d+(?:\.\d+)+\b|\b(?:errata|eratta)\b|\b(?:comp|competitive)\s+rules?\b|\bofficial,?\s+complete\s+rulebook\b/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) result.push(highlightText(value.slice(cursor, match.index), query, true));
    result.push(<a key={match.index} href={referencedRuleLink(match[0])}>
      {highlightText(match[0], query, true)}
    </a>);
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length) result.push(highlightText(value.slice(cursor), query, true));
  return result;
}

const blockLabel: Record<TranscriptKind, string> = {
  question: "Question",
  followup: "Follow-up question",
  response: "Developer response",
  correction: "Corrected developer response",
};

export function RulingsReference({ query = "", onCopy, sidebarOpen, desktopSidebarVisible, onSidebarClose }: {
  query?: string;
  onCopy: (path: string, label: string) => Promise<void>;
  sidebarOpen: boolean;
  desktopSidebarVisible: boolean;
  onSidebarClose: () => void;
}) {
  const [selected, setSelected] = useState<RulingRecord | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const dialogBody = useRef<HTMLDivElement | null>(null);
  const normalized = query.trim().toLowerCase();

  const matches = useMemo(() => DEVELOPER_RULINGS.map(ruling => ({
    ruling, location: rulingMatchLocation(ruling, normalized),
  })).filter(result => result.location !== null), [normalized]);
  const groups = categories.map(name => ({
    name, entries: matches.filter(result => result.ruling.category === name),
  })).filter(group => group.entries.length > 0);
  const transcript = useMemo(() => selected ? rulingTranscriptBlocks(selected) : [], [selected]);
  const relatedCards = useMemo(() => {
    if (!selected) return [];
    const seen = new Set<string>();
    return selected.mentionedCards.flatMap(name => {
      const identifier = normalizeCardName(name);
      if (seen.has(identifier)) return [];
      seen.add(identifier);
      const card = CARDS.find(candidate =>
        normalizeCardName(candidate.displayName) === identifier ||
        normalizeCardName(candidate.name) === identifier ||
        normalizeCardName(candidate.faction + " " + candidate.name) === identifier
      );
      return [{ name, card }];
    });
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const oldOverflow = document.body.style.overflow;
    const returnTo = trigger.current;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
      ) ?? []).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [selected]);

  useEffect(() => {
    if (!selected || !normalized) return;
    const scroller = dialogBody.current;
    const firstMatch = scroller?.querySelector<HTMLElement>("[data-source-match]");
    if (!scroller || !firstMatch) return;
    scroller.scrollTop += firstMatch.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top - 24;
  }, [selected, normalized]);

  const close = () => setSelected(null);
  const open = (ruling: RulingRecord, source: HTMLButtonElement) => {
    trigger.current = source;
    setSelected(ruling);
  };

  return <div className={chrome.layout} data-compendium-reference-layout>
    <CompendiumSidebar as="nav" label="Contents" open={sidebarOpen}
      desktopVisible={desktopSidebarVisible} onClose={onSidebarClose}>
      <ContentsNavigation onNavigate={sidebarOpen ? onSidebarClose : undefined}
        items={groups.map(({ name }) => ({ id: sectionId(name), label: name }))} />
    </CompendiumSidebar>
    <main className={chrome.main}>
      <p className={styles.intro}>Summaries condense the published developer rulings.
        View source Q&amp;A to read the original questions, responses and follow-ups.</p>
      {groups.map(({ name, entries }) => <section className={styles.group}
        id={sectionId(name)} key={name} aria-labelledby={sectionId(name) + "-heading"}>
        <header className={styles.groupHeader}>
          <h2 id={sectionId(name) + "-heading"}>{highlightText(name, normalized)}</h2>
          <span>{entries.length} {entries.length === 1 ? "ruling" : "rulings"}</span>
        </header>
        <div className={styles.list}>
          {entries.map(({ ruling, location }) => <article id={"ruling-" + ruling.slug}
            className={styles.article} key={ruling.slug}>
            <button type="button" className={styles.questionNumber}
              title={"Copy link to ruling Q" + ruling.number}
              aria-label={"Copy link to ruling Q" + ruling.number}
              onClick={() => void onCopy("/compendium/rulings#ruling-" + ruling.slug, "Q" + ruling.number)}>
              Q{ruling.number}
            </button>
            <div className={styles.entryBody}>
              <h3>{highlightText(ruling.title, normalized)}</h3>
              <p>{highlightText(ruling.preview, normalized)}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.sourceLink}
                  onClick={event => open(ruling, event.currentTarget)}>View source Q&amp;A</button>
                {location === "source" && <span className={styles.matchNote}>Match in source Q&amp;A</span>}
                {location === "cards" && <span className={styles.matchNote}>Match in related cards</span>}
              </div>
            </div>
          </article>)}
        </div>
      </section>)}
      {groups.length === 0 && <section className={styles.empty} role="status">
        <h2>No rulings found</h2>
        <p>Try another search.</p>
      </section>}
    </main>

    {selected && <div role="presentation" className={styles.backdrop}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} role="dialog" aria-modal="true"
        aria-labelledby="ruling-dialog-title" className={styles.modal}>
        <header className={styles.modalHeader}>
          <div className={styles.modalHeading}>
            <span className={styles.modalLabel}>Source Q&amp;A — Q{selected.number}</span>
            <h2 id="ruling-dialog-title">{selected.title}</h2>
          </div>
          <button ref={closeButton} className={styles.close} type="button"
            aria-label="Close source Q&A" onClick={close}>×</button>
        </header>
        <div ref={dialogBody} className={styles.modalBody}>
          {transcript.some(block => block.kind === "correction") &&
            <p className={styles.correctionNote}>This exchange contains a corrected developer response.
              The ruling summary reflects the final answer.</p>}
          <div className={styles.transcript}>
            {transcript.map((block, index) => <div
              key={index} className={block.kind === "correction" ? styles.correction : styles.transcriptBlock}>
              {(index === 0 || block.kind !== transcript[index - 1].kind) &&
                <span className={styles.blockLabel}>{blockLabel[block.kind]}</span>}
              <p>{linkOriginalReferences(block.text, normalized)}</p>
            </div>)}
          </div>
          {relatedCards.length > 0 && <section className={styles.related} aria-label="Related cards">
            <h3>Related cards</h3>
            <ul className={styles.cardLinks}>
              {relatedCards.map(({ name, card }) => <li key={normalizeCardName(name)}>
                {card ? <a href={"/compendium?card=" + encodeURIComponent(card.slug || card.catalogId)}>
                  {highlightText(name, normalized, true)} <span>{cardSetCode(card)}</span>
                </a> : <span className={styles.unlinkedCard}>{highlightText(name, normalized, true)}</span>}
              </li>)}
            </ul>
          </section>}
        </div>
      </section>
    </div>}
  </div>;
}
