"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GameCard, MatchState } from "../../lib/game";
import {
  energyCardCanTap,
  energyZoneViews,
  type EnergyZoneView,
} from "../../lib/energy";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import {
  EMPTY_GAME_SCREEN_ZONE_STATE,
  buildGameScreenZoneState,
  buildHeldCoreZoneState,
  deckBackAssetCount,
  heldCoreFanLayout,
  heroCardLayout,
  safeCardCount,
  type CharacterCardSlot,
  type GameScreenOwnerState,
  type HeldCoreZoneView,
  type ZoneOwner,
} from "./gameScreenState";
import gameStyles from "./GameScreen.module.css";
import discardStyles from "./DiscardPileLayer.module.css";
import coreStyles from "./HeldBakuCoreZone.module.css";
import { ResponsiveCardImage } from "./ResponsiveCardImage";

const styles = { ...gameStyles, ...discardStyles, ...coreStyles };
const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const COLUMN_RADIUS = Math.ceil(GRID_WIDTH / (HEX_X_STEP * 2)) + 2;
const ROW_RADIUS = Math.ceil(GRID_HEIGHT / (HEX_HEIGHT * 2)) + 3;
const CARD_BACK_ART = "/assets/card-back.png";
const ENERGY_SYMBOL_ART = "/assets/symbols/energy.svg";
const CARD_PREVIEW_CLEAR_EVENT = "bbp-card-preview-clear";

type CardStackZoneKind = "discard-pile" | "deck";
type CardStackZoneDefinition = {
  kind: CardStackZoneKind;
  lines: readonly string[];
};
type OwnerZoneCounts = {
  hero: number;
  deck: number;
  discardPile: number;
};
type EnergyTapHandler = (cardId: string) => void | Promise<void>;

export type GameScreenZoneCounts = Record<ZoneOwner, OwnerZoneCounts>;

const EMPTY_ZONE_COUNTS: GameScreenZoneCounts = {
  player: { hero: 0, deck: 0, discardPile: 0 },
  opponent: { hero: 0, deck: 0, discardPile: 0 },
};

const PLAYER_CHARACTER_CARD_SLOTS: readonly CharacterCardSlot[] = [1, 2, 3];
const OPPONENT_CHARACTER_CARD_SLOTS: readonly CharacterCardSlot[] = [3, 2, 1];

const PLAYER_CARD_STACK_ZONES: readonly CardStackZoneDefinition[] = [
  { kind: "discard-pile", lines: ["Discard", "Pile"] },
  { kind: "deck", lines: ["Deck"] },
];

const OPPONENT_CARD_STACK_ZONES: readonly CardStackZoneDefinition[] = [
  { kind: "deck", lines: ["Deck"] },
  { kind: "discard-pile", lines: ["Discard", "Pile"] },
];

function hexPoints(cx: number, cy: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = index * Math.PI / 3;
    return `${cx + Math.cos(angle) * HEX_RADIUS},${cy + Math.sin(angle) * HEX_RADIUS}`;
  }).join(" ");
}

const HEX_GRID = Array.from(
  { length: COLUMN_RADIUS * 2 + 1 },
  (_, columnIndex) => columnIndex - COLUMN_RADIUS,
).flatMap((q) => Array.from(
  { length: ROW_RADIUS * 2 + 1 },
  (_, rowIndex) => rowIndex - ROW_RADIUS,
).map((r) => {
  const cx = GRID_CENTER_X + q * HEX_X_STEP;
  const cy = GRID_CENTER_Y + (r + q / 2) * HEX_HEIGHT;
  return {
    key: `${q}:${r}`,
    cx,
    cy,
    points: hexPoints(cx, cy),
  };
})).filter((hex) => (
  hex.cx >= -HEX_RADIUS
  && hex.cx <= GRID_WIDTH + HEX_RADIUS
  && hex.cy >= -HEX_HEIGHT
  && hex.cy <= GRID_HEIGHT + HEX_HEIGHT
));

function ownerLabel(owner: ZoneOwner) {
  return owner === "player" ? "Your" : "Opponent";
}

function stackCount(counts: OwnerZoneCounts, kind: CardStackZoneKind) {
  return safeCardCount(kind === "deck" ? counts.deck : counts.discardPile);
}

function ZoneLabel({ lines }: { lines: readonly string[] }) {
  return <>{lines.map((line) => <span className={styles.zoneLabel} key={line}>{line}</span>)}</>;
}

function HeldCoreZone({
  owner,
  zone,
}: {
  owner: ZoneOwner;
  zone: HeldCoreZoneView;
}) {
  const { slot, bakugan, placements } = zone;
  const layout = heldCoreFanLayout(placements.length);
  const label = bakugan
    ? `${bakugan.name} BakuCore zone, ${placements.length} BakuCore${placements.length === 1 ? "" : "s"}`
    : `${ownerLabel(owner)} Character Card ${slot} BakuCore zone, 0 BakuCores`;

  return (
    <div
      className={styles.heldCoreZone}
      data-core-zone-id={`${owner}-bakucore-${slot}`}
      data-zone-owner={owner}
      data-slot={slot}
      data-bakugan-id={bakugan?.id}
      data-core-count={placements.length}
      aria-label={label}
    >
      <span className={styles.heldCoreZoneLabel} aria-hidden="true">BAKUCORE</span>
      {placements.map((placement, index) => {
        const centredIndex = index - (placements.length - 1) / 2;
        const style = {
          "--held-core-left": `${50 + centredIndex * layout.stepPercent}%`,
          "--held-core-width": `${layout.widthPercent}%`,
          "--held-core-rotation": `${centredIndex * layout.rotationStepDegrees}deg`,
          "--held-core-order": index,
        } as CSSProperties;
        return (
          <img
            className={styles.heldCore}
            src={placement.core.art}
            alt={placement.core.name}
            draggable={false}
            data-core-cell={placement.cell}
            style={style}
            key={placement.cell}
          />
        );
      })}
    </div>
  );
}

function CharacterCardZone({
  owner,
  zone,
}: {
  owner: ZoneOwner;
  zone: HeldCoreZoneView;
}) {
  const { slot, bakugan } = zone;
  const card = bakugan?.character;
  const label = card
    ? `${ownerLabel(owner)} Character Card ${slot}: ${card.displayName || card.name}`
    : `${ownerLabel(owner)} Character Card ${slot} zone`;

  return (
    <li className={styles.characterCardSlot} data-character-slot={slot}>
      <HeldCoreZone owner={owner} zone={zone} />
      <div
        className={styles.characterCardZone}
        data-zone-kind="character-card"
        data-zone-owner={owner}
        data-zone-id={`${owner}-character-card-${slot}`}
        data-slot={slot}
        data-bakugan-id={bakugan?.id}
        data-card-id={card?.id}
        data-character-open={bakugan?.open ? "true" : "false"}
        aria-label={label}
      >
        {card ? (
          <ResponsiveCardImage
            className={styles.characterCardImage}
            src={card.art}
            alt={card.displayName || card.name}
            eager={bakugan?.open}
            draggable={false}
          />
        ) : <ZoneLabel lines={["Character", `Card ${slot}`]} />}
      </div>
    </li>
  );
}

function DeckStack({ count, owner }: { count: number; owner: ZoneOwner }) {
  const visualCount = deckBackAssetCount(count);
  if (visualCount === 0) return null;

  return (
    <div className={styles.deckBackStack} aria-hidden="true">
      {Array.from({ length: visualCount }, (_, index) => {
        const centredIndex = index - (visualCount - 1) / 2;
        const style = {
          "--deck-x": `${centredIndex * 1.8}px`,
          "--deck-y": `${centredIndex * -1.25}px`,
          "--deck-order": index,
        } as CSSProperties;
        return (
          <img
            className={styles.deckBackCard}
            src={CARD_BACK_ART}
            alt=""
            draggable={false}
            data-zone-owner={owner}
            style={style}
            key={`${owner}-deck-back-${index}`}
          />
        );
      })}
    </div>
  );
}

function DiscardCard({ card }: { card: GameCard | null }) {
  if (!card) return null;
  return (
    <ResponsiveCardImage
      className={styles.discardCardImage}
      src={card.art}
      alt={card.displayName || card.name}
      draggable={false}
    />
  );
}

function CardStackZone({
  owner,
  kind,
  lines,
  count,
  latestDiscard,
  discardOpen,
  onOpenDiscard,
}: {
  owner: ZoneOwner;
  kind: CardStackZoneKind;
  lines: readonly string[];
  count: number;
  latestDiscard: GameCard | null;
  discardOpen: boolean;
  onOpenDiscard: (owner: ZoneOwner) => void;
}) {
  const label = lines.join(" ");
  const cardCount = safeCardCount(count);
  const hasVisual = kind === "deck" ? cardCount > 0 : Boolean(latestDiscard);
  const canOpenDiscard = kind === "discard-pile" && cardCount > 0;
  const openDiscard = () => {
    if (canOpenDiscard) onOpenDiscard(owner);
  };

  return (
    <li
      className={`${styles.cardStackZone} ${canOpenDiscard ? styles.cardStackZoneInteractive : ""}`}
      data-zone-kind={kind}
      data-zone-owner={owner}
      data-zone-id={`${owner}-${kind}`}
      data-card-id={kind === "discard-pile" ? latestDiscard?.id : undefined}
      data-card-count={cardCount}
      data-top-card-id={kind === "discard-pile" ? latestDiscard?.id : undefined}
      role={canOpenDiscard ? "button" : undefined}
      tabIndex={canOpenDiscard ? 0 : undefined}
      aria-haspopup={canOpenDiscard ? "dialog" : undefined}
      aria-expanded={canOpenDiscard ? discardOpen : undefined}
      aria-label={`${ownerLabel(owner)} ${label} zone, ${cardCount} cards${canOpenDiscard ? ", open discard pile" : ""}`}
      onClick={openDiscard}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDiscard();
      }}
    >
      {!hasVisual && <ZoneLabel lines={lines} />}
      {kind === "deck"
        ? <DeckStack count={cardCount} owner={owner} />
        : <DiscardCard card={latestDiscard} />}
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </li>
  );
}

function HeroStack({ cards }: { cards: readonly GameCard[] }) {
  if (!cards.length) return null;
  const layout = heroCardLayout(cards.length);

  return (
    <div className={styles.heroCardStack}>
      {cards.map((card, index) => {
        const left = layout.startPercent + index * layout.stepPercent;
        const style = { "--hero-left": `${left}%`, "--hero-order": index } as CSSProperties;
        return (
          <ResponsiveCardImage
            className={styles.heroCardImage}
            src={card.art}
            alt={card.displayName || card.name}
            draggable={false}
            style={style}
            key={card.id}
          />
        );
      })}
    </div>
  );
}

function HeroZone({ owner, cards, count }: { owner: ZoneOwner; cards: readonly GameCard[]; count: number }) {
  const cardCount = safeCardCount(count);
  return (
    <div
      className={styles.heroZone}
      data-zone-kind="hero"
      data-zone-owner={owner}
      data-zone-id={`${owner}-hero`}
      data-card-count={cardCount}
      aria-label={`${ownerLabel(owner)} Hero zone, ${cardCount} cards`}
    >
      {!cards.length && <ZoneLabel lines={["Hero", "Zone"]} />}
      <HeroStack cards={cards} />
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </div>
  );
}

function EnergyCardStack({
  owner,
  energy,
  pendingCardId,
  onTap,
  canTap,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
}) {
  if (!energy.cards.length) return null;
  const layout = heroCardLayout(energy.cards.length);
  const tappedIds = new Set(energy.tappedEnergyIds);

  return (
    <div className={styles.energyCardStack}>
      {energy.cards.map((card, index) => {
        const tapped = tappedIds.has(card.id);
        const actionable = owner === "player"
          && Boolean(onTap)
          && !tapped
          && pendingCardId !== card.id
          && (canTap?.(card.id) ?? true);
        const left = layout.startPercent + index * layout.stepPercent;
        const style = {
          "--energy-left": `${left}%`,
          "--energy-order": index,
        } as CSSProperties;

        return (
          <button
            type="button"
            className={`${styles.energyCard} ${tapped ? styles.energyCardTapped : ""}`}
            style={style}
            data-card-id={card.id}
            data-tapped={tapped ? "true" : "false"}
            aria-pressed={tapped}
            aria-label={tapped
              ? `${ownerLabel(owner)} Energy card ${index + 1}, tapped`
              : `${ownerLabel(owner)} Energy card ${index + 1}${owner === "player" ? ", tap to generate 1 Energy" : ""}`}
            disabled={!actionable}
            onClick={() => onTap?.(card.id)}
            key={card.id}
          >
            <img
              src={CARD_BACK_ART}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          </button>
        );
      })}
    </div>
  );
}

function EnergyZone({
  owner,
  energy,
  pendingCardId,
  onTap,
  canTap,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
}) {
  return (
    <div
      className={styles.energyZone}
      data-zone-kind="energy"
      data-zone-owner={owner}
      data-zone-id={`${owner}-energy`}
      data-card-count={energy.cards.length}
      data-available-energy={energy.availableEnergy}
      aria-label={`${ownerLabel(owner)} Energy Card zone, ${energy.availableEnergy} available Energy from ${energy.cards.length} cards`}
    >
      {!energy.cards.length && <ZoneLabel lines={["Energy", "Card Zone"]} />}
      <EnergyCardStack
        owner={owner}
        energy={energy}
        pendingCardId={pendingCardId}
        onTap={onTap}
        canTap={canTap}
      />
      <strong
        className={styles.energyIndicator}
        aria-label={`${energy.availableEnergy} available Energy`}
      >
        <span>{energy.availableEnergy}</span>
        <img src={ENERGY_SYMBOL_ART} alt="Energy" draggable={false} />
      </strong>
    </div>
  );
}

function PlayerZoneLayout({
  owner,
  counts,
  state,
  coreZones,
  energy,
  pendingEnergyCardId,
  onTapEnergyCard,
  canTapEnergyCard,
  openDiscardOwner,
  onOpenDiscard,
}: {
  owner: ZoneOwner;
  counts: OwnerZoneCounts;
  state: GameScreenOwnerState;
  coreZones: readonly HeldCoreZoneView[];
  energy: EnergyZoneView;
  pendingEnergyCardId?: string;
  onTapEnergyCard?: EnergyTapHandler;
  canTapEnergyCard?: (cardId: string) => boolean;
  openDiscardOwner: ZoneOwner | null;
  onOpenDiscard: (owner: ZoneOwner) => void;
}) {
  const isOpponent = owner === "opponent";
  const characterSlots = isOpponent
    ? OPPONENT_CHARACTER_CARD_SLOTS
    : PLAYER_CHARACTER_CARD_SLOTS;
  const cardStackZones = isOpponent
    ? OPPONENT_CARD_STACK_ZONES
    : PLAYER_CARD_STACK_ZONES;

  return (
    <>
      <section
        className={`${styles.characterCardArea} ${
          isOpponent ? styles.opponentCharacterCardArea : styles.playerCharacterCardArea
        }`}
        data-zone-owner={owner}
        data-zone-group="character-cards"
        aria-label={`${ownerLabel(owner)} Bakugan Character card area`}
      >
        <ol className={styles.characterCardZones}>
          {characterSlots.map((slot) => (
            <CharacterCardZone
              key={`${owner}-${slot}`}
              owner={owner}
              zone={coreZones[slot - 1] ?? { slot, bakugan: null, placements: [] }}
            />
          ))}
        </ol>
      </section>

      <section
        className={`${styles.cardStackArea} ${
          isOpponent ? styles.opponentCardStackArea : styles.playerCardStackArea
        }`}
        data-zone-owner={owner}
        data-zone-group="play-area-cards"
        aria-label={`${ownerLabel(owner)} Energy, Hero, deck, and discard pile area`}
      >
        <EnergyZone
          owner={owner}
          energy={energy}
          pendingCardId={pendingEnergyCardId}
          onTap={onTapEnergyCard}
          canTap={canTapEnergyCard}
        />
        <div className={styles.cardStackMain}>
          <HeroZone owner={owner} cards={state.heroCards} count={counts.hero} />
          <ol className={styles.cardStackZones}>
            {cardStackZones.map((zone) => (
              <CardStackZone
                key={`${owner}-${zone.kind}`}
                owner={owner}
                {...zone}
                count={stackCount(counts, zone.kind)}
                latestDiscard={state.latestDiscard}
                discardOpen={openDiscardOwner === owner}
                onOpenDiscard={onOpenDiscard}
              />
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

function DiscardPileModal({
  owner,
  cards,
  onClose,
}: {
  owner: ZoneOwner;
  cards: readonly GameCard[];
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
  }, [portalRoot]);

  if (!portalRoot) return null;
  const newestFirst = [...cards].reverse();
  const titleId = `${owner}-discard-pile-title`;

  return createPortal(
    <div
      className={styles.discardModalBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.discardModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-zone-kind="discard-browser"
        data-zone-owner={owner}
      >
        <header className={styles.discardModalHeader}>
          <div>
            <span>{owner === "player" ? "YOUR CARDS" : "OPPONENT CARDS"}</span>
            <h2 id={titleId}>DISCARD PILE</h2>
            <p>{cards.length} card{cards.length === 1 ? "" : "s"} • newest first</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className={styles.discardModalClose}
            onClick={onClose}
            aria-label="Close discard pile"
          >
            ×
          </button>
        </header>
        <div className={styles.discardModalGrid}>
          {newestFirst.map((card, index) => (
            <figure
              className={styles.discardModalCard}
              data-card-id={card.id}
              key={card.id}
            >
              <ResponsiveCardImage
                src={card.art}
                alt={card.displayName || card.name}
                draggable={false}
              />
              <figcaption>
                <strong>{card.displayName || card.name}</strong>
                <span>{index === 0 ? "Newest" : `#${cards.length - index}`}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>,
    portalRoot,
  );
}

export function GameScreen({
  onExit,
  onTapEnergyCard,
  match,
  playerId,
  zoneCounts = EMPTY_ZONE_COUNTS,
}: {
  onExit?: () => void;
  onTapEnergyCard?: EnergyTapHandler;
  match?: MatchState | null;
  playerId?: string;
  zoneCounts?: GameScreenZoneCounts;
}) {
  const [pendingEnergyCardId, setPendingEnergyCardId] = useState("");
  const [energyError, setEnergyError] = useState("");
  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);
  const { hiddenCoreCells } = useBakuCorePresentation();

  const zoneState = match
    ? buildGameScreenZoneState(match, playerId)
    : EMPTY_GAME_SCREEN_ZONE_STATE;
  const heldCoreZones = buildHeldCoreZoneState(match, playerId, hiddenCoreCells);
  const energyState = energyZoneViews(match, playerId);
  const resolvedCounts: GameScreenZoneCounts = match
    ? {
      player: {
        hero: zoneState.player.heroCards.length,
        deck: zoneState.player.deckCount,
        discardPile: zoneState.player.discardCount,
      },
      opponent: {
        hero: zoneState.opponent.heroCards.length,
        deck: zoneState.opponent.deckCount,
        discardPile: zoneState.opponent.discardCount,
      },
    }
    : zoneCounts;

  const closeDiscard = () => setOpenDiscardOwner(null);
  const openDiscard = (owner: ZoneOwner) => {
    if (!zoneState[owner].discardCards.length) return;
    window.dispatchEvent(new Event(CARD_PREVIEW_CLEAR_EVENT));
    setOpenDiscardOwner(owner);
  };

  useEffect(() => {
    if (!onExit && !openDiscardOwner) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (openDiscardOwner) closeDiscard();
      else onExit?.();
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [onExit, openDiscardOwner]);

  useEffect(() => {
    if (openDiscardOwner && !zoneState[openDiscardOwner].discardCards.length) {
      setOpenDiscardOwner(null);
    }
  }, [match?.version, openDiscardOwner, zoneState]);

  const tapEnergy = async (cardId: string) => {
    if (!onTapEnergyCard || pendingEnergyCardId) return;
    setPendingEnergyCardId(cardId);
    setEnergyError("");
    try {
      await onTapEnergyCard(cardId);
    } catch (error) {
      setEnergyError(error instanceof Error ? error.message : "Energy card could not be tapped.");
    } finally {
      setPendingEnergyCardId("");
    }
  };

  const openDiscardCards = openDiscardOwner
    ? zoneState[openDiscardOwner].discardCards
    : [];

  return (
    <>
      <div className={styles.screen}>
        <div className={styles.playArea} data-gameplay-surface="true" aria-label="Game play area">
          <svg
            className={styles.hexGrid}
            viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="game-screen-hex-fade" cx="50%" cy="50%" r="70%">
                <stop offset="0%" stopColor="white" stopOpacity="0.9" />
                <stop offset="38%" stopColor="white" stopOpacity="0.72" />
                <stop offset="59%" stopColor="white" stopOpacity="0.3" />
                <stop offset="80%" stopColor="black" stopOpacity="0" />
              </radialGradient>
              <mask id="game-screen-hex-mask">
                <rect width={GRID_WIDTH} height={GRID_HEIGHT} fill="url(#game-screen-hex-fade)" />
              </mask>
            </defs>
            <g mask="url(#game-screen-hex-mask)">
              {HEX_GRID.map((hex) => <polygon key={hex.key} points={hex.points} />)}
            </g>
          </svg>

          <PlayerZoneLayout
            owner="opponent"
            counts={resolvedCounts.opponent}
            state={zoneState.opponent}
            coreZones={heldCoreZones.opponent}
            energy={energyState.opponent}
            openDiscardOwner={openDiscardOwner}
            onOpenDiscard={openDiscard}
          />
          <PlayerZoneLayout
            owner="player"
            counts={resolvedCounts.player}
            state={zoneState.player}
            coreZones={heldCoreZones.player}
            energy={energyState.player}
            pendingEnergyCardId={pendingEnergyCardId}
            onTapEnergyCard={tapEnergy}
            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}
            openDiscardOwner={openDiscardOwner}
            onOpenDiscard={openDiscard}
          />
        </div>
        {energyError && <div className={styles.energyError} role="alert">{energyError}</div>}
      </div>
      {openDiscardOwner && openDiscardCards.length ? (
        <DiscardPileModal
          owner={openDiscardOwner}
          cards={openDiscardCards}
          onClose={closeDiscard}
        />
      ) : null}
    </>
  );
}

