"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";

import { useEffect, useMemo, useState } from "react";
import { cardCollectorLabel, cardSetCode, CARD_SET_INFO } from "../../lib/content/catalogue";
import {
  CARD_INSPECTOR_TABS,
  relatedCompendiumCards,
  type CardInspectorTab,
} from "../../lib/compendium";
import type { Core, GameCard } from "../../lib/game";
import { SYMBOL_ENTRIES, type ReferenceEntry } from "../../lib/reference";
import { StatusChip, Tabs } from "../design-system/primitives";
import { InspectorModal } from "./InspectorModal";
import { ResponsiveCardImage } from "./ResponsiveCardImage";
import styles from "./CardInspector.module.css";

type SharedInspectorProps = {
  rules: readonly ReferenceEntry[];
  rulings: readonly ReferenceEntry[];
  tab?: CardInspectorTab;
  mode?: "modal" | "embedded";
  onTabChange?: (tab: CardInspectorTab) => void;
  onClose?: () => void;
  onShare?: () => void;
  returnFocusRef?: { current: HTMLElement | null };
  className?: string;
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

function CardOverview({
  card,
  hasFusion,
  fusionFace,
  onToggleFusion,
}: {
  card: GameCard;
  hasFusion: boolean;
  fusionFace: "a" | "b";
  onToggleFusion: () => void;
}) {
  const set = CARD_SET_INFO[cardSetCode(card)];
  return (
    <div className={styles.overview}>
      <div className={styles.artWell}>
        <div className={styles.artFrame}>
          <ResponsiveCardImage card={card} presentation="inspector" />
          {hasFusion && (
            <button
              type="button"
              className={styles.fusionToggle}
              aria-label={fusionFace === "a" ? "Show fused side" : "Show unfused side"}
              aria-pressed={fusionFace === "b"}
              onClick={onToggleFusion}
            >
              <OriginalImage src="/assets/symbols/fusion.png" alt="" width="32" height="32" />
            </button>
          )}
        </div>
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
  );
}

function CoreOverview({ core, displayedCore }: { core: Core; displayedCore: Core }) {
  const displayedSet = displayedCore.set ?? "Battle Brawlers";
  const rules = coreRules(core);
  return (
    <div className={styles.overview}>
      <div className={styles.artWell}>
        <BakuCoreArt core={displayedCore} alt={`${core.name} front`} />
      </div>
      <div className={styles.identity}>
        <div className={styles.chips}>
          <StatusChip tone="info">{core.type}</StatusChip>
          <StatusChip>{displayedSet}</StatusChip>
          {core.printings?.length ? <StatusChip tone="gold">Alternate printing</StatusChip> : null}
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
  const { rules, rulings, tab = "overview", mode = "modal", onTabChange, onClose, onShare, returnFocusRef, className } = props;
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
  const itemKey = baseCard?.fusionPairId
    ? "fusion-" + baseCard.fusionPairId
    : baseCard?.catalogId ?? core?.catalogId ?? core?.id ?? "item";
  const displayedCard = fusionFace === "b" && fusedCard ? fusedCard : baseCard;
  const hasFusion = Boolean(baseCard?.fusionPairId && fusedCard);
  const label = displayedCard?.displayName ?? core?.name ?? "Inspector";
  const isCore = Boolean(core);

  useEffect(() => {
    setFusionFace("a");
    setActivePrintingId("primary");
  }, [itemKey]);

  const relevantRules = useMemo(
    () => displayedCard ? matchingReferences(displayedCard, rules, 8) : core ? matchingCoreReferences(core, rules, 8) : [],
    [displayedCard, core, rules],
  );
  const relevantRulings = useMemo(
    () => displayedCard ? matchingReferences(displayedCard, rulings, 8) : core ? matchingCoreReferences(core, rulings, 8) : [],
    [displayedCard, core, rulings],
  );
  const relatedCards = useMemo(() => displayedCard ? relatedCompendiumCards(displayedCard, allCards) : [], [allCards, displayedCard]);
  const activePrinting = core?.printings?.find((printing) => printing.id === activePrintingId);
  const displayedCore = core && activePrinting
    ? { ...core, set: activePrinting.set, number: activePrinting.number, art: activePrinting.art, hasProvidedScan: true }
    : core;
  const panelId = `${isCore ? "core" : "card"}-inspector-${itemKey}-${tab}`;
  const titleId = `${isCore ? "core" : "card"}-inspector-title-${itemKey}`;

  const inspectorContent = (
    <>
      <header className={styles.header}>
        <div>
          <span>{core ? `${displayedCore?.set ?? "Battle Brawlers"} · #${displayedCore?.number}` : displayedCard ? cardCollectorLabel(displayedCard) : ""}</span>
          <h2 id={titleId}>{label}</h2>
        </div>
        <div className={styles.headerActions}>
          {onShare && <button type="button" onClick={onShare} aria-label={`Copy link to ${label}`}>Share</button>}
          {onClose && <button type="button" data-inspector-close onClick={onClose} aria-label={`Close ${isCore ? "BakuCore" : "card"} inspector`}>Close</button>}
        </div>
      </header>
      <Tabs className={styles.tabs} label={`${label} information`}>
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
        {tab === "overview" && displayedCard && <CardOverview card={displayedCard} hasFusion={hasFusion} fusionFace={fusionFace} onToggleFusion={() => setFusionFace((face) => face === "a" ? "b" : "a")} />}
        {tab === "overview" && core && displayedCore && <CoreOverview core={core} displayedCore={displayedCore} />}
        {tab === "rules" && (
          <ReferenceList
            entries={relevantRules}
            empty={isCore
              ? "No specific rulebook entry was automatically matched. The BakuCore rules shown in Overview still apply normally."
              : "No specific rulebook entry was automatically matched. The printed card text still applies normally."}
            label="Relevant rule"
          />
        )}
        {tab === "rulings" && (
          <ReferenceList
            entries={relevantRulings}
            empty={isCore ? "No published ruling is currently linked to this BakuCore." : "No published ruling is currently linked to this card."}
            label="Published ruling"
            ruling
          />
        )}
        {tab === "related" && displayedCard && (
          relatedCards.length ? (
            <div className={styles.relatedGrid}>
              {relatedCards.map((candidate) => (
                <button type="button" onClick={() => onSelectCard?.(candidate)} key={candidate.catalogId}>
                  <ResponsiveCardImage card={candidate} presentation="thumbnail" alt="" />
                  <span><strong>{candidate.displayName}</strong><small>{cardSetCode(candidate)} · {candidate.type}</small></span>
                </button>
              ))}
            </div>
          ) : <InspectorEmpty message="No evolution, alternate printing, or directly connected card was found." />
        )}
        {tab === "related" && core && (
          <CoreRelated core={core} activePrintingId={activePrintingId} onSelectPrinting={setActivePrintingId} />
        )}
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
