"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { GameCard, MatchState } from "../../lib/game";
import { drawTransitions } from "./drawAnimationState";
import styles from "./DrawAnimationLayer.module.css";
import { useMatchSelector } from "./matchStore";

const CARD_BACK_ART = "/assets/card-back.png";
const DRAW_ANIMATION_MS = 760;

type HandOwner = "player" | "opponent";

type StoredDrawState = {
  active: boolean;
  match: MatchState | null;
  playerId?: string;
};

type DrawFlight = {
  id: string;
  owner: HandOwner;
  card: GameCard | null;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
  delay: number;
};

type PendingFlight = {
  id: string;
  owner: HandOwner;
  card: GameCard | null;
  source: HTMLElement;
  target: HTMLElement;
  delay: number;
};

function handCardById(hand: HTMLElement, cardId: string) {
  return [...hand.querySelectorAll<HTMLElement>("[data-card-id]")]
    .find((element) => element.dataset.cardId === cardId) ?? null;
}

function cardRect(element: HTMLElement) {
  const image = element.querySelector<HTMLElement>("img:last-of-type");
  const rect = (image ?? element).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function DrawAnimationLayer() {
  const stored = useMatchSelector((state): StoredDrawState => ({
    active: state.route === "match",
    match: state.match,
    playerId: state.playerId,
  }));
  const [flights, setFlights] = useState<DrawFlight[]>([]);
  const previousMatch = useRef<MatchState | null>(null);
  const hiddenTargets = useRef(new Map<string, HTMLElement>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const target of hiddenTargets.current.values()) {
        delete target.dataset.drawAnimationTarget;
      }
      hiddenTargets.current.clear();
    };
  }, []);

  const finishFlight = (id: string) => {
    const target = hiddenTargets.current.get(id);
    if (target) delete target.dataset.drawAnimationTarget;
    hiddenTargets.current.delete(id);
    if (mounted.current) {
      setFlights((current) => current.filter((flight) => flight.id !== id));
    }
  };

  useLayoutEffect(() => {
    const match = stored.match;
    if (!stored.active) {
      previousMatch.current = null;
      return;
    }

    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!previous || !match || previous.id !== match.id) return;

    const transitions = drawTransitions(previous, match);
    if (!transitions.length) return;

    const localPlayerId = stored.playerId ?? match.players[0]?.id;
    const pending: PendingFlight[] = [];

    for (const transition of transitions) {
      const owner: HandOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const deckZone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-deck"]`);
      const handZone = document.querySelector<HTMLElement>(
        `[data-zone-kind="hand"][data-zone-owner="${owner}"]`,
      );
      if (!deckZone || !handZone) continue;

      const handCards = [...handZone.querySelectorAll<HTMLElement>("li")];
      for (let index = 0; index < transition.count; index += 1) {
        const card = transition.cards[index] ?? null;
        const target = owner === "player" && card
          ? handCardById(handZone, card.id)
          : handCards[handCards.length - transition.count + index] ?? handZone;
        if (!target) continue;

        const id = `${match.id}:${match.version}:${transition.playerId}:${index}`;
        target.dataset.drawAnimationTarget = "true";
        hiddenTargets.current.set(id, target);
        pending.push({
          id,
          owner,
          card: owner === "player" ? card : null,
          source: deckZone,
          target,
          delay: index * 90,
        });
      }
    }

    if (!pending.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));

    let measured = false;
    const frame = window.requestAnimationFrame(() => {
      measured = true;
      if (!mounted.current) return;
      const nextFlights: DrawFlight[] = [];

      for (const item of pending) {
        const start = cardRect(item.source);
        const end = cardRect(item.target);
        if (!start || !end) {
          finishFlight(item.id);
          continue;
        }

        nextFlights.push({
          id: item.id,
          owner: item.owner,
          card: item.card,
          left: start.left,
          top: start.top,
          width: start.width,
          height: start.height,
          deltaX: end.left - start.left,
          deltaY: end.top - start.top,
          scaleX: end.width / start.width,
          scaleY: end.height / start.height,
          delay: item.delay,
        });
      }

      if (nextFlights.length) {
        setFlights((current) => [...current, ...nextFlights]);
      }
    });

    return () => {
      if (measured) return;
      window.cancelAnimationFrame(frame);
      for (const item of pending) finishFlight(item.id);
    };
  }, [stored.active, stored.match?.id, stored.match?.version, stored.playerId]);

  if (!stored.active || !flights.length || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.layer} aria-hidden="true">
      {flights.map((flight) => {
        const style = {
          left: flight.left,
          top: flight.top,
          width: flight.width,
          height: flight.height,
          "--draw-delta-x": `${flight.deltaX}px`,
          "--draw-delta-y": `${flight.deltaY}px`,
          "--draw-scale-x": flight.scaleX,
          "--draw-scale-y": flight.scaleY,
          "--draw-delay": `${flight.delay}ms`,
          "--draw-duration": `${DRAW_ANIMATION_MS}ms`,
        } as CSSProperties;
        return (
          <div
            className={styles.flight}
            data-owner={flight.owner}
            data-reveal={flight.card ? "true" : "false"}
            style={style}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) finishFlight(flight.id);
            }}
            key={flight.id}
          >
            <div className={styles.cardInner}>
              <img
                className={styles.cardBack}
                src={CARD_BACK_ART}
                alt=""
                draggable={false}
              />
              {flight.card ? (
                <img
                  className={styles.cardFace}
                  src={flight.card.art}
                  alt=""
                  draggable={false}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
