"use client";

import type { GameCard } from "../../lib/game";
import type { CompendiumDensity } from "../../lib/compendium";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import styles from "./CardsGallery.module.css";

type CardsGalleryProps = {
  cards: readonly GameCard[];
  density: CompendiumDensity;
  selectedId?: string;
  onSelect: (card: GameCard, trigger: HTMLButtonElement) => void;
};

/** The Cards catalogue's two visual modes, independent of BakuCores and the inspector. */
export function CardsGallery({ cards, density, selectedId, onSelect }: CardsGalleryProps) {
  const compact = density === "compact";

  return <div data-ui="card-grid" data-cards-gallery data-cards-view={compact ? "compact" : "detailed"}
    className={`${styles.gallery} ${compact ? styles.compact : ""}`}
    aria-label={compact ? "Compact card previews" : "Detailed card previews"}>
    {cards.map(card => {
      const factions = [...new Set(card.factions.length ? card.factions : [card.faction])];
      const set = cardSetCode(card);
      const setName = CARD_SET_INFO[set].name;

      return <button key={card.catalogId} type="button" className={styles.tile}
        aria-label={`Inspect ${card.displayName}, ${factions.join(" / ")}, ${card.type}, ${setName}`}
        aria-pressed={selectedId === card.catalogId}
        onClick={event => onSelect(card, event.currentTarget)}>
        <span className={styles.artwork} data-card-preview>
          <ResponsiveCardImage card={card} presentation="tile" alt="" />
        </span>
        {!compact && <span className={styles.details} data-card-details>
          <strong className={styles.name} data-card-name title={card.displayName}>{card.displayName}</strong>
          <span className={styles.metadata} data-card-meta>
            <span className={styles.factions} aria-label={factions.join(" / ")}>
              {factions.map(faction => <img key={faction} className={styles.faction}
                src={FACTION_SYMBOLS[faction]} width={18} height={18} alt={faction} title={faction} loading="lazy" />)}
            </span>
            <span className={`${styles.tag} ${styles.typeTag}`} title={card.type}>{card.type}</span>
            <span className={styles.tag} title={setName} aria-label={setName}>{set}</span>
          </span>
        </span>}
      </button>;
    })}
  </div>;
}
