"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent, type MouseEvent, type TouchEvent } from "react";
import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import { CardFactionTag } from "../routes/CardFactionTag";
import galleryStyles from "../routes/CardsGallery.module.css";
import { CARD_SET_INFO, cardCollectorLabel, cardSetCode } from "../../lib/content/catalogue";
import { cardArtSource } from "../../lib/content/card-art";
import { CARD_INSPECTOR_TABS, type CardInspectorTab } from "../../lib/compendium";
import {
  inspectorCardPrintings, inspectorDeveloperRulings, inspectorEvolutionBases,
  inspectorEvolutionChildren, inspectorFusionFace, inspectorOfficialRules,
} from "../../lib/card-inspector-data";
import { collectionEntry, type Collection, type CollectionField } from "../../lib/collection";
import { isCancelledEvo } from "../../lib/evo-relationships";
import { coreEffects } from "../../lib/core-preview";
import type { Core, GameCard } from "../../lib/game";
import { SYMBOL_ENTRIES } from "../../lib/reference";
import { MotionValue } from "../design-system/MotionValue";
import { BakuganRollingStat, bakuganRollingValues } from "./BakuganRollingStats";
import { ResponsiveCardImage } from "./ResponsiveCardImage";
import { InspectorModal } from "./InspectorModal";
import styles from "./CardInspector.module.css";

type SharedProps = {
  tab?: CardInspectorTab;
  mode?: "modal" | "embedded";
  onTabChange?: (tab: CardInspectorTab) => void;
  onClose?: () => void;
  onShare?: () => void;
  returnFocusRef?: { current: HTMLElement | null };
  className?: string;
  collectionEnabled?: boolean;
  collection?: Collection;
  onCollectionChange?: (catalogId: string, field: CollectionField, delta: number) => void;
  /** The physical printing, encoded separately from the playable-card identity in the URL. */
  printingId?: string;
  onPrintingChange?: (printingId: string) => void;
};

export type InspectorProps = SharedProps & (
  | { card: GameCard; allCards: readonly GameCard[]; onSelectCard?: (card: GameCard) => void;
      core?: never; preferredCorePrintingId?: never }
  | { core: Core; allCores?: readonly Core[]; preferredCorePrintingId?: string;
      card?: never; allCards?: never; onSelectCard?: never }
);

const tabLabels: Record<CardInspectorTab, string> = {
  overview: "Overview", references: "References", collection: "Collection",
};

const signed = (value: number) => value > 0 ? "+" + value : String(value);

function EffectText({ text }: { text: string }) {
  const pattern = /(\[[^\]]+\])/g;
  return <>{text.split(pattern).map((part, index) => {
    const icon = SYMBOL_ENTRIES.find(entry => entry.token === part);
    return icon
      ? <OriginalImage key={index} className={styles.inlineSymbol}
          src={icon.asset} alt={icon.name} width="18" height="18" />
      : <span key={index}>{part}</span>;
  })}</>;
}

function CollectionPanel({ id, collection, onChange }: {
  id: string;
  collection: Collection;
  onChange?: (id: string, field: CollectionField, delta: number) => void;
}) {
  const current = collectionEntry(collection, id);
  return <section className={styles.collectionPanel} aria-label="Selected printing quantities">
    <p className={styles.collectionIntro}>Quantities for the printing shown in the artwork. Switch printings using the artwork controls.</p>
    {(["standard", "foil", "wishlist"] as const).map(field =>
      <div className={styles.collectionRow} key={field}>
        <span>{field[0].toUpperCase() + field.slice(1)}</span>
        <div className={styles.stepper}>
          <button type="button" aria-label={"Decrease " + field + " copies"} disabled={!current[field]}
            onClick={() => onChange?.(id, field, -1)}><LucideIcon name="minus" size={16}/></button>
          <output aria-label={field + " copies"}><MotionValue value={current[field]} /></output>
          <button type="button" aria-label={"Increase " + field + " copies"}
            onClick={() => onChange?.(id, field, 1)}><LucideIcon name="plus" size={16}/></button>
        </div>
      </div>
    )}
    <p className={styles.collectionHelp}>Changes are saved to your account separately for each printing.</p>
  </section>;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.stat}>
    <dt>{label}</dt><dd>{children}</dd>
  </div>;
}

function CardOverview({ card, allCards, onSelectCard }: {
  card: GameCard;
  allCards: readonly GameCard[];
  onSelectCard?: (card: GameCard) => void;
}) {
  const rolling = bakuganRollingValues(card);
  const bases = inspectorEvolutionBases(card, allCards);
  const children = inspectorEvolutionChildren(card, allCards);
  const cancelledEvo = card.type === "Evo" && isCancelledEvo(card.catalogId);
  const hasStats = card.bPower !== null || card.damage !== null ||
    card.type !== "Character" || card.armorRating !== undefined;
  return <div className={styles.overview}>
    {hasStats && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Card statistics</h3>
      <dl className={styles.stats}>
        {card.bPower !== null && <Stat label="B-Power">{card.bPower.toLocaleString()}</Stat>}
        {card.damage !== null && <Stat label="Damage">{card.damage}</Stat>}
        {card.type !== "Character" && <Stat label="Energy">{card.cost}</Stat>}
        {card.armorRating !== undefined && <Stat label="Armor">{card.armorRating}</Stat>}
      </dl>
      {rolling && <dl className={styles.rolling}>
        <div><dt>Roll Accuracy</dt><dd><BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} plain /></dd></div>
        <div><dt>Double Core Chance</dt><dd><BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} plain /></dd></div>
        <span>Estimated in-game rolling probabilities</span>
      </dl>}
    </section>}
    {card.effect.trim() && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Printed effect</h3>
      <p className={styles.effect}><EffectText text={card.effect} /></p>
    </section>}
    {card.coreTypes.length > 0 && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>BakuCore requirements</h3>
      <div className={styles.detailTags}>{card.coreTypes.map((type, i) =>
        <span className={galleryStyles.tag} key={type + i}>{type}</span>)}</div>
    </section>}
    {card.mechanics.length > 0 && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Keywords</h3>
      <div className={styles.keywords}>{card.mechanics.map(word =>
        <span className={galleryStyles.tag} key={word}>{word}</span>)}</div>
    </section>}
    {card.type === "Evo" && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Evolves from</h3>
      {cancelledEvo
        ? <p className={styles.muted}>Cancelled Evo — no corresponding Character Card exists. This Evo has no legal target.</p>
        : bases.length ? <>
          <div className={styles.linkList}>
            {bases.map(base => <button type="button" key={base.catalogId} className={styles.cardLink}
              onClick={() => onSelectCard?.(base)}>
              <ResponsiveCardImage card={base} presentation="thumbnail" alt="" />
              <span><strong>{base.displayName}</strong><small>{CARD_SET_INFO[cardSetCode(base)].name} · {base.fusionFace === "b" ? "Fused Character" : "Character"}</small></span>
              <span className={styles.linkArrow} aria-hidden="true"><LucideIcon name="arrow-up-right" size={16}/></span>
            </button>)}
          </div>
          {bases.some(base => base.fusionFace === "b") &&
            <p className={styles.muted}>Requires the matching Bakugan to be fused before playing this Evo.</p>}
        </>
        : <p className={styles.muted}>No compatible Character card is currently linked in the catalogue.</p>}
    </section>}
    {children.length > 0 && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Evolutions</h3>
      <div className={styles.linkList}>
        {children.map(evo => <button type="button" key={evo.catalogId} className={styles.cardLink}
          onClick={() => onSelectCard?.(evo)}>
          <ResponsiveCardImage card={evo} presentation="thumbnail" alt="" />
          <span><strong>{evo.displayName}</strong><small>{CARD_SET_INFO[cardSetCode(evo)].name} · Evo</small></span>
          <span className={styles.linkArrow} aria-hidden="true"><LucideIcon name="arrow-up-right" size={16}/></span>
        </button>)}
      </div>
    </section>}
    <footer className={styles.collector}>
      <span>Collector number</span><strong>{cardCollectorLabel(card)}</strong>
    </footer>
  </div>;
}

function CoreOverview({ core, display }: { core: Core; display: Core }) {
  const modifiers = coreEffects(core);
  const specials = modifiers.filter(item => !["power", "damage"].includes(item.kind));
  return <div className={styles.overview}>
    {(core.bonus !== 0 || core.damageBonus !== 0) && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Core modifiers</h3>
      <dl className={styles.stats}>
        {core.bonus !== 0 && <Stat label="B-Power">{signed(core.bonus)}</Stat>}
        {core.damageBonus !== 0 && <Stat label="Damage">{signed(core.damageBonus)}</Stat>}
      </dl>
    </section>}
    {specials.length > 0 && <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Special effects</h3>
      <ul className={styles.coreEffects}>{specials.map(item =>
        <li key={item.kind}>{item.label}</li>)}</ul>
    </section>}
    <footer className={styles.collector}>
      <span>Collector number</span>
      <strong>{display.set === "Armored Alliance" ? "AA" : "BB"} #{display.number}</strong>
    </footer>
  </div>;
}

function References({ card, core, allCards }: {
  card?: GameCard; core?: Core; allCards: readonly GameCard[];
}) {
  const rules = inspectorOfficialRules(card, core);
  const rulings = inspectorDeveloperRulings(card, core, allCards);
  return <div className={styles.references}>
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Official Rules</h3>
      {rules.length > 0 ? <ul className={styles.referenceList}>
        {rules.map(rule => <li key={rule.id}>
          <a href={rule.href}><span>Section {rule.id}</span><strong>{rule.title}</strong><span aria-hidden="true"><LucideIcon name="arrow-up-right" size={16}/></span></a>
        </li>)}
      </ul> : <p className={styles.muted}>No directly applicable section was identified in the 2019 rulebook.</p>}
    </section>
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Developer Rulings</h3>
      {rulings.length > 0 ? <>
        <p className={styles.referenceNote}>{core
          ? "Published decisions concerning this BakuCore modifier."
          : "Published exchanges that explicitly mention this card."}</p>
        <ul className={styles.referenceList}>
          {rulings.map(ruling => <li key={ruling.slug}>
            <a href={"/compendium/rulings#ruling-" + ruling.slug}>
              <span>Q{ruling.number}</span><strong>{ruling.title}</strong><span aria-hidden="true"><LucideIcon name="arrow-up-right" size={16}/></span>
            </a>
            <p>{ruling.preview}</p>
          </li>)}
        </ul>
      </> : <p className={styles.muted}>No card-specific published developer exchange is currently linked.</p>}
    </section>
  </div>;
}

export function CardInspector(props: InspectorProps) {
  const {
    tab = "overview", mode = "modal", onTabChange, onClose, onShare, returnFocusRef, className,
    collectionEnabled = false, collection = {}, onCollectionChange,
    printingId = "", onPrintingChange,
  } = props;
  const card = "card" in props ? props.card : undefined;
  const core = "core" in props ? props.core : undefined;
  const allCards = "allCards" in props && props.allCards ? props.allCards : [];
  const onSelectCard = "onSelectCard" in props ? props.onSelectCard : undefined;
  const preferredCorePrintingId = "preferredCorePrintingId" in props ? props.preferredCorePrintingId : undefined;
  const baseCard = useMemo(() => {
    if (!card?.fusionPairId) return card;
    return allCards.find(candidate =>
      candidate.fusionPairId === card.fusionPairId && candidate.fusionFace === "a") ?? card;
  }, [card, allCards]);
  const printings = useMemo(() =>
    baseCard ? inspectorCardPrintings(baseCard, allCards) : [],
  [baseCard, allCards]);
  const corePrintings = useMemo(() => core ? [
    { id: core.catalogId ?? core.id, card: core },
    ...(core.printings ?? []).map(printing => ({
      id: printing.id, card: { ...core, set: printing.set, number: printing.number, art: printing.art },
    })),
  ] : [], [core]);
  const defaultPrinting = baseCard?.catalogId ?? preferredCorePrintingId ?? corePrintings[0]?.id ?? "";
  const [localPrinting, setLocalPrinting] = useState(printingId || defaultPrinting);
  const [fusionFace, setFusionFace] = useState<"a" | "b">(card?.fusionFace === "b" ? "b" : "a");
  const [zoom, setZoom] = useState(false);
  const zoomTrigger = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const rawKey = baseCard?.catalogId ?? core?.id ?? "";
  useEffect(() => {
    setLocalPrinting(printingId || defaultPrinting);
  }, [rawKey, printingId, defaultPrinting]);
  // Switching printings does not silently reset the chosen fusion face.
  useEffect(() => {
    setFusionFace(card?.fusionFace === "b" ? "b" : "a");
    setZoom(false);
  }, [rawKey, card?.fusionFace]);
  const cardPrint = printings.find(candidate => candidate.catalogId === (printingId || localPrinting))
    ?? printings.find(candidate => candidate.catalogId === baseCard?.catalogId) ?? baseCard;
  const displayedCard = cardPrint ? inspectorFusionFace(cardPrint, allCards, fusionFace) : undefined;
  const corePrint = corePrintings.find(candidate => candidate.id === (printingId || localPrinting))
    ?? corePrintings.find(candidate => candidate.id === defaultPrinting) ?? corePrintings[0];
  const displayedCore = corePrint?.card;
  const currentId = cardPrint?.catalogId ?? corePrint?.id ?? "";
  const slides = baseCard ? printings.map(candidate => candidate.catalogId) : corePrintings.map(candidate => candidate.id);
  const slideIndex = Math.max(0, slides.indexOf(currentId));
  const hasMultiple = slides.length > 1;
  const hasFusion = Boolean(cardPrint?.fusionPairId &&
    allCards.some(candidate => candidate.fusionPairId === cardPrint.fusionPairId && candidate.fusionFace === "b"));
  const label = displayedCard?.displayName ?? core?.name ?? "Inspector";
  const id = "inspector-" + (baseCard?.catalogId ?? core?.catalogId ?? core?.id ?? "item");
  const visibleTabs = CARD_INSPECTOR_TABS.filter(value => value !== "collection" || collectionEnabled);
  const activeTab: CardInspectorTab = visibleTabs.includes(tab) ? tab : "overview";
  const openZoom = (trigger: HTMLElement) => { zoomTrigger.current = trigger; setZoom(true); };
  const selectPrinting = (next: string) => {
    setLocalPrinting(next);
    onPrintingChange?.(next);
    setZoom(false);
  };
  const navigatePrinting = (step: number) => {
    const target = slideIndex + step;
    if (target >= 0 && target < slides.length) selectPrinting(slides[target]);
  };
  const onImageTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    suppressClick.current = false;
  };
  const onImageTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const from = touchStart.current;
    touchStart.current = null;
    if (!from || !hasMultiple) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      suppressClick.current = true;
      navigatePrinting(dx < 0 ? 1 : -1);
    }
  };
  const onImageClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    openZoom(event.currentTarget);
  };
  const onArtworkKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!hasMultiple || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    navigatePrinting(event.key === "ArrowRight" ? 1 : -1);
  };
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = items.findIndex(item => item === document.activeElement);
    if (index === -1) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
      (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
    onTabChange?.(visibleTabs[next]);
  };
  // Use the exact compact, square metadata tags from the Cards gallery, including
  // its colour-coded faction glyphs and abbreviated type/set labels.
  const identityTags: ReactNode = displayedCard
    ? <>
      <span className={galleryStyles.factions} aria-label={displayedCard.factions.join(" / ")}>
        {displayedCard.factions.map(faction =>
          <CardFactionTag key={faction} faction={faction} />)}
      </span>
      <span className={`${galleryStyles.tag} ${galleryStyles.typeTag}`}
        title={displayedCard.type === "Character" ? "Character Card" : displayedCard.type}
        aria-label={displayedCard.type === "Character" ? "Character Card" : displayedCard.type}>
        {displayedCard.type === "Character" ? "CC" : displayedCard.type}
      </span>
      <span className={galleryStyles.tag}
        title={CARD_SET_INFO[cardSetCode(displayedCard)].name}
        aria-label={CARD_SET_INFO[cardSetCode(displayedCard)].name}>
        {cardSetCode(displayedCard)}
      </span>
      <span className={galleryStyles.tag} title={`Rarity: ${displayedCard.rarity}`}>
        {displayedCard.rarity}
      </span>
    </>
    : core && displayedCore
      ? <>
        <span className={galleryStyles.tag}>{core.type}</span>
        <span className={galleryStyles.tag}
          title={displayedCore.set ?? "Battle Brawlers"}
          aria-label={displayedCore.set ?? "Battle Brawlers"}>
          {displayedCore.set === "Armored Alliance" ? "AA" : "BB"}
        </span>
      </>
      : null;
  const currentCollectionId = cardPrint?.catalogId ?? corePrint?.id ?? "";

  const contents = <>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id={id + "-title"} title={label}>{label}</h2>
        <div className={styles.tags} aria-label="Card details">{identityTags}</div>
      </div>
      <div className={styles.headerActions}>
        {onShare && <button type="button" onClick={onShare} aria-label={"Copy link to " + label}
          title="Copy link">Share</button>}
        {onClose && <button type="button" data-inspector-close onClick={onClose}
          aria-label={"Close " + (core ? "BakuCore" : "card") + " inspector"}>Close</button>}
      </div>
    </header>
    <div className={styles.workspace}>
      <div className={styles.artColumn}>
        <div className={styles.carousel} aria-label={"Artwork for " + label}>
          {hasMultiple && <button type="button" className={styles.previous}
            onClick={() => navigatePrinting(-1)} disabled={slideIndex === 0}
            aria-label="Previous printing"><LucideIcon name="chevron-left" size={24}/></button>}
          <div className={styles.artStack}>
            <button type="button" className={styles.artButton} onClick={onImageClick}
              onKeyDown={onArtworkKeyDown}
              onTouchStart={onImageTouchStart} onTouchEnd={onImageTouchEnd}
              aria-label={"Enlarge artwork: " + label}>
              {displayedCard && <ResponsiveCardImage card={displayedCard}
                presentation="inspector" alt={label} />}
              {displayedCore && <BakuCoreArt core={displayedCore} alt={label} />}
            </button>
            {hasFusion && <div className={styles.faceSelector} role="group" aria-label="Card face">
              <div className={styles.faceOptions}>
                <button type="button"
                  className={fusionFace === "a" ? `${styles.faceOption} ${styles.faceOptionActive}` : styles.faceOption}
                  aria-pressed={fusionFace === "a"}
                  onClick={() => setFusionFace("a")}>Unfused</button>
                <button type="button"
                  className={fusionFace === "b" ? `${styles.faceOption} ${styles.faceOptionActive}` : styles.faceOption}
                  aria-pressed={fusionFace === "b"}
                  onClick={() => setFusionFace("b")}>Fused</button>
              </div>
            </div>}
          </div>
          {hasMultiple && <button type="button" className={styles.next}
            onClick={() => navigatePrinting(1)} disabled={slideIndex === slides.length - 1}
            aria-label="Next printing"><LucideIcon name="chevron-right" size={24}/></button>}
        </div>
        {hasMultiple && <div className={styles.printingIndicator} role="status" aria-live="polite">
          Printing {slideIndex + 1} of {slides.length}
          <div className={styles.dots} aria-hidden="true">
            {slides.map((slide,i) => <span key={slide} data-active={i === slideIndex} />)}
          </div>
        </div>}
      </div>
      <div className={styles.infoColumn}>
        <div role="tablist" aria-label={label + " information"} className={styles.tabs}
          onKeyDown={onTabsKeyDown}>
          {visibleTabs.map(candidate => <button type="button" role="tab"
            key={candidate} id={id + "-tab-" + candidate}
            tabIndex={candidate === activeTab ? 0 : -1}
            aria-controls={id + "-panel"}
            aria-selected={candidate === activeTab}
            className={candidate === activeTab ? styles.activeTab : undefined}
            onClick={() => onTabChange?.(candidate)}>{tabLabels[candidate]}</button>)}
        </div>
        <div className={styles.infoBody} id={id + "-panel"}
          role="tabpanel" aria-labelledby={id + "-tab-" + activeTab} tabIndex={0}
          data-ui="inspector-tab-content">
          {activeTab === "overview" && displayedCard &&
            <CardOverview card={displayedCard} allCards={allCards} onSelectCard={onSelectCard} />}
          {activeTab === "overview" && core && displayedCore &&
            <CoreOverview core={core} display={displayedCore} />}
          {activeTab === "references" &&
            <References card={displayedCard} core={core} allCards={allCards} />}
          {activeTab === "collection" && collectionEnabled &&
            <CollectionPanel id={currentCollectionId} collection={collection} onChange={onCollectionChange} />}
        </div>
      </div>
    </div>
  </>;
  const inspection = mode === "embedded"
    ? <aside data-ui="card-inspector" aria-label={label + " inspector"}
        className={[styles.inspector, styles.embedded, className].filter(Boolean).join(" ")}>
        {contents}
      </aside>
    : <InspectorModal dataUi="card-inspector" titleId={id + "-title"}
        onClose={onClose} returnFocusRef={returnFocusRef}
        className={[styles.inspector, styles.modal, className].filter(Boolean).join(" ")}>
        {contents}
      </InspectorModal>;

  return <>{inspection}{zoom && <InspectorModal dataUi="inspector-art-zoom"
      titleId={id + "-zoom-title"} onClose={() => setZoom(false)}
      returnFocusRef={zoomTrigger} className={styles.zoom}>
      <div className={styles.zoomHeader}>
        <h2 id={id + "-zoom-title"}>{label}</h2>
        <button type="button" onClick={() => setZoom(false)} aria-label="Close enlarged artwork">Close</button>
      </div>
      <div className={styles.zoomImage}>
        {displayedCard && <OriginalImage src={cardArtSource(displayedCard, "full")}
          alt={label} width="720" height="1008" />}
        {displayedCore && <BakuCoreArt core={displayedCore} alt={label} />}
      </div>
    </InspectorModal>}</>;
}
