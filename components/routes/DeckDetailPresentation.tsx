"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { isFlipCardType } from "../../lib/content/card-art";
import { BAKUGAN, CARDS, CORES, legalDeckFormats, validateDeck, type DeckFormat, type DeckRecord } from "../../lib/data";
import { deckEnergyCurve, deckExportFilename, groupedDeckCards } from "../../lib/deck-presentation";
import { preferredCardPrinting, preferredCorePrinting, corePrintingKey } from "../../lib/deck-printings";
import { deckSetName } from "../../lib/deck-set";
import { deckTextList, encodeDeckCode } from "../../lib/deck-transfer";
import type { DeckValidationResult } from "../../lib/deck-validation";
import type { Core, GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import { copyText, downloadTextFile } from "../application/ui";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { BakuganRollingStat, bakuganRollingValues } from "../cards/BakuganRollingStats";
import { CardFactionTag } from "./CardFactionTag";
import cardTileStyles from "./CardsGallery.module.css";
import { DeckPreview } from "./DeckGalleryCard";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import { useCompetitiveRules } from "./DeckRouteShared";
import styles from "./DeckDetail.module.css";

const CARD_TYPES = ["Action", "Hero", "Evo", "Baku-Gear", "Flip"] as const;
const TYPE_COLOURS = [
  "var(--bb-progress-accent)",
  "var(--bb-nav-indicator)",
  "var(--bb-activity-rule)",
  "var(--bb-activity-neutral)",
  "var(--bb-deck-stat)",
];
const FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: "Standard", singleton: "Singleton", competitive: "Competitive",
};
type Inspection = { kind: "card"; card: GameCard } | { kind: "core"; core: Core };

function AccessibleDialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const options = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getClientRects().length > 0);
      if (!options.length) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === options[0]) {
        event.preventDefault(); options[options.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === options[options.length - 1]) {
        event.preventDefault(); options[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [onClose]);
  return <div className={styles.modalBackdrop} onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
      <div className={styles.modalHeader}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className={styles.modalContent}>{children}</div>
    </div>
  </div>;
}

function ShareOptions({ deck, publicView, notify }: {
  deck: DeckRecord; publicView: boolean; notify: (message: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const copy = async (value: string, message: string) => {
    try { await copyText(value); notify(message); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not copy to clipboard."); }
  };
  const image = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportDeckImage } = await import("../../lib/deck-image-export");
      await exportDeckImage(deck);
      notify("Deck image exported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Deck image could not be exported.");
    } finally { setExporting(false); }
  };
  return <div className={styles.shareOptions}>
    {publicView && <button type="button" onClick={() => void copy(window.location.href, "Public deck link copied.")}>
      <span aria-hidden="true">↗</span><span>Copy Deck Link<small>Share this public deck&apos;s URL</small></span>
    </button>}
    <button type="button" onClick={() => void copy(encodeDeckCode(deck), "Deck code copied.")}>
      <span aria-hidden="true">⧉</span><span>Copy Deck Code<small>Copy an importable deck code</small></span>
    </button>
    <button type="button" onClick={() => {
      downloadTextFile(deckExportFilename(deck.name, "txt"), deckTextList(deck));
      notify("Text list exported.");
    }}>
      <span aria-hidden="true">≡</span><span>Export Text List<small>Download a .txt deck list</small></span>
    </button>
    <button type="button" disabled={exporting} onClick={() => void image()}>
      <span aria-hidden="true">▧</span><span>{exporting ? "Exporting image…" : "Export Image"}<small>Download an image of the deck</small></span>
    </button>
  </div>;
}

function DeckStatistics({ deck, report, formats, rulesAvailable }: {
  deck: DeckRecord; report: DeckValidationResult; formats: DeckFormat[]; rulesAvailable: boolean;
}) {
  const groups = groupedDeckCards(deck);
  const counts = CARD_TYPES.map(type => groups.reduce((sum, item) => (
    sum + ((type === "Flip" ? isFlipCardType(item.card.type) : item.card.type === type) ? item.count : 0)
  ), 0));
  const curve = deckEnergyCurve(deck);
  const numeric = curve.filter(bucket => typeof bucket.cost === "number");
  const totalNumeric = numeric.reduce((sum, bucket) => sum + bucket.count, 0);
  const mean = totalNumeric
    ? (numeric.reduce((sum, bucket) => sum + Number(bucket.cost) * bucket.count, 0) / totalNumeric).toFixed(1)
    : "—";
  const peakCount = Math.max(0, ...curve.map(bucket => bucket.count));
  const mode = peakCount ? curve.find(bucket => bucket.count === peakCount)?.label ?? "—" : "—";
  const maxCount = Math.max(1, peakCount);
  const total = deck.cardIds.length;
  const unknownCompetitive = !rulesAvailable && deck.format === "competitive";
  const selectedFormatLegal = !unknownCompetitive && report.isLegal;

  return <div className={styles.statsPanel} data-ui="view-deck-statistics">
    <h2>Deck Statistics</h2>
    <div className={styles.rule} />
    <section className={styles.statGroup} aria-label="Card composition">
      <div className={styles.statHeading}><h3>Card Composition</h3><span className={styles.statNote}>Main Deck</span></div>
      <div className={styles.compositionBar} role="img" aria-label={CARD_TYPES.map((type, i) => type + ": " + counts[i]).join(", ")}>
        {counts.map((count, index) => count > 0 ? <div key={CARD_TYPES[index]}
          className={styles.compositionSegment} style={{ flexGrow: count, background: TYPE_COLOURS[index] }} /> : null)}
      </div>
      <div className={styles.legend}>
        {CARD_TYPES.map((type, index) => <div key={type} className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: TYPE_COLOURS[index] }} aria-hidden="true" />
          <span>{type}</span><strong>{counts[index]}</strong>
        </div>)}
      </div>
    </section>
    <div className={styles.rule} />
    <section className={styles.statGroup} aria-label="Energy curve">
      <div className={styles.statHeading}><h3>Energy Curve</h3></div>
      <div className={styles.energySummary}>
        <div className={styles.energyMetric}><span>Average cost</span><strong>{mean}</strong></div>
        <div className={styles.energyMetric}><span>Most common cost</span><strong>{mode}</strong></div>
      </div>
      <div className={styles.energyPlot} role="img" aria-label={curve.map(bucket =>
        String(bucket.count) + " cards at " + bucket.label + " energy"
      ).join(", ") || "No cards"}>
        {curve.map(bucket => <div key={bucket.label} className={styles.energyColumn}
          data-peak={peakCount > 0 && bucket.count === peakCount ? "true" : undefined}>
          <strong>{bucket.count}</strong>
          <div className={styles.energyTrack} aria-hidden="true">
            <div className={styles.energyFill} style={{ height: String(Math.max(bucket.count ? 5 : 2, bucket.count / maxCount * 100)) + "%" }} />
          </div>
          <span>{bucket.label}</span>
        </div>)}
      </div>
      <div className={styles.statNote} style={{ textAlign: "center" }}>Energy cost · X excluded from numeric average</div>
    </section>
    <div className={styles.rule} />
    <section className={styles.statGroup} aria-label="Deck legality">
      <div className={styles.statHeading}><h3>Deck Legality</h3></div>
      <div className={styles.legality}>
        <div className={styles.legalityHead}>
          <span className={selectedFormatLegal ? styles.legalGood : styles.legalBad} aria-hidden="true">
            {selectedFormatLegal ? "✓" : "!"}
          </span>
          <span>{unknownCompetitive ? "Competitive rules unavailable" : report.isLegal ? "Legal in selected format" : "Needs attention"}</span>
        </div>
        <p>{formats.length ? "Legal formats: " + formats.map(format => FORMAT_LABELS[format]).join(", ") : "No confirmed legal formats."}</p>
        {!rulesAvailable && <p>Competitive legality cannot be confirmed until the current rules load.</p>}
        {!unknownCompetitive && !report.isLegal && <ul className={styles.issues}>
          {report.issues.map((item, index) => <li key={item.code + "-" + index}>{item.message}</li>)}
        </ul>}
        {!unknownCompetitive && report.isLegal && <p>Construction requirements pass for {FORMAT_LABELS[deck.format ?? "standard"]}.</p>}
      </div>
      {total === 0 && <p className={styles.empty}>Add Main Deck cards to see a meaningful analysis.</p>}
    </section>
  </div>;
}

/** Match BakuCores to the two type indicators on each Character, preserving duplicates. */
function pairedCoreSlots(deck: DeckRecord) {
  const available = deck.coreIds.map(id => CORES.find(core => core.id === id));
  const consumed = new Set<number>();
  const characters = Array.from({ length: 3 }, (_, index) => BAKUGAN.find(item => item.id === deck.bakuganIds[index]));
  return characters.map(character => Array.from({ length: 2 }, (_, index) => {
    const expected = character?.character.coreTypes?.[index];
    let position = available.findIndex((core, i) => !consumed.has(i) && core?.type === expected);
    if (position === -1) position = available.findIndex((core, i) => !consumed.has(i) && Boolean(core));
    if (position !== -1) consumed.add(position);
    return position === -1 ? undefined : available[position];
  }));
}

export function DeckDetailPresentation({ deck, publicView = false, notify, primaryAction, secondaryAction,
  menuActions, creatorIdentity }: {
  deck: DeckRecord;
  publicView?: boolean;
  notify: (message: string) => void;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
  menuActions?: ReactNode;
  creatorIdentity?: { userId?: string; displayName: string };
}) {
  const competitive = useCompetitiveRules();
  const rulesAvailable = !competitive.loading && !competitive.error;
  const restrictions = rulesAvailable ? competitive.restrictions : [];
  const competitiveSize = rulesAvailable ? competitive.deckSize : 50;
  const report = validateDeck(deck, restrictions, competitiveSize);
  const legalFormats = legalDeckFormats(deck, restrictions, competitiveSize)
    .filter(format => rulesAvailable || format !== "competitive");
  const validSelected = rulesAvailable || deck.format !== "competitive" ? report.isLegal : null;
  const cards = groupedDeckCards(deck);
  const slots = pairedCoreSlots(deck);
  const requiredCount = deck.format === "competitive" ? (rulesAvailable ? String(competitiveSize) : "—") : "40";
  const [showStats, setShowStats] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectorTab, setInspectorTab] = useState<CardInspectorTab>("overview");
  const [inspectorPrinting, setInspectorPrinting] = useState("");
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const inspectCard = (card: GameCard, trigger: HTMLElement) => {
    inspectorTrigger.current = trigger;
    setInspectorTab("overview");
    setInspectorPrinting("");
    setInspection({ kind: "card", card });
  };
  const inspectCore = (core: Core, trigger: HTMLElement) => {
    inspectorTrigger.current = trigger;
    setInspectorTab("overview");
    setInspectorPrinting(deck.printingPreferences?.[corePrintingKey(core)] ?? core.catalogId ?? core.id);
    setInspection({ kind: "core", core });
  };
  const createdAt = (deck as DeckRecord & { createdAt?: string }).createdAt;
  const dateValue = createdAt ?? deck.publishedAt ?? deck.updatedAt;
  const dateLabel = createdAt ? "Created" : deck.publishedAt ? "Published" : "Updated";
  const date = Number.isFinite(Date.parse(dateValue))
    ? new Date(dateValue).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Unknown";
  const closeStats = () => setShowStats(false);
  const closeShare = () => setShowShare(false);
  return <div className={styles.route}>
    <div className={styles.shell}>
      <Link className={styles.back} href={publicView ? "/decks/public" : "/decks"}>← {publicView ? "Public Decks" : "My Decks"}</Link>
      <header className={styles.details}>
        <div className={styles.identity}>
          <div className={styles.preview}><DeckPreview deck={deck} /></div>
          <div className={styles.identityCopy}>
            <h1>{deck.name}</h1>
            <div className={styles.creator}>Created by <DeckCreatorIdentity
              userId={creatorIdentity?.userId ?? (deck as DeckRecord & { creatorUserId?: string }).creatorUserId}
              displayName={creatorIdentity?.displayName ?? deck.creator ?? "Community Brawler"} /></div>
            <div className={styles.factions} aria-label={"Factions: " + deck.factions.join(", ")}>
              {Array.from(new Set(deck.factions)).map(faction => FACTION_SYMBOLS[faction]
                ? <OriginalImage key={faction} src={FACTION_SYMBOLS[faction]} alt={faction} title={faction} /> : null)}
            </div>
            <div className={styles.tags} aria-label="Set, legal formats and visibility">
              <span className={styles.setTag}>{deckSetName(deck)}</span>
              {legalFormats.map(format => <span key={format} className={styles.tag}>{FORMAT_LABELS[format]}</span>)}
              {!legalFormats.length && <span className={styles.tag}>No confirmed legal formats</span>}
              {!publicView && <span className={styles.tag}>{deck.visibility}</span>}
            </div>
            <div className={styles.summary}>
              <span className={validSelected ? styles.status : styles.statusBad}>
                {validSelected === null ? "Checking Competitive legality" : validSelected ? "✓ Legal" : "Needs attention"}
              </span>
              <time dateTime={dateValue} title={dateLabel + " " + date}>{dateLabel} {date}</time>
            </div>
          </div>
        </div>
        {deck.description && <p className={styles.description}>{deck.description}</p>}
        <div className={styles.actions}>
          {primaryAction}
          {secondaryAction}
          <button type="button" className="bb-button" onClick={() => setShowShare(true)}>Share / Export</button>
          {menuActions && <details className={styles.actionMore}>
            <summary aria-label="More deck actions">⋯</summary>
            <div className={styles.actionMenu}>{menuActions}</div>
          </details>}
        </div>
      </header>
      <button type="button" className={"bb-button " + styles.mobileStats} onClick={() => setShowStats(true)}>
        View Statistics
      </button>
      <div className={styles.layout}>
        <div className={styles.contentMain}>
          <section className={styles.section} aria-labelledby="view-deck-team">
            <div className={styles.sectionHead}><h2 id="view-deck-team">The Team</h2>
              <span>{deck.bakuganIds.length}/3 Characters · {deck.coreIds.length}/6 BakuCores</span>
            </div>
            <div className={styles.teamGrid}>
              {Array.from({ length: 3 }, (_, index) => {
                const character = BAKUGAN.find(item => item.id === deck.bakuganIds[index]);
                const displayed = character && preferredCardPrinting(character.character, deck.printingPreferences);
                const rolling = character && bakuganRollingValues(character.character);
                const factions = displayed
                  ? Array.from(new Set(displayed.factions.length ? displayed.factions : [displayed.faction]))
                  : [];
                return <div className={styles.teamGroup} key={character?.id ?? "empty-" + index}>
                  <div className={styles.characterColumn}>
                    {character && displayed ? <>
                      <button type="button" className={cardTileStyles.tile}
                        aria-label={"Inspect " + character.name} onClick={event => inspectCard(displayed, event.currentTarget)}>
                        <span className={cardTileStyles.artwork}><ResponsiveCardImage card={displayed} presentation="tile" alt={character.name} /></span>
                      </button>
                      <div className={styles.characterTags}>
                        {factions.map(faction => <CardFactionTag key={faction} faction={faction} />)}
                        {rolling && <>
                          <span className={styles.rolling}><BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} plain /></span>
                          <span className={styles.rolling}><BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} plain /></span>
                        </>}
                      </div>
                    </> : <div className={styles.emptyArt}>Empty Character</div>}
                  </div>
                  <div className={styles.corePair}>
                    {slots[index].map((core, slot) => core ? <button type="button"
                      key={String(index) + "-" + String(slot)} className={styles.coreButton}
                      aria-label={"Inspect " + core.name} onClick={event => inspectCore(core, event.currentTarget)}>
                      <BakuCoreArt core={preferredCorePrinting(core, deck.printingPreferences)} alt={core.name} />
                    </button> : <div key={String(index) + "-" + String(slot)} className={styles.emptyCore}>Empty Core</div>)}
                  </div>
                </div>;
              })}
            </div>
          </section>
          <section className={styles.section} aria-labelledby="view-main-deck">
            <div className={styles.sectionHead}><h2 id="view-main-deck">Main Deck</h2>
              <span>{deck.cardIds.length} / {requiredCount} Cards</span>
            </div>
            <div className={styles.groups}>
              {CARD_TYPES.map(type => {
                const entries = cards.filter(entry => type === "Flip"
                  ? isFlipCardType(entry.card.type) : entry.card.type === type);
                const count = entries.reduce((sum, entry) => sum + entry.count, 0);
                if (!entries.length) return null;
                return <section key={type}>
                  <div className={styles.subHead}><h3>{type} Cards</h3><span>{count}</span></div>
                  <div className={styles.gallery}>
                    {entries.map(({ card, count: quantity }) => <div className={styles.galleryItem} key={card.catalogId}>
                      <button type="button" className={cardTileStyles.tile}
                        aria-label={"Inspect " + card.displayName + ", " + String(quantity) + " copies"}
                        onClick={event => inspectCard(card, event.currentTarget)}>
                        <span className={cardTileStyles.artwork}><ResponsiveCardImage card={card} presentation="tile" alt={card.displayName} /></span>
                      </button>
                      <div className={styles.quantity} aria-label={String(quantity) + " copies"}>×{quantity}</div>
                    </div>)}
                  </div>
                </section>;
              })}
              {!cards.length && <p className={styles.empty}>No Main Deck cards have been selected.</p>}
            </div>
          </section>
        </div>
        <aside className={styles.statsSidebar} aria-label="Deck statistics">
          <DeckStatistics deck={deck} report={report} formats={legalFormats} rulesAvailable={rulesAvailable} />
        </aside>
      </div>
    </div>
    {showStats && <AccessibleDialog title="Deck Statistics" onClose={closeStats}>
      <DeckStatistics deck={deck} report={report} formats={legalFormats} rulesAvailable={rulesAvailable} />
    </AccessibleDialog>}
    {showShare && <AccessibleDialog title="Share & Export" onClose={closeShare}>
      <ShareOptions deck={deck} publicView={publicView} notify={notify} />
    </AccessibleDialog>}
    {inspection && <div className={styles.inspectorOverlay}>
      {inspection.kind === "card"
        ? <CardInspector mode="embedded" card={inspection.card} allCards={CARDS}
          tab={inspectorTab} printingId={inspectorPrinting} onPrintingChange={setInspectorPrinting}
          onSelectCard={card => setInspection({ kind: "card", card })} onTabChange={setInspectorTab}
          onClose={() => { setInspection(null); inspectorTrigger.current?.focus(); }}
          onShare={() => void copyText((globalThis.location?.origin ?? "") + "/compendium?card=" +
            encodeURIComponent(inspection.card.catalogId) + (inspectorPrinting ? "&printing=" + encodeURIComponent(inspectorPrinting) : ""))
            .then(() => notify("Card link copied."))} />
        : <CardInspector mode="embedded" core={inspection.core} allCores={CORES}
          tab={inspectorTab} printingId={inspectorPrinting} onPrintingChange={setInspectorPrinting}
          onTabChange={setInspectorTab} onClose={() => { setInspection(null); inspectorTrigger.current?.focus(); }} />}
    </div>}
  </div>;
}

export function MissingDeck({ id, publicDeck = false }: { id: string; publicDeck?: boolean }) {
  return <div className={styles.route}><div className={styles.shell}>
    <h1>Deck not found</h1>
    <p>No {publicDeck ? "public" : "device-local"} deck matches “{id}”.</p>
    <Link className="bb-button" href={publicDeck ? "/decks/public" : "/decks"}>
      Return to {publicDeck ? "Public Decks" : "My Decks"}
    </Link>
  </div></div>;
}
