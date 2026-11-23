"use client";

import { OriginalImage } from "../media/OriginalImage";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { cardArtSource, isFlipCardType } from "../../lib/content/card-art";
import { BAKUGAN, CARDS, CORES, legalDeckFormats, validateDeck, type DeckRecord } from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import type { GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import { deckTextList, encodeDeckCode } from "../../lib/deck-transfer";
import { deckEnergyCurve, deckExportFilename, groupedDeckCards } from "../../lib/deck-presentation";
import { preferredCardPrinting, preferredCorePrinting } from "../../lib/deck-printings";
import { deckSetName } from "../../lib/deck-set";
import { CardArt } from "../cards/CardArt";
import { BakuganRollingOverlay } from "../cards/BakuganRollingStats";
import { CardInspector } from "../cards/CardInspector";
import { copyText, downloadTextFile } from "../application/ui";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import { DeckPreview } from "./DeckGalleryCard";
import { DeckState, useCompetitiveRules } from "./DeckRouteShared";
import styles from "./DeckDetail.module.css";

const formatLabels = { standard: "Standard", singleton: "Singleton", competitive: "Competitive" } as const;
const cardTypes = ["Action", "Hero", "Evo", "Baku-Gear", "Flip"] as const;
type CardTypeLabel = typeof cardTypes[number];

function typeLabel(card: GameCard): CardTypeLabel {
  return isFlipCardType(card.type) ? "Flip" : card.type as CardTypeLabel;
}

function deckDate(deck: DeckRecord) {
  const created = (deck as DeckRecord & { createdAt?: string }).createdAt;
  const value = created ?? deck.publishedAt ?? deck.updatedAt;
  const label = created ? "Created" : deck.publishedAt ? "Published" : "Updated";
  const valid = Number.isFinite(Date.parse(value));
  return { value: valid ? value : undefined, label, display: valid
    ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Unknown" };
}

type DetailProps = {
  deck: DeckRecord;
  publicView?: boolean;
  notify: (message: string) => void;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
  managementActions?: ReactNode;
  creatorIdentity?: { userId?: string; displayName: string };
};

export function DeckDetailPresentation({
  deck, publicView = false, notify, primaryAction, secondaryAction, managementActions, creatorIdentity,
}: DetailProps) {
  const rules = useCompetitiveRules();
  const rulesAvailable = !rules.loading && !rules.error;
  const report = rulesAvailable
    ? validateDeck(deck, rules.restrictions, rules.deckSize)
    : validateDeck(deck);
  const legalFormats = rulesAvailable
    ? legalDeckFormats(deck, rules.restrictions, rules.deckSize)
    : null;
  const team = deck.bakuganIds.map((id) => BAKUGAN.find((candidate) => candidate.id === id));
  const grouped = groupedDeckCards(deck);
  const sections = cardTypes.map((type) => ({
    type,
    cards: grouped.filter(({ card }) => typeLabel(card) === type),
  })).filter(({ cards }) => cards.length > 0);
  const typeCounts = cardTypes.map((type) => ({
    type,
    count: sections.find((section) => section.type === type)?.cards.reduce((sum, item) => sum + item.count, 0) ?? 0,
  }));
  const [inspection, setInspection] = useState<GameCard | null>(null);
  const [inspectorTab, setInspectorTab] = useState<CardInspectorTab>("overview");
  const [inspectorPrinting, setInspectorPrinting] = useState("");
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const statsTrigger = useRef<HTMLButtonElement | null>(null);
  const statsClose = useRef<HTMLButtonElement | null>(null);
  const statsDialog = useRef<HTMLDivElement | null>(null);
  const [exportingImage, setExportingImage] = useState(false);
  const shareDetails = useRef<HTMLDetailsElement | null>(null);
  const date = deckDate(deck);

  useEffect(() => {
    if (!statsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    statsClose.current?.focus();
    const dialog = statsDialog.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setStatsOpen(false);
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const media = window.matchMedia("(min-width: 901px)");
    const onResize = () => { if (media.matches) setStatsOpen(false); };
    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onResize);
    onResize();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onResize);
      statsTrigger.current?.focus();
    };
  }, [statsOpen]);

  const inspectCard = (card: GameCard, trigger?: HTMLElement | null) => {
    if (trigger) inspectorTrigger.current = trigger;
    setInspectorTab("overview");
    setInspectorPrinting("");
    setInspection(card);
  };
  const informCopy = async (value: string, success: string) => {
    try {
      await copyText(value);
      shareDetails.current?.removeAttribute("open");
      notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not copy the requested value.");
    }
  };
  const exportImage = async () => {
    if (exportingImage) return;
    setExportingImage(true);
    try {
      const { exportDeckImage } = await import("../../lib/deck-image-export");
      await exportDeckImage(deck);
      shareDetails.current?.removeAttribute("open");
      notify("Deck image exported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The deck image could not be exported.");
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <div className={styles.route}>
      <div className={styles.shell}>
        <Link className={styles.back} href={publicView ? "/decks/public" : "/decks"}>
          <span aria-hidden="true">←</span> Back to {publicView ? "Public Decks" : "My Decks"}
        </Link>
        <header className={styles.deckHeader}>
          <div className={styles.deckIdentity}>
            <div className={styles.preview} aria-label="Deck artwork preview"><DeckPreview deck={deck} /></div>
            <div className={styles.identityCopy}>
              <p className={styles.eyebrow}>{publicView ? "PUBLIC DECK" : "MY DECK"}</p>
              <h1>{deck.name}</h1>
              {creatorIdentity && (
                <p className={styles.creator}>Created by <DeckCreatorIdentity userId={creatorIdentity.userId} displayName={creatorIdentity.displayName} /></p>
              )}
              {publicView && !creatorIdentity && (
                <p className={styles.creator}>Created by <DeckCreatorIdentity
                  userId={(deck as DeckRecord & { creatorUserId?: string }).creatorUserId}
                  displayName={deck.creator ?? "Community Brawler"} /></p>
              )}
              <div className={styles.factions} aria-label={"Factions: " + deck.factions.join(", ")}>
                {Array.from(new Set(deck.factions)).map((faction) => FACTION_SYMBOLS[faction] ? (
                  <span key={faction}><OriginalImage src={FACTION_SYMBOLS[faction]} alt="" aria-hidden="true" />{faction}</span>
                ) : null)}
              </div>
              <div className={styles.metadata} aria-label="Deck details">
                <span className={styles.setTag}>{deckSetName(deck)}</span>
                {legalFormats ? (
                  legalFormats.length ? legalFormats.map((format) => (
                    <span key={format}>{formatLabels[format]}</span>
                  )) : <span className={styles.invalidTag}>No legal formats</span>
                ) : <span>{rules.loading ? "Checking formats…" : "Format rules unavailable"}</span>}
                {!publicView && <span>{deck.visibility}</span>}
                <span className={report.isLegal ? styles.legalTag : styles.invalidTag}>
                  {report.isLegal && (rulesAvailable || deck.format !== "competitive") ? "Legal" : rules.loading && deck.format === "competitive" ? "Checking legality…" : rules.error && deck.format === "competitive" ? "Legality unavailable" : "Needs attention"}
                </span>
              </div>
              <p className={styles.date}>{date.label} {date.value ? <time dateTime={date.value}>{date.display}</time> : date.display}</p>
            </div>
          </div>
          {deck.description?.trim() && <p className={styles.description}>{deck.description}</p>}
          <div className={styles.actions}>
            <div className={styles.primarySlot}>{primaryAction}</div>
            {secondaryAction}
            <details className={styles.share} ref={shareDetails}>
              <summary className={styles.actionButton}>Share / Export</summary>
              <div className={styles.actionMenu}>
                <button type="button" onClick={() => void informCopy(window.location.href, "Deck link copied.")}>Copy link</button>
                <button type="button" onClick={() => void informCopy(encodeDeckCode(deck), "Deck code copied.")}>Copy deck code</button>
                <button type="button" onClick={() => {
                  downloadTextFile(deckExportFilename(deck.name, "txt"), deckTextList(deck));
                  shareDetails.current?.removeAttribute("open");
                  notify("Text list exported.");
                }}>Export text list</button>
                <button type="button" disabled={exportingImage} onClick={() => void exportImage()}>
                  {exportingImage ? "Creating image…" : "Export deck image"}
                </button>
              </div>
            </details>
            {managementActions && (
              <details className={styles.share}>
                <summary className={styles.actionButton}>More actions</summary>
                <div className={styles.actionMenu}>{managementActions}</div>
              </details>
            )}
            <button type="button" className={styles.mobileStatsButton} ref={statsTrigger} onClick={() => setStatsOpen(true)}>
              <span aria-hidden="true">▥</span> Statistics
            </button>
          </div>
        </header>

        <div className={styles.contentLayout}>
          <main className={styles.content}>
            <section className={styles.section} aria-labelledby="deck-team-title">
              <div className={styles.sectionHeading}><h2 id="deck-team-title">The Team</h2><span>{deck.bakuganIds.length} / 3 Characters · {deck.coreIds.length} / 6 BakuCores</span></div>
              <div className={styles.teamGrid}>
                {Array.from({ length: Math.max(3, team.length) }, (_, index) => {
                  const character = team[index];
                  const card = character ? preferredCardPrinting(character.character, deck.printingPreferences) : null;
                  return (
                    <article className={styles.member} key={character?.id ?? "empty-" + index}>
                      {card ? (
                        <button type="button" className={styles.characterCard} onClick={(event) => inspectCard(card, event.currentTarget)}
                          aria-label={"Inspect " + character!.name + " Character card"}>
                          <span className={styles.characterArtwork}>
                            <CardArt src={cardArtSource(card, "full")} cardType={card.type} presentation="readable" alt={character!.name} />
                            <BakuganRollingOverlay card={character!.character} />
                          </span>
                        </button>
                      ) : <div className={styles.emptyCharacter}>Empty Character slot</div>}
                      <div className={styles.memberInfo}>
                        <strong>{character?.name ?? "Unassigned Character"}</strong>
                        {character && <span>{character.faction} · {character.bPower} B-Power · {character.damage} Damage</span>}
                      </div>
                      <div className={styles.pairedCores} aria-label={"BakuCores for team slot " + (index + 1)}>
                        {[0, 1].map((offset) => {
                          const coreId = deck.coreIds[index * 2 + offset];
                          const original = CORES.find((candidate) => candidate.id === coreId);
                          const core = original ? preferredCorePrinting(original, deck.printingPreferences) : null;
                          return <div className={styles.core} key={index + "-" + offset}>
                            {core ? <OriginalImage src={core.art} alt={core.name} /> : <span className={styles.emptyCore} aria-hidden="true">◇</span>}
                            <span>{core?.type ?? "Empty BakuCore"}</span>
                            {core && <small title={core.name}>{core.name}</small>}
                          </div>;
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
              {deck.coreIds.length > 6 && <p className={styles.overflowNote}>This deck has {deck.coreIds.length - 6} extra BakuCores. See Statistics for legality issues.</p>}
            </section>

            <section className={styles.section} aria-labelledby="main-deck-title">
              <div className={styles.sectionHeading}><h2 id="main-deck-title">Main Deck</h2><span>{deck.cardIds.length} cards</span></div>
              {sections.length ? sections.map(({ type, cards }) => (
                <section className={styles.cardGroup} key={type} aria-label={type + " Cards"}>
                  <div className={styles.groupHeading}>
                    <h3>{type} Cards</h3>
                    <span>{cards.reduce((sum, { count }) => sum + count, 0)} cards</span>
                  </div>
                  <div className={styles.cardGrid}>
                    {cards.map(({ card, count }) => (
                      <article className={styles.cardTile} key={card.catalogId}>
                        <button type="button" className={styles.cardButton} onClick={(event) => inspectCard(card, event.currentTarget)}
                          aria-label={"Inspect " + card.displayName + ", " + count + (count === 1 ? " copy" : " copies")}>
                          <span className={styles.cardArtwork}>
                            <CardArt src={cardArtSource(card, "full")} cardType={card.type} presentation="readable" alt={card.displayName} />
                            <span className={styles.copyCount}>×{count}</span>
                          </span>
                          <strong>{card.displayName}</strong>
                          <span className={styles.cardMeta}>{card.faction} · {card.cost} Energy</span>
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )) : <p className={styles.emptyDeck}>No Main Deck cards have been added yet.</p>}
            </section>
          </main>

          <aside className={styles.statsAside} aria-label="Deck statistics">
            <DeckStatistics deck={deck} report={report} typeCounts={typeCounts} rulesLoading={rules.loading} rulesError={rules.error} />
          </aside>
        </div>
      </div>
      {statsOpen && <div className={styles.statsOverlay}>
        <div className={styles.statsDialog} ref={statsDialog} role="dialog" aria-modal="true" aria-labelledby="mobile-stats-title">
          <div className={styles.statsDialogHeading}>
            <h2 id="mobile-stats-title">Deck Statistics</h2>
            <button ref={statsClose} type="button" onClick={() => setStatsOpen(false)} aria-label="Close statistics">×</button>
          </div>
          <div className={styles.statsDialogBody}>
            <DeckStatistics deck={deck} report={report} typeCounts={typeCounts} rulesLoading={rules.loading} rulesError={rules.error} hideTitle />
          </div>
        </div>
      </div>}
      {inspection && <CardInspector
        card={inspection} allCards={CARDS} tab={inspectorTab} printingId={inspectorPrinting}
        onPrintingChange={setInspectorPrinting} onSelectCard={inspectCard}
        onTabChange={setInspectorTab} onClose={() => setInspection(null)} returnFocusRef={inspectorTrigger}
        onShare={() => void copyText((globalThis.location?.origin ?? "") + "/compendium?card=" + encodeURIComponent(inspection.catalogId) + (inspectorPrinting ? "&printing=" + encodeURIComponent(inspectorPrinting) : "")).then(() => notify("Card link copied."))}
      />}
    </div>
  );
}

function DeckStatistics({ deck, report, typeCounts, rulesLoading, rulesError, hideTitle = false }: {
  deck: DeckRecord;
  report: DeckValidationResult;
  typeCounts: { type: CardTypeLabel; count: number }[];
  rulesLoading: boolean;
  rulesError: string | null;
  hideTitle?: boolean;
}) {
  const buckets = deckEnergyCurve(deck);
  const maximum = Math.max(1, ...buckets.map(({ count }) => count));
  return <div className={styles.statsPanel}>
    {!hideTitle && <h2>Statistics</h2>}
    <div className={styles.statTotals} aria-label="Deck totals">
      <div><strong>{deck.bakuganIds.length}/3</strong><span>Characters</span></div>
      <div><strong>{deck.coreIds.length}/6</strong><span>BakuCores</span></div>
      <div><strong>{deck.cardIds.length}</strong><span>Main Deck</span></div>
    </div>
    <section className={styles.statsSection} aria-labelledby={hideTitle ? "mobile-composition" : "desktop-composition"}>
      <h3 id={hideTitle ? "mobile-composition" : "desktop-composition"}>Card composition</h3>
      <dl className={styles.breakdown}>
        {typeCounts.map(({ type, count }) => <div key={type}><dt>{type}</dt><dd>{count}</dd></div>)}
      </dl>
    </section>
    <section className={styles.statsSection} aria-labelledby={hideTitle ? "mobile-energy" : "desktop-energy"}>
      <h3 id={hideTitle ? "mobile-energy" : "desktop-energy"}>Energy curve</h3>
      <div className={styles.energyChart} role="img" aria-label={buckets.map(({ label, count }) => count + " cards cost " + label + " Energy").join(", ")}>
        {buckets.map(({ label, count }) => <div className={styles.energyColumn} key={label}>
          <span className={styles.energyValue}>{count}</span>
          <span className={styles.energyTrack}><span style={{ height: Math.max(count ? 8 : 2, count / maximum * 100) + "%" }} /></span>
          <span className={styles.energyLabel}>{label}</span>
        </div>)}
      </div>
      <p className={styles.energyCaption}>Energy cost</p>
    </section>
    <section className={styles.statsSection} aria-labelledby={hideTitle ? "mobile-legality" : "desktop-legality"}>
      <h3 id={hideTitle ? "mobile-legality" : "desktop-legality"}>Deck legality</h3>
      {rulesLoading && deck.format === "competitive" ? (
        <p className={styles.statNotice}>Checking Competitive rules…</p>
      ) : rulesError && deck.format === "competitive" ? (
        <p className={styles.statNotice}>Competitive legality is unavailable. {rulesError}</p>
      ) : report.isLegal ? (
        <p className={styles.statLegal}>✓ Ready for battle</p>
      ) : (
        <ul className={styles.issues}>{report.issues.map((issue, index) =>
          <li key={issue.code + "-" + index}>{issue.message}</li>
        )}</ul>
      )}
      {rulesError && deck.format !== "competitive" && <p className={styles.statNotice}>Competitive format compatibility could not be checked.</p>}
    </section>
  </div>;
}

export function MissingDeck({ id, publicDeck = false }: { id: string; publicDeck?: boolean }) {
  return <div className={styles.route}><DeckState
    tone="error" role="alert" title="Deck not found"
    copy={"No " + (publicDeck ? "public" : "device-local") + " deck matches “" + id + "”."}
    action={<Link className={styles.back} href={publicDeck ? "/decks/public" : "/decks"}>Return to {publicDeck ? "Public Decks" : "My Decks"}</Link>}
  /></div>;
}
