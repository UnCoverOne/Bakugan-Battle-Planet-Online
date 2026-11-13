"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CARDS } from "../../lib/data";
import { cardSetCode } from "../../lib/content/catalogue";
import { DEVELOPER_RULINGS, RULING_CATEGORIES, type RulingRecord } from "../../lib/developer-rulings";
import chrome from "./ReferenceChrome.module.css";
import styles from "./RulingsReference.module.css";
import { ReferenceContentsDrawer } from "./ReferenceContentsDrawer";

// Keep the player-facing order thematic rather than following source question numbers.
const categories = [
  RULING_CATEGORIES[0], RULING_CATEGORIES[1], RULING_CATEGORIES[5],
  RULING_CATEGORIES[3], RULING_CATEGORIES[2], RULING_CATEGORIES[4],
  RULING_CATEGORIES[6],
];
const normalizeCardName = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const referencedRuleLink = (phrase: string): string => {
  const digits = phrase.match(/\d+(?:\.\d+)+/);
  if (digits) return "/compendium/rules#" + (digits[0].split(".").length === 2 ? "section-" : "rule-") + digits[0];
  if (/errata|eratta/i.test(phrase)) return "/compendium/rules#rulebook-errata";
  return "/compendium/rules";
};
function linkOriginalReferences(value: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /\b(?:rule|section)\s+\d+(?:\.\d+)+\b|\b(?:errata|eratta)\b|\b(?:comp|competitive)\s+rules?\b|\bofficial,?\s+complete\s+rulebook\b/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) tokens.push(value.slice(cursor, match.index));
    tokens.push(<a key={match.index} href={referencedRuleLink(match[0])}>{match[0]}</a>);
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length) tokens.push(value.slice(cursor));
  return tokens;
}

export function RulingsReference({ query = "", onCopy }: {
  query?: string;
  onCopy: (path: string, label: string) => Promise<void>;
}) {
  const [category, setCategory] = useState("All");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<RulingRecord | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const normalized = query.trim().toLowerCase();
  const matches = useMemo(() => DEVELOPER_RULINGS.filter((ruling) =>
    (normalized || category === "All" || ruling.category === category)
    && (!normalized || [ruling.title, ruling.preview, ruling.category, ruling.transcript, ...ruling.mentionedCards]
      .some((value) => value.toLowerCase().includes(normalized)))
  ), [category, normalized]);
  const groups = categories.map((name) => ({name, entries: matches.filter((ruling) => ruling.category === name)}))
    .filter((group) => group.entries.length > 0);
  const relatedCards = useMemo(() => {
    if (!selected) return [];
    const seen = new Set<string>();
    return selected.mentionedCards.flatMap((name) => {
      const key = normalizeCardName(name);
      const card = CARDS.find((candidate) =>
        normalizeCardName(candidate.displayName) === key ||
        normalizeCardName(candidate.name) === key ||
        normalizeCardName(candidate.faction + " " + candidate.name) === key);
      if (!card || seen.has(card.catalogId)) return [];
      seen.add(card.catalogId);
      return [card];
    });
  }, [selected]);
  useEffect(() => {
    const reveal = () => {
      const id = window.location.hash.match(/^#ruling-(.+)$/)?.[1];
      if (!id) return;
      const record = DEVELOPER_RULINGS.find((item) => item.slug === id);
      if (!record) return;
      setCategory(record.category);
      setExpanded((current) => current.includes(id) ? current : [...current, id]);
      requestAnimationFrame(() => document.getElementById("ruling-" + id)?.scrollIntoView({block: "start"}));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); trigger.current?.focus(); }};
    addEventListener("keydown", escape);
    return () => { document.body.style.overflow = overflow; removeEventListener("keydown", escape); };
  }, [selected]);
  const close = () => {setSelected(null); trigger.current?.focus();};
  const chooseCategory = (next: string) => {
    setCategory(next);
    requestAnimationFrame(() => document.getElementById("rulings-reading")?.scrollIntoView({block: "start"}));
  };
  return <div className={chrome.layout}>
    <ReferenceContentsDrawer className={chrome.contents} label="Rulings categories">
      <h2>Categories</h2>
      <button type="button" aria-pressed={category === "All"} onClick={() => chooseCategory("All")}>All Rulings</button>
      {categories.map((name) => <button type="button" key={name} aria-pressed={category === name}
        onClick={() => chooseCategory(name)}>{name}</button>)}
    </ReferenceContentsDrawer>
    <main className={chrome.main} id="rulings-reading">
      {groups.map(({name, entries}) => <section className={styles.group} key={name}>
        <h2>{name}</h2>
        <div className={styles.list}>
          {entries.map((ruling) => {
            const isExpanded = expanded.includes(ruling.slug);
            return <article id={"ruling-" + ruling.slug} className={styles.article} key={ruling.slug}>
              <h3><button className={styles.expandButton} type="button" aria-expanded={isExpanded}
                aria-controls={"ruling-body-" + ruling.slug}
                onClick={() => setExpanded((current) => isExpanded ? current.filter((id) => id !== ruling.slug) : [...current, ruling.slug])}>
                <span>{ruling.title}</span><span className={styles.chevron} aria-hidden="true">{isExpanded ? "⌃" : "⌄"}</span>
              </button></h3>
              {isExpanded && <div className={styles.answer} id={"ruling-body-" + ruling.slug}>
                <p>{ruling.preview}</p>
                <footer>
                  <span>Developer ruling · Site-formatted explanation</span>
                  <button type="button" onClick={(event) => {trigger.current = event.currentTarget; setSelected(ruling);}}>Original Q&amp;A</button>
                  <button type="button" onClick={() => void onCopy("/compendium/rulings#ruling-" + ruling.slug, ruling.title)}>Copy link</button>
                </footer>
              </div>}
            </article>;
          })}
        </div>
      </section>)}
      {groups.length === 0 && <section className={styles.empty} role="status"><h2>No rulings found</h2><p>Try another search or select All Rulings.</p><button type="button" onClick={() => chooseCategory("All")}>All Rulings</button></section>}
    </main>
    {selected && <div role="presentation" className={styles.backdrop} onMouseDown={(event) => {if (event.target === event.currentTarget) close();}}>
      <section role="dialog" aria-modal="true" aria-labelledby="ruling-dialog-title" className={styles.modal}>
        <button ref={closeButton} className={styles.close} type="button" aria-label="Close original Q and A" onClick={close}>×</button>
        <h2 id="ruling-dialog-title">{selected.title}</h2>
        <h3>Original question and developer response</h3>
        <div className={styles.transcript}>
          {selected.transcript.split(/\n\s*\n/).filter(Boolean).map((part, i) =>
            <p key={i} className={/^\s*Dev Response/i.test(part) ? styles.response : undefined}>
              {linkOriginalReferences(part.trim())}
            </p>)}
        </div>
        {relatedCards.length > 0 && <section className={styles.related} aria-label="Related cards">
          <h3>Related cards</h3>
          <div className={styles.cardLinks}>
            {relatedCards.map((card) => <a key={card.catalogId} href={"/compendium?card=" + encodeURIComponent(card.slug || card.catalogId)}>{card.displayName} <span>{cardSetCode(card)}</span></a>)}
          </div>
        </section>}
      </section>
    </div>}
  </div>;
}
