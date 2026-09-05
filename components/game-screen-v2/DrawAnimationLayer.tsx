"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { GameCard, MatchState } from "../../lib/game";
import { CardArt } from "../cards/CardArt";
import { prepareAnimationAssets } from "./animationStability";
import { drawTransitions } from "./drawAnimationState";
import styles from "./DrawAnimationLayer.module.css";
import { useMatchSelector } from "./matchStore";
import { isLiveMatchTransition } from "./presentationContinuity";

const CARD_BACK_ART = "/assets/card-back.png";
const DRAW_ANIMATION_MS = 760;

type HandOwner = "player" | "opponent";
type FlightPhase = "prepared" | "running" | "settling";

type StoredDrawState = {
  active: boolean;
  match: MatchState | null;
  playerId?: string;
};

type DrawAnimationLayerProps = {
  match?: MatchState | null;
  playerId?: string;
  presentationMode?: "live" | "replay";
  playbackRate?: number;
  portalRoot?: HTMLElement | null;
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
  phase: FlightPhase;
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

export function DrawAnimationLayer({
  match: replayMatch,
  playerId: replayPlayerId,
  presentationMode = "live",
  playbackRate = 1,
  portalRoot,
}: DrawAnimationLayerProps = {}) {
  const liveStored = useMatchSelector((state): StoredDrawState => ({
    active: state.route === "match",
    match: state.match,
    playerId: state.playerId,
  }));
  const stored: StoredDrawState = presentationMode === "replay"
    ? { active: true, match: replayMatch ?? null, playerId: replayPlayerId }
    : liveStored;
  const rate = presentationMode === "replay"
    ? Math.max(0.25, Math.min(4, playbackRate || 1))
    : 1;
  const [flights, setFlights] = useState<DrawFlight[]>([]);
  const previousMatch = useRef<MatchState | null>(null);
  const flightTargets = useRef(new Map<string, HTMLElement>());
  const hiddenTargetCounts = useRef(new Map<HTMLElement, number>());
  const mounted = useRef(false);

  useEffect(() => {
    const hiddenTargets = hiddenTargetCounts.current;
    const targets = flightTargets.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const target of hiddenTargets.keys()) {
        delete target.dataset.drawAnimationTarget;
      }
      hiddenTargets.clear();
      targets.clear();
    };
  }, []);

  const hideTarget = (id: string, target: HTMLElement) => {
    const count = hiddenTargetCounts.current.get(target) ?? 0;
    hiddenTargetCounts.current.set(target, count + 1);
    flightTargets.current.set(id, target);
    target.dataset.drawAnimationTarget = "true";
  };

  const revealTarget = (id: string) => {
    const target = flightTargets.current.get(id);
    if (target) {
      const count = Math.max(0, (hiddenTargetCounts.current.get(target) ?? 1) - 1);
      if (count) hiddenTargetCounts.current.set(target, count);
      else {
        hiddenTargetCounts.current.delete(target);
        delete target.dataset.drawAnimationTarget;
      }
    }
    flightTargets.current.delete(id);
  };

  const finishFlight = (id: string) => {
    revealTarget(id);
    if (!mounted.current) return;
    setFlights((current) => current.map((flight) => (
      flight.id === id ? { ...flight, phase: "settling" } : flight
    )));
    window.requestAnimationFrame(() => {
      if (mounted.current) {
        setFlights((current) => current.filter((flight) => flight.id !== id));
      }
    });
  };

  useLayoutEffect(() => {
    const match = stored.match;
    if (!stored.active) {
      previousMatch.current = null;
      return;
    }

    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!isLiveMatchTransition(previous, match, document.visibilityState)) return;

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
        pending.push({
          id: `${match.id}:${match.version}:${transition.playerId}:${index}`,
          owner,
          card: owner === "player" ? card : null,
          source: deckZone,
          target,
          delay: index * 90 / rate,
        });
      }
    }

    if (!pending.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    let cancelled = false;
    let measureFrame = 0;
    let startFrame = 0;

    void prepareAnimationAssets([
      CARD_BACK_ART,
      ...pending.map((item) => item.card?.art),
    ]).then(() => {
      if (cancelled || !mounted.current) return;
      measureFrame = window.requestAnimationFrame(() => {
        if (cancelled || !mounted.current) return;
        const measured: Array<{ flight: DrawFlight; target: HTMLElement }> = [];
        for (const item of pending) {
          const start = cardRect(item.source);
          const end = cardRect(item.target);
          if (!start || !end) continue;
          measured.push({
            target: item.target,
            flight: {
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
              phase: "prepared",
            },
          });
        }
        if (!measured.length) return;
        setFlights((current) => [...current, ...measured.map((item) => item.flight)]);
        startFrame = window.requestAnimationFrame(() => {
          if (cancelled || !mounted.current) return;
          for (const item of measured) hideTarget(item.flight.id, item.target);
          const ids = new Set(measured.map((item) => item.flight.id));
          setFlights((current) => current.map((flight) => (
            ids.has(flight.id) ? { ...flight, phase: "running" } : flight
          )));
        });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(measureFrame);
      window.cancelAnimationFrame(startFrame);
    };
  }, [rate, stored.active, stored.match, stored.playerId]);

  const resolvedPortalRoot = portalRoot ?? (typeof document === "undefined" ? null : document.body);
  if (!stored.active || !flights.length || !resolvedPortalRoot) return null;

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
          "--draw-duration": `${DRAW_ANIMATION_MS / rate}ms`,
        } as CSSProperties;
        return (
          <div
            className={styles.flight}
            data-owner={flight.owner}
            data-reveal={flight.card ? "true" : "false"}
            data-state={flight.phase}
            style={style}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && flight.phase === "running") {
                finishFlight(flight.id);
              }
            }}
            key={flight.id}
          >
            <div className={styles.cardInner}>
              <OriginalImage className={styles.cardBack} src={CARD_BACK_ART} alt="" draggable={false} />
              {flight.card ? (
                <CardArt className={styles.cardFace} src={flight.card.art} cardType={flight.card.type} alt="" draggable={false} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>,
    resolvedPortalRoot,
  );
}
