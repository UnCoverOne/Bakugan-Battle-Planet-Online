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
import { discardFlipTransitions } from "./discardFlipAnimationState";
import { useMatchSelector } from "./matchStore";
import styles from "./DiscardFlipAnimationLayer.module.css";

const CARD_BACK_ART = "/assets/card-back.png";
const DISCARD_FLIP_MS = 880;

type ZoneOwner = "player" | "opponent";

type StoredDiscardFlipState = {
  active: boolean;
  match: MatchState | null;
  playerId?: string;
};

type DiscardFlight = {
  id: string;
  owner: ZoneOwner;
  card: GameCard;
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
  owner: ZoneOwner;
  card: GameCard;
  source: HTMLElement;
  target: HTMLElement;
  delay: number;
};

function stackCardRect(zone: HTMLElement) {
  const rect = zone.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const insetX = rect.width * 0.05;
  const insetY = rect.height * 0.05;
  return {
    left: rect.left + insetX,
    top: rect.top + insetY,
    width: rect.width - insetX * 2,
    height: rect.height - insetY * 2,
  };
}

export function DiscardFlipAnimationLayer() {
  const stored = useMatchSelector((state): StoredDiscardFlipState => ({
    active: state.route === "match",
    match: state.match,
    playerId: state.playerId,
  }));
  const [flights, setFlights] = useState<DiscardFlight[]>([]);
  const previousMatch = useRef<MatchState | null>(null);
  const flightTargets = useRef(new Map<string, HTMLElement>());
  const hiddenTargetCounts = useRef(new Map<HTMLElement, number>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const target of hiddenTargetCounts.current.keys()) {
        delete target.dataset.discardAnimationTarget;
      }
      hiddenTargetCounts.current.clear();
      flightTargets.current.clear();
    };
  }, []);

  const hideTarget = (id: string, target: HTMLElement) => {
    const count = hiddenTargetCounts.current.get(target) ?? 0;
    hiddenTargetCounts.current.set(target, count + 1);
    flightTargets.current.set(id, target);
    target.dataset.discardAnimationTarget = "true";
  };

  const finishFlight = (id: string) => {
    const target = flightTargets.current.get(id);
    if (target) {
      const count = Math.max(0, (hiddenTargetCounts.current.get(target) ?? 1) - 1);
      if (count) hiddenTargetCounts.current.set(target, count);
      else {
        hiddenTargetCounts.current.delete(target);
        delete target.dataset.discardAnimationTarget;
      }
    }
    flightTargets.current.delete(id);
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

    const transitions = discardFlipTransitions(previous, match);
    if (!transitions.length) return;

    const localPlayerId = stored.playerId ?? match.players[0]?.id;
    const pending: PendingFlight[] = [];

    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const deckZone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-deck"]`);
      const discardZone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-discard-pile"]`);
      if (!deckZone || !discardZone) continue;

      transition.cards.forEach((card, index) => {
        const id = `${match.id}:${match.version}:${transition.playerId}:discard:${card.id}:${index}`;
        hideTarget(id, discardZone);
        pending.push({
          id,
          owner,
          card,
          source: deckZone,
          target: discardZone,
          delay: index * 105,
        });
      });
    }

    if (!pending.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));

    let measured = false;
    const frame = window.requestAnimationFrame(() => {
      measured = true;
      if (!mounted.current) return;
      const nextFlights: DiscardFlight[] = [];

      for (const item of pending) {
        const start = stackCardRect(item.source);
        const end = stackCardRect(item.target);
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
          "--discard-delta-x": `${flight.deltaX}px`,
          "--discard-delta-y": `${flight.deltaY}px`,
          "--discard-scale-x": flight.scaleX,
          "--discard-scale-y": flight.scaleY,
          "--discard-delay": `${flight.delay}ms`,
          "--discard-duration": `${DISCARD_FLIP_MS}ms`,
        } as CSSProperties;
        return (
          <div
            className={styles.flight}
            data-owner={flight.owner}
            data-card-type={flight.card.type}
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
              <div className={styles.cardFace}>
                <img
                  src={flight.card.art}
                  alt=""
                  draggable={false}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
