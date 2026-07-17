"use client";

import type { CSSProperties } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import {
  handCardLayout,
  opponentHandCardCount,
  playerHandCards,
} from "./cardHandState";
import styles from "./CardHandLayer.module.css";

const CARD_BACK_ART = "/assets/card-back.png";

type HandOwner = "player" | "opponent";

function cardStyle(rotationDegrees: number, zIndex: number, owner: HandOwner) {
  return {
    // The opponent fan is mirrored around the top pivot so its visual order
    // still runs left-to-right while the card backs face the opponent.
    "--hand-rotation": `${owner === "opponent" ? -rotationDegrees : rotationDegrees}deg`,
    zIndex,
  } as CSSProperties;
}

function PlayerHand({ cards }: { cards: readonly GameCard[] }) {
  if (!cards.length) return null;
  const layout = handCardLayout(cards.length);

  return (
    <section
      className={`${styles.handLayer} ${styles.playerHandLayer}`}
      aria-label={`Your hand, ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="player"
      data-card-count={cards.length}
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

function OpponentHand({ cardCount }: { cardCount: number }) {
  if (!cardCount) return null;
  const layout = handCardLayout(cardCount);

  return (
    <section
      className={`${styles.handLayer} ${styles.opponentHandLayer}`}
      aria-label={`Opponent hand, ${cardCount} hidden card${cardCount === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="opponent"
      data-card-count={cardCount}
      data-hidden="true"
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
  if (!cards.length && !opponentCardCount) return null;

  return (
    <>
      <OpponentHand cardCount={opponentCardCount} />
      <PlayerHand cards={cards} />
    </>
  );
}
