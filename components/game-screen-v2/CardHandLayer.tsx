"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import {
  boundedHandFanGeometry,
  handCardLayout,
  handViewportEdgeOffset,
  opponentHandCardCount,
  playerHandCards,
  type HandFanGeometry,
} from "./cardHandState";
import {
  handCardIsActionable,
  resolvedHandActionMode,
  type HandActionMode,
} from "./matchHudState";
import styles from "./CardHandLayer.module.css";
import { LikelyCardImagePreloader, ResponsiveCardImage } from "./ResponsiveCardImage";
import { useAdministratorAiVisibility } from "../application/useAdministratorAiVisibility";

const CARD_BACK_ART = "/assets/card-back.png";
const MIN_ZONE_GAP = 16;
const MAX_ZONE_GAP = 24;

type HandOwner = "player" | "opponent";

type HandViewportBounds = {
  centerX: number;
  safeWidth: number;
  edgeOffset: number;
  geometry: HandFanGeometry;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.25;
}

function sameBounds(
  previous: HandViewportBounds | null,
  next: HandViewportBounds,
) {
  if (!previous) return false;
  return approximatelyEqual(previous.centerX, next.centerX)
    && approximatelyEqual(previous.safeWidth, next.safeWidth)
    && approximatelyEqual(previous.edgeOffset, next.edgeOffset)
    && approximatelyEqual(previous.geometry.cardWidth, next.geometry.cardWidth)
    && approximatelyEqual(previous.geometry.fanRadius, next.geometry.fanRadius)
    && approximatelyEqual(previous.geometry.spanDegrees, next.geometry.spanDegrees);
}

function useHandViewportBounds(owner: HandOwner, cardCount: number) {
  const [bounds, setBounds] = useState<HandViewportBounds | null>(null);

  useEffect(() => {
    let frame = 0;
    let observer: ResizeObserver | null = null;

    const measure = () => {
      const playArea = document.querySelector<HTMLElement>(
        '[data-gameplay-surface="true"]',
      );
      if (!playArea) return;

      const playRect = playArea.getBoundingClientRect();
      const compact = window.innerWidth <= 760;
      const portrait = compact
        && window.matchMedia("(orientation: portrait)").matches;
      const characterArea = playArea.querySelector<HTMLElement>(
        `[data-zone-owner="${owner}"][data-zone-group="character-cards"]`,
      );
      const stackArea = playArea.querySelector<HTMLElement>(
        `[data-zone-owner="${owner}"][data-zone-group="play-area-cards"]`,
      );
      const obstacleRects = [characterArea, stackArea]
        .filter((element): element is HTMLElement => Boolean(element))
        .map((element) => element.getBoundingClientRect())
        .sort((left, right) => left.left - right.left);

      const zoneGap = clamp(playRect.width * 0.012, MIN_ZONE_GAP, MAX_ZONE_GAP);
      let safeLeft = playRect.left + zoneGap;
      let safeRight = playRect.right - zoneGap;

      // Portrait card zones occupy separate vertical bands, so they do not
      // reduce the Hand's horizontal lane. Landscape keeps the zone corridor.
      if (!portrait && obstacleRects.length === 2) {
        safeLeft = Math.max(safeLeft, obstacleRects[0].right + zoneGap);
        safeRight = Math.min(safeRight, obstacleRects[1].left - zoneGap);
      } else if (!portrait) {
        // The zones normally exist before this layer measures. This fallback
        // preserves their known mirrored footprints during the first frame.
        safeLeft = Math.max(safeLeft, playRect.left + playRect.width * 0.29);
        safeRight = Math.min(safeRight, playRect.right - playRect.width * 0.21);
      }

      if (safeRight <= safeLeft) {
        const fallbackHalfWidth = Math.max(1, playRect.width * 0.2);
        const playCenter = playRect.left + playRect.width / 2;
        safeLeft = playCenter - fallbackHalfWidth;
        safeRight = playCenter + fallbackHalfWidth;
      }

      const safeWidth = Math.max(1, safeRight - safeLeft);
      const portraitHandScale = portrait ? 1.2 : 1;
      const portraitFanScale = portrait ? 1.4 : 1;
      const geometrySafeWidth = portrait
        ? Math.max(1, Math.min(playRect.width - zoneGap * 2, safeWidth * portraitFanScale))
        : safeWidth;
      // Rule 1: card dimensions are stable for a given viewport. The geometry
      // solver is allowed to compress only the angular spacing between cards.
      const baseCardWidth = compact
        ? clamp(window.innerWidth * 0.12, 54.4, 80)
        : clamp(window.innerWidth * 0.072, 75.2, 116);
      const fixedCardWidth = baseCardWidth * portraitHandScale;
      const geometry = boundedHandFanGeometry({
        cardCount,
        safeWidth: geometrySafeWidth,
        desiredCardWidth: fixedCardWidth,
        radiusRatio: compact ? 5.4 : 8.35,
        renderedWidthScale: portraitFanScale,
      });
      const nextBounds: HandViewportBounds = {
        centerX: (safeLeft + safeRight) / 2,
        safeWidth: geometrySafeWidth,
        edgeOffset: handViewportEdgeOffset(
          window.innerHeight,
          playRect.top,
          playRect.bottom,
          owner,
        ),
        geometry,
      };

      setBounds((previous) => sameBounds(previous, nextBounds) ? previous : nextBounds);
    };

    const attach = () => {
      measure();
      if (typeof ResizeObserver === "undefined") return;

      const playArea = document.querySelector<HTMLElement>(
        '[data-gameplay-surface="true"]',
      );
      observer = new ResizeObserver(measure);
      const elements = [
        playArea,
        playArea?.querySelector<HTMLElement>(
          `[data-zone-owner="${owner}"][data-zone-group="character-cards"]`,
        ),
        playArea?.querySelector<HTMLElement>(
          `[data-zone-owner="${owner}"][data-zone-group="play-area-cards"]`,
        ),
      ];
      for (const element of elements) {
        if (element) observer.observe(element);
      }
    };

    frame = window.requestAnimationFrame(attach);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [cardCount, owner]);

  return bounds;
}

function cardStyle(rotationDegrees: number, zIndex: number, owner: HandOwner) {
  // The opponent fan is mirrored around the top pivot so its visual order
  // still runs left-to-right while the card backs face the opponent.
  const displayedRotation = owner === "opponent" ? -rotationDegrees : rotationDegrees;
  return {
    "--hand-rotation": `${displayedRotation}deg`,
    // The player hover treatment applies this opposite rotation inside the
    // already-positioned card, leaving the card in its fan slot while making
    // the face perfectly upright.
    "--hand-counter-rotation": `${-displayedRotation}deg`,
    zIndex,
  } as CSSProperties;
}

function handLayerStyle(bounds: HandViewportBounds | null) {
  if (!bounds) return undefined;
  return {
    left: bounds.centerX,
    width: bounds.safeWidth,
    "--hand-card-width": `${bounds.geometry.cardWidth}px`,
    "--hand-fan-radius": `${bounds.geometry.fanRadius}px`,
    "--hand-anchor-offset": `${bounds.edgeOffset}px`,
  } as CSSProperties;
}

function PlayerHand({
  cards,
  bounds,
  match,
  playerId,
  actionMode,
  selectedCardId,
  selectedDiscardCardIds,
  onCardSelect,
  onDiscardCardSelect,
}: {
  cards: readonly GameCard[];
  bounds: HandViewportBounds | null;
  match: MatchState | null;
  playerId?: string;
  actionMode: HandActionMode;
  selectedCardId: string;
  selectedDiscardCardIds: readonly string[];
  onCardSelect?: (cardId: string) => void;
  onDiscardCardSelect?: (cardId: string) => void;
}) {
  if (!cards.length) return null;
  const layout = handCardLayout(cards.length, bounds?.geometry.spanDegrees);

  const selectWithKeyboard = (
    event: KeyboardEvent<HTMLLIElement>,
    cardId: string,
    actionable: boolean,
  ) => {
    const select = actionMode === "discard" ? onDiscardCardSelect : onCardSelect;
    if (!actionable || !select || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    select(cardId);
  };

  return (
    <section
      className={`${styles.handLayer} ${styles.playerHandLayer}`}
      style={handLayerStyle(bounds)}
      aria-label={`Your hand, ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="player"
      data-card-count={cards.length}
      data-action-mode={actionMode ?? undefined}
      data-safe-width={bounds ? Math.round(bounds.safeWidth) : undefined}
      data-rendered-width={bounds ? Math.round(bounds.geometry.renderedWidth) : undefined}
    >
      <ol className={styles.handCards}>
        {cards.map((card, index) => {
          const position = layout[index];
          const actionable = handCardIsActionable(match, playerId, card, actionMode);
          const selected = actionable && (actionMode === "discard"
            ? selectedDiscardCardIds.includes(card.id)
            : card.id === selectedCardId);
          return (
            <li
              className={`${styles.handCard} ${actionable ? styles.actionableHandCard : ""} ${selected ? styles.selectedHandCard : ""}`}
              data-card-id={card.id}
              data-actionable={actionable ? "true" : "false"}
              data-selected={selected ? "true" : "false"}
              style={cardStyle(position.rotationDegrees, position.zIndex, "player")}
              key={card.id}
              title={card.displayName || card.name}
              role={actionable ? "button" : undefined}
              tabIndex={actionable ? 0 : undefined}
              aria-pressed={actionable ? selected : undefined}
              aria-label={actionable
                ? `${card.displayName || card.name}, choose for ${actionMode === "discard" ? "Discard" : actionMode === "energize" ? "Energize" : "Play Card"}`
                : undefined}
              onClick={() => actionable && (actionMode === "discard"
                ? onDiscardCardSelect?.(card.id)
                : onCardSelect?.(card.id))}
              onKeyDown={(event) => selectWithKeyboard(event, card.id, actionable)}
            >
              <div className={styles.handCardSurface}>
                <ResponsiveCardImage
                  className={styles.handCardImage}
                  src={card.art}
                  alt={card.displayName || card.name}
                  eager
                  draggable={false}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OpponentHand({
  cards,
  cardCount,
  bounds,
  revealFaces,
}: {
  cards: readonly GameCard[];
  cardCount: number;
  bounds: HandViewportBounds | null;
  revealFaces: boolean;
}) {
  if (!cardCount) return null;
  const layout = handCardLayout(cardCount, bounds?.geometry.spanDegrees);

  return (
    <section
      className={`${styles.handLayer} ${styles.opponentHandLayer}`}
      style={handLayerStyle(bounds)}
      aria-label={revealFaces
        ? `Training AI hand, ${cardCount} revealed card${cardCount === 1 ? "" : "s"}`
        : `Opponent hand, ${cardCount} hidden card${cardCount === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="opponent"
      data-card-count={cardCount}
      data-hidden={revealFaces ? "false" : "true"}
      data-safe-width={bounds ? Math.round(bounds.safeWidth) : undefined}
      data-rendered-width={bounds ? Math.round(bounds.geometry.renderedWidth) : undefined}
    >
      <ol className={styles.handCards}>
        {layout.map((position, index) => {
          const card = cards[index];
          const faceUp = revealFaces && Boolean(card);
          return (
            <li
              className={styles.handCard}
              style={cardStyle(position.rotationDegrees, position.zIndex, "opponent")}
              data-card-id={faceUp ? card?.id : undefined}
              title={faceUp ? card?.displayName || card?.name : undefined}
              key={faceUp ? card!.id : `opponent-hidden-card-${index}`}
            >
              <div className={styles.handCardSurface}>
                <ResponsiveCardImage
                  className={`${styles.handCardImage} ${faceUp ? "" : styles.opponentCardBack}`}
                  src={faceUp ? card!.art : CARD_BACK_ART}
                  alt={faceUp ? card!.displayName || card!.name : ""}
                  ariaHidden={!faceUp}
                  draggable={false}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function CardHandLayer({
  match,
  playerId,
  actionMode = null,
  selectedCardId = "",
  selectedDiscardCardIds = [],
  onCardSelect,
  onDiscardCardSelect,
}: {
  match: MatchState | null;
  playerId?: string;
  actionMode?: HandActionMode;
  selectedCardId?: string;
  selectedDiscardCardIds?: readonly string[];
  onCardSelect?: (cardId: string) => void;
  onDiscardCardSelect?: (cardId: string) => void;
}) {
  const cards = playerHandCards(match, playerId);
  const opponentCardCount = opponentHandCardCount(match, playerId);
  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);
  const opponentCards = revealOpponentAiCards
    ? match?.players.find((candidate) => candidate.id !== playerId)?.hand ?? []
    : [];
  const playerBounds = useHandViewportBounds("player", cards.length);
  const opponentBounds = useHandViewportBounds("opponent", opponentCardCount);
  const effectiveActionMode = resolvedHandActionMode(match, playerId, actionMode);
  if (!cards.length && !opponentCardCount) return null;

  return (
    <>
      <LikelyCardImagePreloader sources={cards.filter((card) => handCardIsActionable(match, playerId, card, effectiveActionMode)).map((card) => card.art)} />
      <OpponentHand
        cards={opponentCards}
        cardCount={opponentCardCount}
        bounds={opponentBounds}
        revealFaces={revealOpponentAiCards}
      />
      <PlayerHand
        cards={cards}
        bounds={playerBounds}
        match={match}
        playerId={playerId}
        actionMode={effectiveActionMode}
        selectedCardId={selectedCardId}
        selectedDiscardCardIds={selectedDiscardCardIds}
        onCardSelect={onCardSelect}
        onDiscardCardSelect={onDiscardCardSelect}
      />
    </>
  );
}

