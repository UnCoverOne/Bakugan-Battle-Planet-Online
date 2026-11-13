"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { FusionSymbol } from "@/components/media/FusionSymbol";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";

import { useEffect, useMemo, useRef, useState } from "react";
import { cardCollectorLabel, cardSetCode, CARD_SET_INFO } from "../../lib/content/catalogue";
import {
  relatedCompendiumCards,
  type CardInspectorTab,
} from "../../lib/compendium";
import type { Core, GameCard } from "../../lib/game";
import { cardCollectionIds, collectionEntry, coreCollectionIds, type Collection, type CollectionField } from "../../lib/collection";
import { SYMBOL_ENTRIES, type ReferenceEntry } from "../../lib/reference";
import { StatusChip, Tabs } from "../design-system/primitives";
import { InspectorModal } from "./InspectorModal";
import { ResponsiveCardImage } from "./ResponsiveCardImage";
import { BakuganRollingOverlay, BakuganRollingStat, bakuganRollingValues } from "./BakuganRollingStats";
import styles from "./CardInspector.module.css";
import { MotionValue } from "../design-system/MotionValue";

type SharedInspectorProps = {
  rules: readonly ReferenceEntry[];
  rulings: readonly ReferenceEntry[];
  tab?: CardInspectorTab;
  mode?: "modal" | "embedded";
  onTabChange?: (tab: CardInspectorTab) => void;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: number;
  resultCount?: number;
  onShare?: () => void;
  returnFocusRef?: { current: HTMLElement | null };
  className?: string;
  collectionEnabled?: boolean;
  collection?: Collection;
  onCollectionChange?: (catalogId: string, field: CollectionField, delta: number) => void;
};

export type InspectorProps = SharedInspectorProps & (
  | {
      card: GameCard;
      allCards: readonly GameCard[];
      onSelectCard?: (card: GameCard) => void;
      core?: never;
      allCores?: never;
      onSelectCore?: never;
    }
  | {
      core: Core;
      allCores?: readonly Core[];
      onSelectCore?: (core: Core) => void;
      card?: never;
      allCards?: never;
      onSelectCard?: never;
    }
);

const tabLabels: Record<CardInspectorTab, string> = {
  overview: "Overview",
  references: "References",
  rules: "Rules",
  rulings: "Rulings",
  related: "Related",
  collection: "Collection",
};

function CollectionPanel({
  ids,
  collection,
  onChange,
  selectedId,
}: {
  ids: readonly string[];
  collection: Collection;
  onChange?: (catalogId: string, field: CollectionField, delta: number) => void;
  selectedId?: string;
}) {
  const [activeId, setActiveId] = useState(selectedId ?? ids[0] ?? "");
  const idsKey = ids.join("|");
  const firstId = ids[0] ?? "";
  useEffect(() => setActiveId(selectedId && ids.includes(selectedId) ? selectedId : firstId), [firstId, idsKey, selectedId]);
  const entry = collectionEntry(collection, activeId);
  return (
    <div className={styles.collectionPanel}>
      {ids.length > 1 && (
        <label className={styles.collectionVariant}>
          Printing
          <select value={activeId} onChange={(event) => setActiveId(event.target.value)}>
            {ids.map((id, index) => <option value={id} key={id}>{index === 0 ? "Primary printing" : id}</option>)}
          </select>
        </label>
      )}
      <div className={styles.collectionCounters}>
        {(["standard", "foil", "wishlist"] as const).map((field) => (
          <div key={field} className={styles.collectionCounter}>
            <span>{field[0].toUpperCase() + field.slice(1)}</span>
            <div>
              <button type="button" aria-label={`Decrease ${field} copies`} disabled={!entry[field]} onClick={() => onChange?.(activeId, field, -1)}>−</button>
              <strong><MotionValue value={entry[field]} /></strong>
              <button type="button" aria-label={`Increase ${field} copies`} onClick={() => onChange?.(activeId, field, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>Counts are saved to your account and kept separate for each catalogue printing.</p>
    </div>
  );
}

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

const coreTerms = (core: Core) => [
  "BakuCore",
  core.name,
  core.type,
  core.set ?? "Battle Brawlers",
  core.bakuGearCostReduction ? "Baku-Gear Energy reduction" : "",
  core.frostStrike ? "FrostStrike" : "",
  core.shadowStrike ? "ShadowStrike" : "",
  core.fusionBonus || core.fusionDamageBonus || core.fusionFrostStrike ? "Fusion" : "",
  core.conditionalFactions?.join(" ") ?? "",
].filter(Boolean).map((value) => value.toLowerCase());

function matchingReferencesForTerms(terms: readonly string[], entries: readonly ReferenceEntry[], maximum: number) {
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

function matchingReferences(card: GameCard, entries: readonly ReferenceEntry[], maximum: number) {
  return matchingReferencesForTerms(normalizedTerms(card), entries, maximum);
}

function matchingCoreReferences(core: Core, entries: readonly ReferenceEntry[], maximum: number) {
  return matchingReferencesForTerms(coreTerms(core), entries, maximum);
}

const signedCoreValue = (value: number) => `${value > 0 ? "+" : ""}${value}`;

const coreRules = (core: Core) => [
  core.bakuGearCostReduction ? `Baku-Gear costs ${core.bakuGearCostReduction} less Energy while this Core is held.` : "",
  core.frostStrike ? `Grants +${core.frostStrike} FrostStrike.` : "",
  core.shadowStrike ? "Grants ShadowStrike." : "",
  core.fusionBonus ? `While fused, grants ${signedCoreValue(core.fusionBonus)} B-Power.` : "",
  core.fusionDamageBonus ? `While fused, grants ${signedCoreValue(core.fusionDamageBonus)} Damage.` : "",
  core.fusionFrostStrike ? `While fused, grants +${core.fusionFrostStrike} FrostStrike.` : "",
  core.conditionalFactions?.length && (core.conditionalBonus || core.conditionalDamage)
    ? `${core.conditionalFactions.join(" and ")} BakuGan: ${signedCoreValue(core.conditionalBonus || core.conditionalDamage || 0)} ${core.conditionalBonus ? "B-Power" : "Damage"}.`
    : "",
].filter((value): value is string => Boolean(value));

function CardOverview({ card }: { card: GameCard }) {
  const set = CARD_SET_INFO[cardSetCode(card)];
  const rolling = bakuganRollingValues(card);
  return (
    <div className={styles.overview}>
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
          {rolling && <div><dt>Roll Accuracy</dt><dd><BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} plain /></dd></div>}
          {rolling && <div><dt>Double Core Chance</dt><dd><BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} plain /></dd></div>}
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
  );
}

function CoreOverview({ core, displayedCore }: { core: Core; displayedCore: Core }) {
  const displayedSet = displayedCore.set ?? "Battle Brawlers";
  const rules = coreRules(core);
  return (
    <div className={styles.overview}>
      <div className={styles.identity}>
        <div className={styles.chips}>
          <StatusChip tone="info">{core.type}</StatusChip>
          <StatusChip>{displayedSet}</StatusChip>
        </div>
        {rules.length
          ? <p className={styles.effect}>{rules.join(" ")}</p>
          : <p className={styles.muted}>This BakuCore has no additional rules text.</p>}
        <dl className={styles.metadata}>
          <div><dt>Collector</dt><dd>{displayedSet === "Armored Alliance" ? "AA" : "BB"} #{displayedCore.number}</dd></div>
          {(core.bonus !== 0 || core.fusionBonus) && <div><dt>B-Power</dt><dd>{signedCoreValue(core.bonus)}{core.fusionBonus ? ` / ${signedCoreValue(core.fusionBonus)} fused` : ""}</dd></div>}
          {(core.damageBonus !== 0 || core.fusionDamageBonus) && <div><dt>Damage</dt><dd>{signedCoreValue(core.damageBonus)}{core.fusionDamageBonus ? ` / ${signedCoreValue(core.fusionDamageBonus)} fused` : ""}</dd></div>}
          <div><dt>Catalogue ID</dt><dd>{core.catalogId ?? core.id}</dd></div>
          {displayedCore !== core && <div><dt>Rules profile</dt><dd>BB #{core.number}</dd></div>}
        </dl>
      </div>
    </div>
  );
}

function CoreRelated({
  core,
  activePrintingId,
  onSelectPrinting,
}: {
  core: Core;
  activePrintingId: string;
  onSelectPrinting: (printingId: string) => void;
}) {
  if (!core.printings?.length) {
    return <InspectorEmpty message="No alternate printing or directly connected BakuCore was found." />;
  }
  return (
    <div className={styles.relatedGrid}>
      <button
        type="button"
        className={activePrintingId === "primary" ? styles.relatedActive : ""}
        aria-pressed={activePrintingId === "primary"}
        onClick={() => onSelectPrinting("primary")}
      >
        <span className={styles.relatedCoreArt}><BakuCoreArt core={core} alt="" /></span>
        <span><strong>{core.set ?? "Battle Brawlers"} #{core.number}</strong><small>Rules profile</small></span>
      </button>
      {core.printings.map((printing) => {
        const printingCore = { ...core, set: printing.set, number: printing.number, art: printing.art, hasProvidedScan: true };
        return (
          <button
            type="button"
            className={activePrintingId === printing.id ? styles.relatedActive : ""}
            aria-pressed={activePrintingId === printing.id}
            key={printing.id}
            onClick={() => onSelectPrinting(printing.id)}
          >
            <span className={styles.relatedCoreArt}><BakuCoreArt core={printingCore} alt="" /></span>
            <span><strong>{printing.set} #{printing.number}</strong><small>Alternate artwork</small></span>
          </button>
        );
      })}
    </div>
  );
}

export function CardInspector(props: InspectorProps) {
  const { rules, rulings, tab = "overview", mode = "modal", onTabChange, onClose, onPrevious, onNext, position, resultCount, onShare, returnFocusRef, className, collectionEnabled = false, collection = {}, onCollectionChange } = props;
  const card = "card" in props ? props.card : undefined;
  const core = "core" in props ? props.core : undefined;
  const allCards = "card" in props ? props.allCards : null;
  const onSelectCard = "card" in props ? props.onSelectCard : undefined;
  const baseCard = useMemo(() => {
    if (!card?.fusionPairId || !allCards) return card;
    return allCards.find((candidate) => candidate.fusionPairId === card.fusionPairId && candidate.fusionFace === "a") ?? card;
  }, [allCards, card]);
  const fusedCard = useMemo(() => {
    if (!baseCard?.fusionPairId || !allCards) return null;
    return allCards.find((candidate) => candidate.fusionPairId === baseCard.fusionPairId && candidate.fusionFace === "b") ?? null;
  }, [allCards, baseCard]);
  const [fusionFace, setFusionFace] = useState<"a" | "b">("a");
  const [activePrintingId, setActivePrintingId] = useState("primary");
  const [activeCardPrintingId, setActiveCardPrintingId] = useState(card?.catalogId ?? "");
  const cardPrintings = useMemo(() => {
    if (!baseCard || !allCards) return baseCard ? [baseCard] : [];
    const identity = baseCard.constructionIdentity ?? baseCard.catalogId;
    return allCards.filter((candidate) => candidate.fusionFace !== "b"
      && (candidate.constructionIdentity ?? candidate.catalogId) === identity);
  }, [allCards, baseCard]);
  const itemKey = baseCard?.fusionPairId
    ? "fusion-" + baseCard.fusionPairId
    : baseCard?.catalogId ?? core?.catalogId ?? core?.id ?? "item";
  const selectedPrintingCard = cardPrintings.find((candidate) => candidate.catalogId === activeCardPrintingId) ?? baseCard;
  const displayedCard = fusionFace === "b" && fusedCard ? fusedCard : selectedPrintingCard;
  const hasFusion = Boolean(baseCard?.fusionPairId && fusedCard);
  const label = displayedCard?.displayName ?? core?.name ?? "Inspector";
  const isCore = Boolean(core);
  const visibleTabs: CardInspectorTab[] = ["overview", "collection", "references"];
  const effectiveTab: CardInspectorTab = visibleTabs.includes(tab) ? tab : ["rules", "rulings", "related"].includes(tab) ? "references" : "overview";
  const activeTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = activeTabRef.current;
    const strip = button?.parentElement;
    if (!button || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const bounds = button.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    if (bounds.left < viewport.left) strip.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right) strip.scrollLeft += bounds.right - viewport.right;
  }, [collectionEnabled, effectiveTab, itemKey]);
  const collectionIds = card
    ? cardCollectionIds(baseCard ?? card, allCards ?? [card])
    : core ? coreCollectionIds(core) : [];

  useEffect(() => {
    setFusionFace("a");
    setActivePrintingId("primary");
    setActiveCardPrintingId(baseCard?.catalogId ?? "");
  }, [itemKey]);

  const relevantRules = useMemo(
    () => displayedCard ? matchingReferences(displayedCard, rules, 8) : core ? matchingCoreReferences(core, rules, 8) : [],
    [displayedCard, core, rules],
  );
  const relevantRulings = useMemo(
    () => displayedCard ? matchingReferences(displayedCard, rulings, 8) : core ? matchingCoreReferences(core, rulings, 8) : [],
    [displayedCard, core, rulings],
  );
  const relatedCards = useMemo(() => displayedCard ? relatedCompendiumCards(displayedCard, allCards ?? []) : [], [allCards, displayedCard]);
  const activePrinting = core?.printings?.find((printing) => printing.id === activePrintingId);
  const displayedCore = core && activePrinting
    ? { ...core, set: activePrinting.set, number: activePrinting.number, art: activePrinting.art, hasProvidedScan: true }
    : core;
  const panelId = `${isCore ? "core" : "card"}-inspector-${itemKey}-${effectiveTab}`;
  const inspectorLayoutRef = useRef<HTMLDivElement>(null);
  const rememberOrigin = (destination: string) => {
    if (typeof window === "undefined") return;
    const current = window.location.pathname + window.location.search + window.location.hash;
    window.sessionStorage.setItem("compendium:reference-return", JSON.stringify({url:current,label,section:new URL(destination,window.location.origin).pathname.split("/")[2],scrollY:window.scrollY,inspectorScrollY:inspectorLayoutRef.current?.scrollTop ?? 0,printing:activePrintingId,cardPrinting:activeCardPrintingId,fusionFace}));
  };
  const titleId = `${isCore ? "core" : "card"}-inspector-title-${itemKey}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("compendium:restore-inspector");
      const origin = raw ? JSON.parse(raw) as {url:string;printing:string;cardPrinting:string;fusionFace:"a"|"b";inspectorScrollY:number} : null;
      if (!origin || origin.url !== window.location.pathname + window.location.search + window.location.hash) return;
      setActivePrintingId(origin.printing || "primary");
      setActiveCardPrintingId(origin.cardPrinting || baseCard?.catalogId || "");
      setFusionFace(origin.fusionFace || "a");
      requestAnimationFrame(() => { if (inspectorLayoutRef.current) inspectorLayoutRef.current.scrollTop=origin.inspectorScrollY || 0; });
      sessionStorage.removeItem("compendium:restore-inspector");
    } catch { /* A stale or invalid return context must not prevent the inspector opening. */ }
  }, [itemKey]);


  const inspectorContent = (
    <>
      <header className={styles.header}>
        <div>
          <span>{core ? `${displayedCore?.set ?? "Battle Brawlers"} · #${displayedCore?.number}` : displayedCard ? cardCollectorLabel(displayedCard) : ""}</span>
          <h2 id={titleId}>{label}</h2>
        </div>
        <div className={styles.headerActions}>
          {(onPrevious || onNext) && <div className={styles.resultNavigation} aria-label="Navigate catalogue results">
            <button type="button" disabled={!onPrevious} onClick={onPrevious} aria-label="Previous catalogue item">‹</button>
            {position && resultCount && <span>{position} / {resultCount}</span>}
            <button type="button" disabled={!onNext} onClick={onNext} aria-label="Next catalogue item">›</button>
          </div>}
          {onShare && <button type="button" onClick={onShare} aria-label={`Copy link to ${label}`}>Share</button>}
          {onClose && <button type="button" data-inspector-close onClick={onClose} aria-label={`Close ${isCore ? "BakuCore" : "card"} inspector`}>Close</button>}
        </div>
      </header>
      <div className={styles.inspectorLayout} ref={inspectorLayoutRef}>
        <div className={styles.anchorArtwork} aria-label={isCore ? "BakuCore artwork" : "Card artwork"}>
          {displayedCard && <div className={styles.artFrame}>
            <ResponsiveCardImage card={displayedCard} presentation="inspector" />
            {hasFusion && <button type="button" className={styles.fusionToggle}
              aria-label={fusionFace === "a" ? "Show fused side" : "Show unfused side"}
              onClick={() => setFusionFace((face) => face === "a" ? "b" : "a")}>
              <FusionSymbol alt="" width={32} height={32} />
            </button>}
          </div>}
          {core && displayedCore && <div className={styles.coreArtwork}><BakuCoreArt core={displayedCore} alt={label} /></div>}
          {cardPrintings.length > 1 && <div className={styles.printingNav}>
            <button type="button" onClick={() => setActiveCardPrintingId((id) => {
              const index = Math.max(0, cardPrintings.findIndex((item) => item.catalogId === id));
              return cardPrintings[(index - 1 + cardPrintings.length) % cardPrintings.length].catalogId;
            })} aria-label="Previous printing">‹</button>
            <span>{Math.max(1, cardPrintings.findIndex((item) => item.catalogId === activeCardPrintingId) + 1)} / {cardPrintings.length}</span>
            <button type="button" onClick={() => setActiveCardPrintingId((id) => {
              const index = Math.max(0, cardPrintings.findIndex((item) => item.catalogId === id));
              return cardPrintings[(index + 1) % cardPrintings.length].catalogId;
            })} aria-label="Next printing">›</button>
          </div>}
          {core?.printings?.length ? <div className={styles.printingNav}>
            <button type="button" aria-label="Previous BakuCore printing" onClick={() => {
              const ids = ["primary", ...core.printings!.map((printing) => printing.id)];
              const index = ids.indexOf(activePrintingId);
              setActivePrintingId(ids[(index - 1 + ids.length) % ids.length]);
            }}>‹</button>
            <span>{Math.max(1, ["primary", ...core.printings.map((printing) => printing.id)].indexOf(activePrintingId) + 1)} / {core.printings.length + 1}</span>
            <button type="button" aria-label="Next BakuCore printing" onClick={() => {
              const ids = ["primary", ...core.printings!.map((printing) => printing.id)];
              const index = ids.indexOf(activePrintingId);
              setActivePrintingId(ids[(index + 1) % ids.length]);
            }}>›</button>
          </div> : null}
        </div>
        <div className={styles.inspectorDetails}>
      <Tabs className={styles.tabs} label={`${label} information`}>
        {visibleTabs.map((candidate) => (
          <button
            type="button"
            role="tab"
            ref={effectiveTab === candidate ? activeTabRef : undefined}
            aria-label={tabLabels[candidate]}
            title={tabLabels[candidate]}
            aria-selected={effectiveTab === candidate}
            aria-controls={effectiveTab === candidate ? panelId : undefined}
            className={effectiveTab === candidate ? "active" : ""}
            onClick={() => onTabChange?.(candidate)}
            key={candidate}
          >
            {tabLabels[candidate]}
          </button>
        ))}
      </Tabs>
      <div className={styles.body} id={panelId} role="tabpanel" aria-live="polite">
        <div key={effectiveTab} data-ui="inspector-tab-content">
        {effectiveTab === "overview" && displayedCard && <CardOverview card={displayedCard} />}
        {effectiveTab === "overview" && core && displayedCore && <CoreOverview core={core} displayedCore={displayedCore} />}
        {effectiveTab === "references" && <div className={styles.referenceSections}>
          <h3>Rules</h3>
          <ReferenceList entries={relevantRules} label="Relevant rule" empty="No automatically matched rulebook references." onNavigate={rememberOrigin} section="rules" />
          <h3>Rulings</h3>
          <ReferenceList entries={relevantRulings} label="Published ruling" ruling empty="No published ruling is linked to this item." onNavigate={rememberOrigin} section="rulings" />
          <h3>{isCore ? "Alternate printings" : "Related cards"}</h3>
          {core ? <CoreRelated core={core} activePrintingId={activePrintingId} onSelectPrinting={setActivePrintingId} />
            : relatedCards.length ? <div className={styles.relatedGrid}>{relatedCards.map((candidate) =>
              <button type="button" onClick={() => onSelectCard?.(candidate)} key={candidate.catalogId}>
                <ResponsiveCardImage card={candidate} presentation="thumbnail" alt="" />
                <span><strong>{candidate.displayName}</strong><small>{cardSetCode(candidate)} · {candidate.type}</small></span>
              </button>)}</div> : <InspectorEmpty message="No related cards found." />}
        </div>}
        {effectiveTab === "collection" && (collectionEnabled
          ? <CollectionPanel ids={collectionIds} selectedId={core ? (activePrintingId === "primary" ? core.catalogId ?? core.id : activePrintingId) : activeCardPrintingId} collection={collection} onChange={onCollectionChange} />
          : <InspectorEmpty message="Sign in to manage your collection." />)}
        </div>
      </div>
      </div>
      </div>
    </>
  );

  if (mode === "embedded") {
    return (
      <aside
        data-ui="card-inspector"
        className={[styles.inspector, styles.embedded, className].filter(Boolean).join(" ")}
        aria-label={`${label} inspector`}
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
  onNavigate,
  section,
}: {
  entries: readonly ReferenceEntry[];
  empty: string;
  label: string;
  ruling?: boolean;
  onNavigate?: (destination: string) => void;
  section?: "rules" | "rulings";
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
          {section && <a className={styles.referenceLink} href={section === "rulings"
            ? `/compendium/rulings#ruling-${entry.slug}`
            : `/compendium/rules#section-${entry.sourceSection.match(/\d+(?:\.\d+)+/)?.[0] ?? "1.1"}`}
            onClick={(event) => onNavigate?.(event.currentTarget.href)}>
            Open {section === "rulings" ? "ruling" : "rule"} ↗</a>}
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
