"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useMemo } from "react";
import { cardCollectorLabel, cardSetCode, CARD_SET_INFO } from "../../lib/content/catalogue";
import {
  CARD_INSPECTOR_TABS,
  relatedCompendiumCards,
  type CardInspectorTab,
} from "../../lib/compendium";
import type { GameCard } from "../../lib/game";
import { SYMBOL_ENTRIES, type ReferenceEntry } from "../../lib/reference";
import { StatusChip, Tabs } from "../design-system/primitives";
import { InspectorModal } from "./InspectorModal";
import { ResponsiveCardImage } from "./ResponsiveCardImage";
import styles from "./CardInspector.module.css";

type CardInspectorProps = {
  card: GameCard;
  allCards: readonly GameCard[];
  rules: readonly ReferenceEntry[];
  rulings: readonly ReferenceEntry[];
  tab?: CardInspectorTab;
  mode?: "modal" | "embedded";
  onTabChange?: (tab: CardInspectorTab) => void;
  onSelectCard?: (card: GameCard) => void;
  onClose?: () => void;
  onShare?: () => void;
  returnFocusRef?: { current: HTMLElement | null };
  className?: string;
};

const tabLabels: Record<CardInspectorTab, string> = {
  overview: "Overview",
  rules: "Rules",
  rulings: "Rulings",
  related: "Related",
};

function EffectText({ text }: { text: string }) {
  const pattern = /(\[[^\]]+\])/g;
  return (
    <>
      {text.split(pattern).map((part, index) => {
        const symbol = SYMBOL_ENTRIES.find((item) => item.token === part);
        return symbol
          ? <OriginalImage className={styles.inlineSymbol} src={symbol.asset} alt={symbol.name} width="18" height="18" key={`${part}-${index}`} />
          : <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

const normalizedTerms = (card: GameCard) => [
  card.type,
  card.faction,
  ...card.mechanics,
  ...card.coreTypes,
  ...(card.effect.match(/\b(?:energy|damage|victor|brawl|reroll|team attack|bakucore|flip|hero|evo|faction|batch|priority)\b/gi) ?? []),
].map((value) => value.toLowerCase()).filter((value, index, all) => value.length > 2 && all.indexOf(value) === index);

function matchingReferences(card: GameCard, entries: readonly ReferenceEntry[], maximum: number) {
  const terms = normalizedTerms(card);
  return entries
    .map((entry) => {
      const text = `${entry.title} ${entry.category} ${entry.body}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
    .slice(0, maximum)
    .map(({ entry }) => entry);
}

export function CardInspector({
  card,
  allCards,
  rules,
  rulings,
  tab = "overview",
  mode = "modal",
  onTabChange,
  onSelectCard,
  onClose,
  onShare,
  returnFocusRef,
  className,
}: CardInspectorProps) {
  const relevantRules = useMemo(() => matchingReferences(card, rules, 8), [card, rules]);
  const relevantRulings = useMemo(() => matchingReferences(card, rulings, 8), [card, rulings]);
  const related = useMemo(() => relatedCompendiumCards(card, allCards), [allCards, card]);
  const set = CARD_SET_INFO[cardSetCode(card)];
  const panelId = `card-inspector-${card.catalogId}-${tab}`;
  const titleId = `card-inspector-title-${card.catalogId}`;

  const inspectorContent = (
    <>
      <header className={styles.header}>
        <div>
          <span>{cardCollectorLabel(card)}</span>
          <h2 id={titleId}>{card.displayName}</h2>
        </div>
        <div className={styles.headerActions}>
          {onShare && <button type="button" onClick={onShare} aria-label={`Copy link to ${card.displayName}`}>Share</button>}
          {onClose && <button type="button" data-inspector-close onClick={onClose} aria-label="Close card inspector">Close</button>}
        </div>
      </header>
      <Tabs className={styles.tabs} label={`${card.displayName} information`}>
        {CARD_INSPECTOR_TABS.map((candidate) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            aria-controls={tab === candidate ? panelId : undefined}
            className={tab === candidate ? "active" : ""}
            onClick={() => onTabChange?.(candidate)}
            key={candidate}
          >
            {tabLabels[candidate]}
          </button>
        ))}
      </Tabs>
      <div className={styles.body} id={panelId} role="tabpanel" aria-live="polite">
        {tab === "overview" && (
          <div className={styles.overview}>
            <div className={styles.artWell}>
              <ResponsiveCardImage card={card} presentation="inspector" />
            </div>
            <div className={styles.identity}>
              <div className={styles.chips}>
                {card.factions.map((faction) => <StatusChip tone="info" key={faction}>{faction}</StatusChip>)}
                <StatusChip>{set.name}</StatusChip>
                <StatusChip>{card.rarity}</StatusChip>
              </div>
              {card.effect
                ? <p className={styles.effect}><EffectText text={card.effect} /></p>
                : <p className={styles.muted}>This card has no printed effect text.</p>}
              <dl className={styles.metadata}>
                <div><dt>Type</dt><dd>{card.type}</dd></div>
                <div><dt>Energy</dt><dd>{card.cost}</dd></div>
                <div><dt>Collector</dt><dd>{cardCollectorLabel(card)}</dd></div>
                <div><dt>Catalogue ID</dt><dd>{card.catalogId}</dd></div>
                {card.bPower !== null && <div><dt>B-Power</dt><dd>{card.bPower}</dd></div>}
                {card.damage !== null && <div><dt>Damage</dt><dd>{card.damage}</dd></div>}
                {card.armorRating !== undefined && <div><dt>Armor</dt><dd>{card.armorRating}</dd></div>}
                {card.fusionFace && <div><dt>Fusion face</dt><dd>{card.fusionFace.toUpperCase()}</dd></div>}
                {card.coreTypes.length > 0 && <div><dt>BakuCores</dt><dd>{card.coreTypes.join(" · ")}</dd></div>}
                {card.evolvesFrom && <div><dt>Evolves from</dt><dd>{card.evolvesFrom}</dd></div>}
                <div><dt>Source</dt><dd>{card.source ?? "Provided catalogue"}</dd></div>
              </dl>
              {card.mechanics.length > 0 && (
                <div className={styles.keywords} aria-label="Card keywords">
                  {card.mechanics.map((mechanic) => <span key={mechanic}>{mechanic}</span>)}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "rules" && (
          <ReferenceList
            entries={relevantRules}
            empty="No specific rulebook entry was automatically matched. The printed card text still applies normally."
            label="Relevant rule"
          />
        )}
        {tab === "rulings" && (
          <ReferenceList
            entries={relevantRulings}
            empty="No published ruling is currently linked to this card."
            label="Published ruling"
            ruling
          />
        )}
        {tab === "related" && (
          related.length ? (
            <div className={styles.relatedGrid}>
              {related.map((candidate) => (
                <button type="button" onClick={() => onSelectCard?.(candidate)} key={candidate.catalogId}>
                  <ResponsiveCardImage card={candidate} presentation="thumbnail" alt="" />
                  <span><strong>{candidate.displayName}</strong><small>{cardSetCode(candidate)} · {candidate.type}</small></span>
                </button>
              ))}
            </div>
          ) : <InspectorEmpty message="No evolution, alternate printing, or directly connected card was found." />
        )}
      </div>
    </>
  );

  if (mode === "embedded") {
    return (
      <aside
        data-ui="card-inspector"
        className={[styles.inspector, styles.embedded, className].filter(Boolean).join(" ")}
        aria-label={`${card.displayName} card inspector`}
      >
        {inspectorContent}
      </aside>
    );
  }

  return (
    <InspectorModal
      dataUi="card-inspector"
      titleId={titleId}
      describedBy={panelId}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      className={[styles.inspector, styles.modal, className].filter(Boolean).join(" ")}
    >
      {inspectorContent}
    </InspectorModal>
  );
}

function ReferenceList({
  entries,
  empty,
  label,
  ruling = false,
}: {
  entries: readonly ReferenceEntry[];
  empty: string;
  label: string;
  ruling?: boolean;
}) {
  if (!entries.length) return <InspectorEmpty message={empty} />;
  return (
    <div className={styles.references}>
      {entries.map((entry) => (
        <article key={`${entry.source}-${entry.slug}`}>
          <div>
            <StatusChip tone={ruling ? "success" : "info"}>{ruling ? "Published" : label}</StatusChip>
            <small>Reviewed {entry.reviewedAt}</small>
          </div>
          <h3>{entry.title}</h3>
          <p>{entry.body}</p>
          <footer>{entry.source} · {entry.sourceSection}</footer>
        </article>
      ))}
    </div>
  );
}

function InspectorEmpty({ message }: { message: string }) {
  return (
    <div className={styles.empty}>
      <span>◇</span>
      <h3>Nothing linked yet</h3>
      <p>{message}</p>
    </div>
  );
}
