"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { cardArtSource, isFlipCardType } from "../../lib/content/card-art";
import { BAKUGAN, CARDS, CORES, validateDeck, type DeckRecord } from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import type { GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import { PUBLISHED_RULINGS } from "../../lib/reference";
import { deckTextList, encodeDeckCode } from "../../lib/deck-transfer";
import { deckEnergyCurve, deckExportFilename, groupedDeckCards } from "../../lib/deck-presentation";
import { deckSetName } from "../../lib/deck-set";
import { CardArt } from "../cards/CardArt";
import { BakuganRollingOverlay } from "../cards/BakuganRollingStats";
import { copyText, downloadTextFile, formatTimestamp } from "../application/ui";
import { CardInspector } from "../cards/CardInspector";
import { ActionButton, RouteHero, StatusChip, Surface } from "../design-system/primitives";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import styles from "./DeckRoutes.module.css";
import { DeckState } from "./DeckRouteShared";
import { CharacterFan, DeckFactionTags } from "./DeckLibraryPresentation";
import { BUILDER_RULE_REFERENCES } from "./DeckInspectorReferences";

export function DeckDetailPresentation({
  deck,
  publicView = false,
  notify,
  actions,
  sharePanel,
  creatorIdentity,
}: {
  deck: DeckRecord;
  publicView?: boolean;
  notify: (message: string) => void;
  actions: ReactNode;
  sharePanel?: ReactNode;
  creatorIdentity?: { userId?: string; displayName: string };
}) {
  const report = validateDeck(deck);
  const bakugan = deck.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)).filter(Boolean);
  const cards = groupedDeckCards(deck);
  const cores = deck.coreIds.map((key) => CORES.find((item) => item.id === key)).filter(Boolean);
  const typeCounts = cards.reduce<Record<string, number>>((counts, entry) => {
    const type = isFlipCardType(entry.card.type) ? "Flip" : entry.card.type;
    counts[type] = (counts[type] ?? 0) + entry.count;
    return counts;
  }, {});
  const cardSections = [
    { type: "Action", cards: cards.filter((entry) => entry.card.type === "Action") },
    { type: "Hero", cards: cards.filter((entry) => entry.card.type === "Hero") },
    { type: "Evo", cards: cards.filter((entry) => entry.card.type === "Evo") },
    { type: "Baku-Gear", cards: cards.filter((entry) => entry.card.type === "Baku-Gear") },
    { type: "Flip", cards: cards.filter((entry) => isFlipCardType(entry.card.type)) },
  ].filter((section) => section.cards.length);
  const [inspection, setInspection] = useState<GameCard | null>(null);
  const [inspectorTab, setInspectorTab] = useState<CardInspectorTab>("overview");
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const inspectCard = (card: GameCard, trigger?: HTMLElement | null) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    setInspectorTab("overview");
    setInspection(card);
  };
  return (
    <div className={styles.route}>
      <RouteHero
        className={styles.detailHero}
        eyebrow={publicView ? "PUBLIC DECK" : "MY DECK"}
        title={deck.name}
        description={deck.description ?? `${deck.format ?? "standard"} format · ${deck.visibility} · updated ${formatTimestamp(deck.updatedAt)}`}
        actions={actions}
        aside={<CharacterFan deck={deck} />}
      />
      <div className={styles.detailMeta}>
        <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
        <DeckFactionTags factions={deck.factions} />
        {publicView && (
          <span>
            Created by{" "}
            <DeckCreatorIdentity
              userId={(deck as DeckRecord & { creatorUserId?: string }).creatorUserId}
              displayName={deck.creator ?? "Community Brawler"}
            />
          </span>
        )}
        {!publicView && creatorIdentity && (
          <span>
            Created by{" "}
            <DeckCreatorIdentity userId={creatorIdentity.userId} displayName={creatorIdentity.displayName} />
          </span>
        )}
      </div>
      <section className={styles.detailLayout}>
        <main>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Team configuration</span><h2>Character Cards</h2></div><StatusChip>{bakugan.length}/3</StatusChip></div>
            <div className={styles.detailTeam}>
              {bakugan.map((item) => (
                <article key={item!.id}>
                  <button
                    type="button"
                    className={styles.detailCharacterButton}
                    aria-label={`Inspect ${item!.name} character card`}
                    onClick={(event) => inspectCard(item!.character, event.currentTarget)}
                  >
                    <span className={styles.detailCharacterArt}>
                      <CardArt src={cardArtSource(item!.character, "full")} cardType={item!.character.type} presentation="readable" alt={item!.name} />
                      <BakuganRollingOverlay card={item!.character} />
                    </span>
                    <strong>{item!.name}</strong>
                    <span className={styles.characterStats}>
                      <span><OriginalImage src={FACTION_SYMBOLS[item!.faction]} alt="" aria-hidden="true" />{item!.faction}</span>
                      <span>{item!.bPower}B</span>
                      <span>{item!.damage}D</span>
                    </span>
                  </button>
                </article>
              ))}
            </div>
            <div className={styles.subsectionHeading}><span>BakuCore lineup</span><strong>{cores.length}/6</strong></div>
            <div className={styles.coreStrip}>
              {cores.map((core, index) => (
                <div key={`${core!.id}-${index}`}><OriginalImage src={core!.art} alt={core!.name} /><strong>{core!.type}</strong><span>{core!.name}</span></div>
              ))}
            </div>
          </Surface>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Construction</span><h2>Main Deck</h2></div><StatusChip>{deck.cardIds.length}/{deck.format === "competitive" ? 50 : 40}</StatusChip></div>
            <div className={styles.detailCardGroups}>
              {cardSections.map((section) => (
                <section key={section.type} className={styles.detailCardGroup}>
                  <div className={styles.subsectionHeading}>
                    <span>{section.type} cards</span>
                    <strong>{section.cards.reduce((total, entry) => total + entry.count, 0)}</strong>
                  </div>
                  <div className={styles.detailCardList}>
                    {section.cards.map(({ card, count }) => (
                      <article key={card.catalogId}>
                        <button
                          type="button"
                          className={styles.detailCardButton}
                          aria-label={`Inspect ${card.displayName}`}
                          onClick={(event) => inspectCard(card, event.currentTarget)}
                        >
                          <div className={styles.detailCardArt}>
                            <CardArt src={cardArtSource(card, "full")} cardType={card.type} presentation="readable" alt={card.displayName} />
                            <span className={styles.copyCount} aria-label={`${count} copies`}>×{count}</span>
                          </div>
                          <strong>{card.displayName}</strong>
                          <span>{card.faction} · {card.cost} Energy</span>
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Surface>
        </main>
        <aside className={styles.detailAside}>
          {sharePanel}
          <ValidationPanel report={report} />
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><h2>Breakdown</h2></div>
            <dl className={styles.breakdown}>
              {Object.entries(typeCounts).map(([cardType, count]) => <div key={cardType}><dt>{cardType}</dt><dd>{count}</dd></div>)}
              <div><dt>BakuCores</dt><dd>{deck.coreIds.length}</dd></div>
            </dl>
            <EnergyCurve deck={deck} />
          </Surface>
        </aside>
      </section>
      {inspection && (
        <CardInspector
          card={inspection}
          allCards={CARDS}
          rules={BUILDER_RULE_REFERENCES}
          rulings={PUBLISHED_RULINGS}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => setInspection(null)}
          returnFocusRef={inspectorTrigger}
          onShare={() => void copyText(`${globalThis.location?.origin ?? ""}/compendium?card=${encodeURIComponent(inspection.catalogId)}`).then(() => notify("Card link copied."))}
        />
      )}
    </div>
  );
}

export function DeckSharePanel({
  deck,
  copyAvailable = false,
  onCopy,
  notify,
  showCopyAction = true,
}: {
  deck: DeckRecord;
  copyAvailable?: boolean;
  onCopy?: () => void;
  notify: (message: string) => void;
  showCopyAction?: boolean;
}) {
  const [imagePending, setImagePending] = useState(false);
  const copyValue = async (value: string, success: string) => {
    try {
      await copyText(value);
      notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The value could not be copied.");
    }
  };
  const exportImage = async () => {
    if (imagePending) return;
    setImagePending(true);
    try {
      const { exportDeckImage } = await import("../../lib/deck-image-export");
      await exportDeckImage(deck);
      notify("Deck image exported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The deck image could not be exported.");
    } finally {
      setImagePending(false);
    }
  };
  return (
    <Surface className={`${styles.detailPanel} ${styles.sharePanel}`}>
      <div className={styles.panelHeading}>
        <div><span>Sharing</span><h2>Share this deck</h2></div>
      </div>
      {showCopyAction && onCopy && (
        <ActionButton className={styles.sharePrimary} onClick={onCopy} disabled={!copyAvailable}>Copy to My Decks</ActionButton>
      )}
      <div className={styles.shareActionGrid}>
        <button type="button" onClick={() => void copyValue(window.location.href, "Deck link copied.")}><span aria-hidden="true">↗</span>Copy Link</button>
        <button type="button" onClick={() => void copyValue(encodeDeckCode(deck), "Deck code copied.")}><span aria-hidden="true">⌘</span>Copy Code</button>
      </div>
      <div className={styles.exportHeading}><span>Export</span></div>
      <div className={styles.shareActionGrid}>
        <button type="button" onClick={() => {
          downloadTextFile(deckExportFilename(deck.name, "txt"), deckTextList(deck));
          notify("Text list exported.");
        }}><span aria-hidden="true">≡</span>As a Text List</button>
        <button type="button" disabled={imagePending} onClick={() => void exportImage()}><span aria-hidden="true">▧</span>{imagePending ? "Creating Image…" : "As an Image"}</button>
      </div>
    </Surface>
  );
}

export function EnergyCurve({ deck }: { deck: DeckRecord }) {
  const buckets = deckEnergyCurve(deck);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <section className={styles.energyCurve} aria-labelledby="energy-curve-title">
      <div className={styles.subsectionHeading}>
        <span id="energy-curve-title">Energy curve</span>
        <strong>{deck.cardIds.length} cards</strong>
      </div>
      <div className={styles.energyChart} role="img" aria-label={buckets.map((bucket) => `${bucket.count} cards cost ${bucket.label} Energy`).join(", ")}>
        {buckets.map((bucket) => (
          <div className={styles.energyBarColumn} key={bucket.label}>
            <strong>{bucket.count}</strong>
            <span className={styles.energyBarTrack} aria-hidden="true">
              <span style={{ height: `${Math.max(bucket.count ? 8 : 2, bucket.count / maximum * 100)}%` }} />
            </span>
            <span>{bucket.label}</span>
          </div>
        ))}
      </div>
      <div className={styles.energyAxisLabel}>Energy cost</div>
    </section>
  );
}

export function ValidationPanel({ report, compact = false }: { report: DeckValidationResult; compact?: boolean }) {
  return (
    <Surface className={`${styles.validationPanel} ${report.isLegal ? styles.validationLegal : styles.validationInvalid} ${compact ? styles.validationCompact : ""}`}>
      <div className={styles.validationHeading}>
        <div><span>Deck legality</span><h2>{report.isLegal ? "Ready for battle" : "Requires attention"}</h2></div>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
      </div>
      {report.isLegal ? (
        <p>Team, BakuCores, factions, copy limits, and Main Deck size pass.</p>
      ) : (
        <ul>{report.issues.map((candidate) => <li key={candidate.code}><code>{candidate.code}</code>{candidate.message}</li>)}</ul>
      )}
    </Surface>
  );
}

export function MissingDeck({ id, publicDeck = false }: { id: string; publicDeck?: boolean }) {
  return (
    <div className={styles.route}>
      <DeckState
        tone="error"
        role="alert"
        title="Deck not found"
        copy={`No ${publicDeck ? "public" : "device-local"} deck matches “${id}”.`}
        action={<Link className={styles.textAction} href={publicDeck ? "/decks/public" : "/decks"}>Return to {publicDeck ? "Public Decks" : "My Decks"}</Link>}
      />
    </div>
  );
}
