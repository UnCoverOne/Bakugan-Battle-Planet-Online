"use client";

import type { CSSProperties } from "react";
import type { MatchState } from "../../lib/game";
import { handCardLayout, playerHandCards } from "./cardHandState";
import styles from "./CardHandLayer.module.css";

export function CardHandLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const cards = playerHandCards(match, playerId);
  const layout = handCardLayout(cards.length);
  if (!cards.length) return null;

  return (
    <section
      className={styles.handLayer}
      aria-label={`Your hand, ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="player"
    >
      <ol className={styles.handCards}>
        {cards.map((card, index) => {
          const position = layout[index];
          const style = {
            "--hand-left": `${position.leftPercent}%`,
            "--hand-rotation": `${position.rotationDegrees}deg`,
            "--hand-drop": `${position.dropPixels}px`,
            zIndex: position.zIndex,
          } as CSSProperties;

          return (
            <li
              className={styles.handCard}
              data-card-id={card.id}
              style={style}
              key={card.id}
              title={card.displayName || card.name}
            >
              <img
                className={styles.handCardImage}
                src={card.art}
                alt={card.displayName || card.name}
                draggable={false}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
