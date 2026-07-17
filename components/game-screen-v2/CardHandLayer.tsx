"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import {
  boundedHandFanGeometry,
  handCardLayout,
  handViewportEdgeOffset,
  opponentHandCardCount,
  playerHandCards,
  type HandFanGeometry,
} from "./cardHandState";
import styles from "./CardHandLayer.module.css";

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
        '[aria-label="Experimental game play area"]',
      );
      if (!playArea) return;

      const playRect = playArea.getBoundingClientRect();
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

      if (obstacleRects.length === 2) {
        safeLeft = Math.max(safeLeft, obstacleRects[0].right + zoneGap);
        safeRight = Math.min(safeRight, obstacleRects[1].left - zoneGap);
      } else {
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
      const compact = window.innerWidth <= 760;
      // Rule 1: card dimensions are stable for a given viewport. The geometry
      // solver is allowed to compress only the angular spacing between cards.
      const fixedCardWidth = compact
        ? clamp(window.innerWidth * 0.12, 54.4, 80)
        : clamp(window.innerWidth * 0.072, 75.2, 116);
      const geometry = boundedHandFanGeometry({
        cardCount,
        safeWidth,
        desiredCardWidth: fixedCardWidth,
        radiusRatio: compact ? 5.4 : 8.35,
      });
      const nextBounds: HandViewportBounds = {
        centerX: (safeLeft + safeRight) / 2,
        safeWidth,
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
        '[aria-label="Experimental game play area"]',
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
}: {
  cards: readonly GameCard[];
  bounds: HandViewportBounds | null;
}) {
  if (!cards.length) return null;
  const layout = handCardLayout(cards.length, bounds?.geometry.spanDegrees);

  return (
    <section
      className={`${styles.handLayer} ${styles.playerHandLayer}`}
      style={handLayerStyle(bounds)}
      aria-label={`Your hand, ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="player"
      data-card-count={cards.length}
      data-safe-width={bounds ? Math.round(bounds.safeWidth) : undefined}
      data-rendered-width={bounds ? Math.round(bounds.geometry.renderedWidth) : undefined}
    >
      <ol className={styles.handCards}>
        {cards.map((card, index) => {
          const position = layout[index];
          return (
            <li
              className={styles.handCard}
              data-card-id={card.id}
              style={cardStyle(position.rotationDegrees, position.zIndex, "player")}
              key={card.id}
              title={card.displayName || card.name}
            >
              <div className={styles.handCardSurface}>
                <img
                  className={styles.handCardImage}
                  src={card.art}
                  alt={card.displayName || card.name}
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
  cardCount,
  bounds,
}: {
  cardCount: number;
  bounds: HandViewportBounds | null;
}) {
  if (!cardCount) return null;
  const layout = handCardLayout(cardCount, bounds?.geometry.spanDegrees);

  return (
    <section
      className={`${styles.handLayer} ${styles.opponentHandLayer}`}
      style={handLayerStyle(bounds)}
      aria-label={`Opponent hand, ${cardCount} hidden card${cardCount === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="opponent"
      data-card-count={cardCount}
      data-hidden="true"
      data-safe-width={bounds ? Math.round(bounds.safeWidth) : undefined}
      data-rendered-width={bounds ? Math.round(bounds.geometry.renderedWidth) : undefined}
    >
      <ol className={styles.handCards}>
        {layout.map((position, index) => (
          <li
            className={styles.handCard}
            style={cardStyle(position.rotationDegrees, position.zIndex, "opponent")}
            key={`opponent-hidden-card-${index}`}
          >
            <div className={styles.handCardSurface}>
              <img
                className={`${styles.handCardImage} ${styles.opponentCardBack}`}
                src={CARD_BACK_ART}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CardHandLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const cards = playerHandCards(match, playerId);
  const opponentCardCount = opponentHandCardCount(match, playerId);
  const playerBounds = useHandViewportBounds("player", cards.length);
  const opponentBounds = useHandViewportBounds("opponent", opponentCardCount);
  if (!cards.length && !opponentCardCount) return null;

  return (
    <>
      <OpponentHand cardCount={opponentCardCount} bounds={opponentBounds} />
      <PlayerHand cards={cards} bounds={playerBounds} />
    </>
  );
}
