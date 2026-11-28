"use client";

import { useMemo, useState } from "react";
import { CARDS } from "../../lib/data";
import type { GameCard } from "../../lib/game";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { LucideIcon } from "../design-system/LucideIcon";
import { useAppFields } from "./AppProvider";
import styles from "./FeedbackReportsDialog.module.css";

const PAGE_SIZE = 40;

export function feedbackCardLabel(card: GameCard) {
  const set = cardSetCode(card);
  return [CARD_SET_INFO[set].name, card.catalogId.toUpperCase(), card.factions.join(" / ") || card.faction, card.type,
    card.fusionFace === "b" ? "Fused face" : card.fusionFace === "a" ? "Unfused face" : ""].filter(Boolean).join(" · ");
}

export function FeedbackCardThumbnail({ card }: { card: GameCard }) {
  return <span className={styles.thumbnail}><ResponsiveCardImage card={card} presentation="thumbnail" alt="" /></span>;
}

/** Same-dialog selection subview; search is rebuilt on live catalogue revisions. */
export function FeedbackCardSelector({ selectedId, onSelect }: {
  selectedId: string; onSelect: (id: string) => void;
}) {
  const { catalogueRevision } = useAppFields(["catalogueRevision"]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const index = useMemo(() => {
    void catalogueRevision;
    return CARDS.map(card => ({
      card, searchable: [card.displayName, card.name, cardSetCode(card), card.number, feedbackCardLabel(card)].join(" ").toLowerCase(),
    })).sort((a,b) => a.card.displayName.localeCompare(b.card.displayName) || a.card.catalogId.localeCompare(b.card.catalogId));
  }, [catalogueRevision]);
  const matches = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    const rank = (card: GameCard) => card.catalogId.toLowerCase() === normalized ? 0
      : card.displayName.toLowerCase() === normalized || card.name.toLowerCase() === normalized ? 1 : 2;
    return index.filter(item => terms.every(term => item.searchable.includes(term)))
      .sort((a,b) => normalized ? rank(a.card) - rank(b.card) : 0);
  }, [index, query]);
  return <div className={styles.selector}>
    <div className={styles.searchBar}>
      <LucideIcon name="search" size={20}/>
      <input type="search" className="bb-field" aria-label="Search cards" placeholder="Search by name, ID, faction or set…" value={query}
        onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}/>
      {query && <button type="button" className={styles.iconButton} aria-label="Clear card search" onClick={() => {setQuery("");setLimit(PAGE_SIZE);}}><LucideIcon name="x" size={20}/></button>}
    </div>
    <div className={styles.resultCount} role="status">{matches.length.toLocaleString()} matching cards</div>
    <ul className={styles.results} aria-label="Matching cards">
      {matches.slice(0, limit).map(({card}) => <li key={card.catalogId}>
        <button type="button" className={styles.cardRow} aria-pressed={selectedId === card.catalogId}
          onClick={() => onSelect(card.catalogId)}>
          <FeedbackCardThumbnail card={card}/>
          <span className={styles.cardIdentity}><strong>{card.displayName}</strong><small>{feedbackCardLabel(card)}</small></span>
          <LucideIcon name={selectedId === card.catalogId ? "check" : "chevron-right"} size={20}/>
        </button>
      </li>)}
    </ul>
    {!matches.length && <p className={styles.empty}>No matching cards. Try another name, ID or set.</p>}
    {limit < matches.length && <button type="button" className="bb-button" onClick={() => setLimit(n => n + PAGE_SIZE)}>Show more cards</button>}
  </div>;
}
