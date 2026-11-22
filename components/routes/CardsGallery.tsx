"use client";

import type { GameCard } from "../../lib/game";
import type { ReactNode } from "react";
import type { CompendiumDensity } from "../../lib/compendium";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { BakuganRollingStat } from "../cards/BakuganRollingStats";
import { bakuganRollingValues } from "../../lib/bakugan-rolling";
import { CardFactionTag } from "./CardFactionTag";
import styles from "./CardsGallery.module.css";

type CardsGalleryProps = {
  cards: readonly GameCard[];
  density: CompendiumDensity;
  selectedId?: string;
  onSelect: (card: GameCard, trigger: HTMLButtonElement) => void;
  /** Optional builder controls are outside the artwork/inspect button. */
  renderControls?: (card: GameCard) => ReactNode;
  resolveCard?: (card: GameCard) => GameCard;
};

/** The Cards catalogue's two visual modes, independent of BakuCores and the inspector. */
export function CardsGallery({ cards, density, selectedId, onSelect, renderControls, resolveCard }: CardsGalleryProps) {
  const compact = density === "compact";

  return <div data-ui="card-grid" data-cards-gallery data-cards-view={compact ? "compact" : "detailed"}
    className={`${styles.gallery} ${compact ? styles.compact : ""}`}
    aria-label={compact ? "Compact card previews" : "Detailed card previews"}>
    {cards.map(card => {
      const displayed = resolveCard?.(card) ?? card;
      const factions = [...new Set(displayed.factions.length ? displayed.factions : [displayed.faction])];
      const set = cardSetCode(displayed);
      const setName = CARD_SET_INFO[set].name;
      const rolling = bakuganRollingValues(displayed);

      const tile = <button key={card.catalogId} type="button" className={styles.tile}
        aria-label={`Inspect ${displayed.displayName}, ${factions.join(" / ")}, ${displayed.type}, ${setName}${rolling ? `, Roll Accuracy ${rolling.rollAccuracy}%, Double Core Chance ${rolling.doubleCoreChance}%` : ""}`}
        aria-pressed={selectedId === displayed.catalogId}
        onClick={event => onSelect(displayed, event.currentTarget)}>
        <span className={styles.artwork} data-card-preview>
          <ResponsiveCardImage card={displayed} presentation="tile" alt="" />
        </span>
        {!compact && <span className={styles.details} data-card-details>
          <strong className={styles.name} data-card-name title={displayed.displayName}>{displayed.displayName}</strong>
          <span className={`${styles.metadata} ${rolling ? styles.metadataWithRolling : ""}`} data-card-meta>
            <span className={styles.factions} aria-label={factions.join(" / ")}>
              {factions.map(faction => <CardFactionTag key={faction} faction={faction} />)}
            </span>
            <span className={`${styles.tag} ${styles.typeTag}`}
              title={displayed.type === "Character" ? "Character Card" : displayed.type}
              aria-label={displayed.type === "Character" ? "Character Card" : displayed.type}>
              {displayed.type === "Character" ? "CC" : displayed.type}
            </span>
            <span className={styles.tag} title={setName} aria-label={setName}>{set}</span>
            {rolling && <>
              <span className={`${styles.tag} ${styles.rollingTag}`}><BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} plain /></span>
              <span className={`${styles.tag} ${styles.rollingTag}`}><BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} plain /></span>
            </>}
          </span>
        </span>}
      </button>;
      return renderControls ? <div key={card.catalogId} className={styles.entry}>{tile}{renderControls(displayed)}</div> : tile;
    })}
  </div>;
}
