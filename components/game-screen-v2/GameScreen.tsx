"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GameCard, MatchState } from "../../lib/game";
import {
  energyCardCanTap,
  energyZoneViews,
  type EnergyZoneView,
} from "../../lib/energy";
import {
  deckEnergyFaceVisible,
  nextDeckEnergyFaceRevealExpiry,
} from "../../lib/energyVisibility";
import {
  playerCanDrawTurnCard,
  type TurnStartMatchState,
} from "../../lib/turnStart";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { useAdministratorAiVisibility } from "../application/useAdministratorAiVisibility";
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
import {
  boardCardFinalizeTransitions,
  captureBoardCardFinalizeSnapshot,
} from "./boardCardFinalizePresentation";
import gameStyles from "./GameScreen.module.css";
import discardStyles from "./DiscardPileLayer.module.css";
import coreStyles from "./HeldBakuCoreZone.module.css";
import finalizeStyles from "./BoardCardFinalizePresentation.module.css";
import { ResponsiveCardImage } from "./ResponsiveCardImage";

const styles = { ...gameStyles, ...discardStyles, ...coreStyles, ...finalizeStyles };
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
const BOARD_CARD_SLAM_MS = 520;

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
type DrawHandler = () => void | Promise<void>;

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
          <BakuCoreArt
            core={placement.core}
            className={styles.heldCore}
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
  slammingCardIds,
}: {
  owner: ZoneOwner;
  zone: HeldCoreZoneView;
  slammingCardIds: ReadonlySet<string>;
}) {
  const { slot, bakugan } = zone;
  const characterCard = bakugan?.character;
  const evoCard = bakugan?.evoStack.at(-1);
  const fusionCard = bakugan?.fused ? bakugan.fusionCharacter : undefined;
  const card = evoCard ?? fusionCard ?? characterCard;
  const slamming = Boolean(card && slammingCardIds.has(card.id));
  const cardKind = evoCard ? "Evo" : fusionCard ? "Fusion Character" : "Character";
  const label = card
    ? `${ownerLabel(owner)} ${cardKind} Card ${slot}: ${card.displayName || card.name}`
    : `${ownerLabel(owner)} Character Card ${slot} zone`;

  return (
    <li className={styles.characterCardSlot} data-character-slot={slot}>
      <HeldCoreZone owner={owner} zone={zone} />
      <div
        className={`${styles.characterCardZone} ${slamming ? styles.boardCardImpact : ""}`}
        data-zone-kind="character-card"
        data-zone-owner={owner}
        data-zone-id={`${owner}-character-card-${slot}`}
        data-slot={slot}
        data-bakugan-id={bakugan?.id}
        data-card-id={card?.id}
        data-base-character-card-id={characterCard?.id}
        data-fusion-character-card-id={fusionCard?.id}
        data-fused={bakugan?.fused ? "true" : "false"}
        data-evo-card-id={evoCard?.id}
        data-character-open={bakugan?.open ? "true" : "false"}
        aria-label={label}
      >
        {card ? (
          <ResponsiveCardImage
            className={`${styles.characterCardImage} ${slamming ? styles.characterCardSlamming : ""}`}
            src={card.art}
            alt={card.displayName || card.name}
            eager={bakugan?.open}
            draggable={false}
            dataCardId={card.id}
            key={card.id}
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
          <OriginalImage
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
  drawAvailable = false,
  drawPending = false,
  onDrawDeck,
  onOpenDiscard,
}: {
  owner: ZoneOwner;
  kind: CardStackZoneKind;
  lines: readonly string[];
  count: number;
  latestDiscard: GameCard | null;
  discardOpen: boolean;
  drawAvailable?: boolean;
  drawPending?: boolean;
  onDrawDeck?: () => void;
  onOpenDiscard: (owner: ZoneOwner) => void;
}) {
  const label = lines.join(" ");
  const cardCount = safeCardCount(count);
  const hasVisual = kind === "deck" ? cardCount > 0 : Boolean(latestDiscard);
  const canOpenDiscard = kind === "discard-pile" && cardCount > 0;
  const canDrawDeck = kind === "deck" && owner === "player" && drawAvailable && Boolean(onDrawDeck);
  const interactive = canOpenDiscard || canDrawDeck;
  const activate = () => {
    if (canDrawDeck) onDrawDeck?.();
    else if (canOpenDiscard) onOpenDiscard(owner);
  };
  const className = [
    styles.cardStackZone,
    canOpenDiscard ? styles.cardStackZoneInteractive : "",
    canDrawDeck ? styles.cardStackZoneDrawReady : "",
    drawPending && kind === "deck" && owner === "player" ? styles.cardStackZoneDrawPending : "",
  ].filter(Boolean).join(" ");
  const interactionLabel = canDrawDeck
    ? ", click to draw"
    : canOpenDiscard ? ", open discard pile" : "";

  return (
    <li
      className={className}
      data-zone-kind={kind}
      data-zone-owner={owner}
      data-zone-id={`${owner}-${kind}`}
      data-card-id={kind === "discard-pile" ? latestDiscard?.id : undefined}
      data-card-type={kind === "discard-pile" ? latestDiscard?.type : undefined}
      data-card-count={cardCount}
      data-top-card-id={kind === "discard-pile" ? latestDiscard?.id : undefined}
      data-draw-available={canDrawDeck ? "true" : undefined}
      data-draw-pending={drawPending && kind === "deck" && owner === "player" ? "true" : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-busy={drawPending && kind === "deck" && owner === "player" ? true : undefined}
      aria-haspopup={canOpenDiscard ? "dialog" : undefined}
      aria-expanded={canOpenDiscard ? discardOpen : undefined}
      aria-label={`${ownerLabel(owner)} ${label} zone, ${cardCount} cards${interactionLabel}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        activate();
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

function HeroStack({
  cards,
  slammingCardIds,
}: {
  cards: readonly GameCard[];
  slammingCardIds: ReadonlySet<string>;
}) {
  if (!cards.length) return null;
  const layout = heroCardLayout(cards.length);

  return (
    <div className={styles.heroCardStack}>
      {cards.map((card, index) => {
        const left = layout.startPercent + index * layout.stepPercent;
        const style = { "--hero-left": `${left}%`, "--hero-order": index } as CSSProperties;
        const slamming = slammingCardIds.has(card.id);
        return (
          <ResponsiveCardImage
            className={`${styles.heroCardImage} ${slamming ? styles.heroCardSlamming : ""}`}
            src={card.art}
            alt={card.displayName || card.name}
            draggable={false}
            dataCardId={card.id}
            style={style}
            key={card.id}
          />
        );
      })}
    </div>
  );
}

function HeroZone({
  owner,
  cards,
  count,
  slammingCardIds,
}: {
  owner: ZoneOwner;
  cards: readonly GameCard[];
  count: number;
  slammingCardIds: ReadonlySet<string>;
}) {
  const cardCount = safeCardCount(count);
  const impact = cards.some((card) => slammingCardIds.has(card.id));
  return (
    <div
      className={`${styles.heroZone} ${impact ? styles.boardCardImpact : ""}`}
      data-zone-kind="hero"
      data-zone-owner={owner}
      data-zone-id={`${owner}-hero`}
      data-card-count={cardCount}
      aria-label={`${ownerLabel(owner)} Hero zone, ${cardCount} cards`}
    >
      {!cards.length && <ZoneLabel lines={["Hero", "Zone"]} />}
      <HeroStack cards={cards} slammingCardIds={slammingCardIds} />
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
  revealFaces = false,
  temporaryRevealCardIds,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
  temporaryRevealCardIds?: ReadonlySet<string>;
}) {
  if (!energy.cards.length) return null;
  const layout = heroCardLayout(energy.cards.length);
  const tappedIds = new Set(energy.unchargedEnergyIds);

  return (
    <div className={styles.energyCardStack}>
      {energy.cards.map((card, index) => {
        const tapped = tappedIds.has(card.id);
        const faceVisible = revealFaces || temporaryRevealCardIds?.has(card.id) === true;
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
            <OriginalImage
              src={faceVisible ? card.art : CARD_BACK_ART}
              alt={faceVisible ? card.displayName || card.name : ""}
              aria-hidden={!faceVisible}
              data-hidden={faceVisible ? "false" : "true"}
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
  revealFaces = false,
  temporaryRevealCardIds,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
  temporaryRevealCardIds?: ReadonlySet<string>;
}) {
  return (
    <div
      className={styles.energyZone}
      data-zone-kind="energy"
      data-zone-owner={owner}
      data-zone-id={`${owner}-energy`}
      data-card-count={energy.cards.length}
      data-charged-card-count={energy.chargedEnergyCount}
      data-available-energy={energy.availableEnergy}
      aria-label={`${ownerLabel(owner)} Energy Card zone, ${energy.chargedEnergyCount} charged of ${energy.cards.length} cards, ${energy.availableEnergy} produced Energy available`}
    >
      {!energy.cards.length && <ZoneLabel lines={["Energy", "Card Zone"]} />}
      <EnergyCardStack
        owner={owner}
        energy={energy}
        pendingCardId={pendingCardId}
        onTap={onTap}
        canTap={canTap}
        revealFaces={revealFaces}
        temporaryRevealCardIds={temporaryRevealCardIds}
      />
      <strong
        className={styles.energyIndicator}
        aria-label={`${energy.availableEnergy} available Energy`}
      >
        <span>{energy.availableEnergy}</span>
        <OriginalImage src={ENERGY_SYMBOL_ART} alt="Energy" draggable={false} />
      </strong>
      <strong className={styles.zoneCount} aria-hidden="true">
        {safeCardCount(energy.chargedEnergyCount)}/{safeCardCount(energy.cards.length)}
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
  slammingCardIds,
  pendingEnergyCardId,
  onTapEnergyCard,
  canTapEnergyCard,
  revealEnergyFaces = false,
  temporaryEnergyRevealCardIds,
  drawAvailable = false,
  drawPending = false,
  onDrawDeck,
  openDiscardOwner,
  onOpenDiscard,
}: {
  owner: ZoneOwner;
  counts: OwnerZoneCounts;
  state: GameScreenOwnerState;
  coreZones: readonly HeldCoreZoneView[];
  energy: EnergyZoneView;
  slammingCardIds: ReadonlySet<string>;
  pendingEnergyCardId?: string;
  onTapEnergyCard?: EnergyTapHandler;
  canTapEnergyCard?: (cardId: string) => boolean;
  revealEnergyFaces?: boolean;
  temporaryEnergyRevealCardIds?: ReadonlySet<string>;
  drawAvailable?: boolean;
  drawPending?: boolean;
  onDrawDeck?: () => void;
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
              slammingCardIds={slammingCardIds}
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
          revealFaces={revealEnergyFaces}
          temporaryRevealCardIds={temporaryEnergyRevealCardIds}
        />
        <div className={styles.cardStackMain}>
          <HeroZone
            owner={owner}
            cards={state.heroCards}
            count={counts.hero}
            slammingCardIds={slammingCardIds}
          />
          <ol className={styles.cardStackZones}>
            {cardStackZones.map((zone) => (
              <CardStackZone
                key={`${owner}-${zone.kind}`}
                owner={owner}
                {...zone}
                count={stackCount(counts, zone.kind)}
                latestDiscard={state.latestDiscard}
                discardOpen={openDiscardOwner === owner}
                drawAvailable={zone.kind === "deck" && owner === "player" && drawAvailable}
                drawPending={zone.kind === "deck" && owner === "player" && drawPending}
                onDrawDeck={zone.kind === "deck" && owner === "player" ? onDrawDeck : undefined}
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
              data-card-type={card.type}
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
  onDrawCard,
  onTapEnergyCard,
  match,
  playerId,
  presentationMode = "live",
  zoneCounts = EMPTY_ZONE_COUNTS,
}: {
  onExit?: () => void;
  onDrawCard?: DrawHandler;
  onTapEnergyCard?: EnergyTapHandler;
  match?: MatchState | null;
  playerId?: string;
  presentationMode?: "live" | "replay";
  zoneCounts?: GameScreenZoneCounts;
}) {
  const [pendingEnergyCardId, setPendingEnergyCardId] = useState("");
  const [energyError, setEnergyError] = useState("");
  const [drawPending, setDrawPending] = useState(false);
  const [drawError, setDrawError] = useState("");
  const [drawClock, setDrawClock] = useState(() => Date.now());
  const [energyRevealClock, setEnergyRevealClock] = useState(() => Date.now());
  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);
  const [slammingCardIds, setSlammingCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const previousBoardSnapshot = useRef<{
    matchId: string;
    viewerId: string;
    snapshot: ReturnType<typeof captureBoardCardFinalizeSnapshot>;
  } | null>(null);
  const boardSlamTimers = useRef<Map<string, number>>(new Map());
  const { hiddenCoreCells } = useBakuCorePresentation();

  const zoneState = match
    ? buildGameScreenZoneState(match, playerId)
    : EMPTY_GAME_SCREEN_ZONE_STATE;
  const heldCoreZones = buildHeldCoreZoneState(match, playerId, hiddenCoreCells);
  const energyState = energyZoneViews(match, playerId);
  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const temporaryEnergyFaceCardIds = new Set(
    energyState.player.cards
      .filter((card) => deckEnergyFaceVisible(card, energyRevealClock))
      .map((card) => card.id),
  );
  const turnStartState = match as TurnStartMatchState | null | undefined;
  const drawAvailable = Boolean(
    onDrawCard
    && !drawPending
    && playerCanDrawTurnCard(match, localPlayerId, drawClock),
  );
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

  useLayoutEffect(() => {
    const clearSlamPresentation = () => {
      for (const timeout of boardSlamTimers.current.values()) {
        window.clearTimeout(timeout);
      }
      boardSlamTimers.current.clear();
      setSlammingCardIds(new Set());
    };

    if (!match) {
      previousBoardSnapshot.current = null;
      clearSlamPresentation();
      return;
    }

    const viewerId = playerId ?? match.players[0]?.id ?? "";
    const previous = previousBoardSnapshot.current;
    const snapshot = captureBoardCardFinalizeSnapshot(zoneState);
    previousBoardSnapshot.current = { matchId: match.id, viewerId, snapshot };

    if (!previous || previous.matchId !== match.id || previous.viewerId !== viewerId) {
      clearSlamPresentation();
      return;
    }

    const transitions = boardCardFinalizeTransitions(previous.snapshot, zoneState);
    if (!transitions.length) return;
    const incomingIds = new Set(transitions.map((transition) => transition.cardId));

    setSlammingCardIds((current) => {
      const next = new Set(current);
      for (const cardId of incomingIds) next.add(cardId);
      return next;
    });

    for (const cardId of incomingIds) {
      const previousTimeout = boardSlamTimers.current.get(cardId);
      if (previousTimeout !== undefined) window.clearTimeout(previousTimeout);
      const timeout = window.setTimeout(() => {
        boardSlamTimers.current.delete(cardId);
        setSlammingCardIds((current) => {
          if (!current.has(cardId)) return current;
          const next = new Set(current);
          next.delete(cardId);
          return next;
        });
      }, BOARD_CARD_SLAM_MS);
      boardSlamTimers.current.set(cardId, timeout);
    }
  }, [match, playerId, zoneState]);

  useEffect(() => () => {
    for (const timeout of boardSlamTimers.current.values()) {
      window.clearTimeout(timeout);
    }
    boardSlamTimers.current.clear();
  }, []);

  useLayoutEffect(() => {
    setEnergyRevealClock(Date.now());
  }, [match?.id, match?.version]);

  const nextEnergyRevealExpiry = nextDeckEnergyFaceRevealExpiry(
    energyState.player.cards,
    energyRevealClock,
  );
  useEffect(() => {
    if (nextEnergyRevealExpiry == null) return;
    const delay = Math.max(0, nextEnergyRevealExpiry - Date.now());
    const timeout = window.setTimeout(() => setEnergyRevealClock(Date.now()), delay + 20);
    return () => window.clearTimeout(timeout);
  }, [nextEnergyRevealExpiry]);

  useEffect(() => {
    setDrawClock(Date.now());
    const readyAt = turnStartState?.drawReadyAt;
    if (!readyAt) return;
    const delay = readyAt - Date.now();
    if (delay <= 0) return;
    const timeout = window.setTimeout(() => setDrawClock(Date.now()), delay + 20);
    return () => window.clearTimeout(timeout);
  }, [match?.id, match?.version, turnStartState?.drawReadyAt]);

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

  const drawFromDeck = async () => {
    if (!onDrawCard || drawPending || !playerCanDrawTurnCard(match, localPlayerId, Date.now())) return;
    setDrawPending(true);
    setDrawError("");
    try {
      await onDrawCard();
    } catch (error) {
      setDrawError(error instanceof Error ? error.message : "The card could not be drawn.");
    } finally {
      setDrawPending(false);
    }
  };

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
      <div
        className={`${styles.screen} ${presentationMode === "replay" ? styles.replayScreen : ""}`}
        data-presentation-mode={presentationMode}
      >
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
            slammingCardIds={slammingCardIds}
            revealEnergyFaces={revealOpponentAiCards}
            openDiscardOwner={openDiscardOwner}
            onOpenDiscard={openDiscard}
          />
          <PlayerZoneLayout
            owner="player"
            counts={resolvedCounts.player}
            state={zoneState.player}
            coreZones={heldCoreZones.player}
            energy={energyState.player}
            slammingCardIds={slammingCardIds}
            pendingEnergyCardId={pendingEnergyCardId}
            onTapEnergyCard={tapEnergy}
            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}
            temporaryEnergyRevealCardIds={temporaryEnergyFaceCardIds}
            drawAvailable={drawAvailable}
            drawPending={drawPending}
            onDrawDeck={() => void drawFromDeck()}
            openDiscardOwner={openDiscardOwner}
            onOpenDiscard={openDiscard}
          />
        </div>
        {energyError && <div className={styles.energyError} role="alert">{energyError}</div>}
        {drawError && <div className={styles.energyError} role="alert">{drawError}</div>}
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
