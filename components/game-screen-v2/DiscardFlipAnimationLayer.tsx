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
import { prepareAnimationAssets } from "./animationStability";
import { discardFlipTransitions } from "./discardFlipAnimationState";
import { useMatchSelector } from "./matchStore";
import { isLiveMatchTransition } from "./presentationContinuity";
import styles from "./DiscardFlipAnimationLayer.module.css";

const CARD_BACK_ART = "/assets/card-back.png";
const DISCARD_FLIP_MS = 880;
type ZoneOwner = "player" | "opponent";
type FlightPhase = "prepared" | "running" | "settling";
type CardRect = { left: number; top: number; width: number; height: number };

type StoredDiscardFlipState = { active: boolean; match: MatchState | null; playerId?: string };
type DiscardFlight = {
  id: string; owner: ZoneOwner; card: GameCard; left: number; top: number;
  width: number; height: number; deltaX: number; deltaY: number;
  scaleX: number; scaleY: number; delay: number; phase: FlightPhase;
};
type PendingFlight = {
  id: string; owner: ZoneOwner; card: GameCard; previousTop: GameCard | null;
  source: HTMLElement; target: HTMLElement; delay: number;
};
type DiscardPresentation = {
  owner: ZoneOwner;
  card: GameCard | null;
  left: number;
  top: number;
  width: number;
  height: number;
};

function stackCardRect(zone: HTMLElement): CardRect | null {
  const rect = zone.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const insetX = rect.width * 0.05;
  const insetY = rect.height * 0.05;
  return { left: rect.left + insetX, top: rect.top + insetY, width: rect.width - insetX * 2, height: rect.height - insetY * 2 };
}

export function DiscardFlipAnimationLayer() {
  const stored = useMatchSelector((state): StoredDiscardFlipState => ({
    active: state.route === "match", match: state.match, playerId: state.playerId,
  }));
  const [flights, setFlights] = useState<DiscardFlight[]>([]);
  const [presentations, setPresentations] = useState<DiscardPresentation[]>([]);
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
      for (const target of hiddenTargets.keys()) delete target.dataset.discardAnimationTarget;
      hiddenTargets.clear();
      targets.clear();
    };
  }, []);

  const hideTarget = (id: string, target: HTMLElement) => {
    hiddenTargetCounts.current.set(target, (hiddenTargetCounts.current.get(target) ?? 0) + 1);
    flightTargets.current.set(id, target);
    target.dataset.discardAnimationTarget = "true";
  };
  const revealTarget = (id: string) => {
    const target = flightTargets.current.get(id);
    let remaining = 0;
    if (target) {
      remaining = Math.max(0, (hiddenTargetCounts.current.get(target) ?? 1) - 1);
      if (remaining) hiddenTargetCounts.current.set(target, remaining);
      else {
        hiddenTargetCounts.current.delete(target.dataset.discardAnimationTarget;
      }
    }
    flightTargets.current.delete(id);
    return remaining;
  };
  const finishFlight = (flight: DiscardFlight) => {
    const remaining = revealTarget(flight.id);
    if (!mounted.current) return;
    setPresentations((current) => {
      if (!remaining) return current.filter((item) => item.owner !== flight.owner);
      return current.map((item) => item.owner === flight.owner ? { ...item, card: flight.card } : item);
    });
    setFlights((current) => current.map((item) => item.id === flight.id ? { ...item, phase: "settling" } : item));
    window.requestAnimationFrame(() => {
      if (mounted.current) setFlights((current) => current.filter((item) => item.id !== flight.id));
    });
  };

  useLayoutEffect(() => {
    const match = stored.match;
    if (!stored.active) { previousMatch.current = null; return; }
    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!isLiveMatchTransition(previous, match, document.visibilityState)) return;
    const transitions = discardFlipTransitions(previous, match);
    if (!transitions.length) return;

    const localPlayerId = stored.playerId ?? match.players[0]?.id;
    const pending: PendingFlight[] = [];
    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const deckZone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-deck"]`);
      const discardZone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-discard-pile"]`);
      if (!deckZone || !discardZone) continue;
      const previousPlayer = previous?.players.find((candidate) => candidate.id === transition.playerId);
      const previousTop = previousPlayer?.discard.at(-1) ?? null;
      transition.cards.forEach((card, index) => pending.push({
        id: `${match.id}:${match.version}:${transition.playerId}:discard:${card.id}:${index}`,
        owner, card, previousTop, source: deckZone, target: discardZone, delay: index * 105,
      }));
    }
    if (!pending.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    let cancelled = false;
    let measureFrame = 0;
    let startFrame = 0;

    void prepareAnimationAssets([
      CARD_BACK_ART,
      ...pending.map((item) => item.card.art),
      ...pending.map((item) => item.previousTop?.art ?? "").filter(Boolean),
    ]).then(() => {
      if (cancelled || !mounted.current) return;
      measureFrame = window.requestAnimationFrame(() => {
        if (cancelled || !mounted.current) return;
        const measured: Array<{
          flight: DiscardFlight;
          target: HTMLElement;
          previousTop: GameCard | null;
          end: CardRect;
        }> = [];
        for (const item of pending) {
          const start = stackCardRect(item.source);
          const end = stackCardRect(item.target);
          if (!start || !end) continue;
          measured.push({
            target: item.target,
            previousTop: item.previousTop,
            end,
            flight: {
              id: item.id, owner: item.owner, card: item.card,
              left: start.left, top: start.top, width: start.width, height: start.height,
              deltaX: end.left - start.left, deltaY: end.top - start.top,
              scaleX: end.width / start.width, scaleY: end.height / start.height,
              delay: item.delay, phase: "prepared",
            },
          });
        }
        if (!measured.length) return;
        setFlights((current) => [...current, ...measured.map((item) => item.flight)]);
        setPresentations((current) => {
          const next = [...current];
          for (const item of measured) {
            const existingIndex = next.findIndex((presentation) => presentation.owner === item.flight.owner);
            if (existingIndex >= 0) {
              next[existingIndex] = {
                ...next[existingIndex],
                left: item.end.left,
                top: item.end.top,
                width: item.end.width,
                height: item.end.height,
              };
              continue;
            }
            next.push({
              owner: item.flight.owner,
              card: item.previousTop,
              left: item.end.left,
              top: item.end.top,
              width: item.end.width,
              height: item.end.height,
            });
          }
          return next;
        });
        startFrame = window.requestAnimationFrame(() => {
          if (cancelled || !mounted.current) return;
          for (const item of measured) hideTarget(item.flight.id, item.target);
          const ids = new Set(measured.map((item) => item.flight.id));
          setFlights((current) => current.map((flight) => ids.has(flight.id) ? { ...flight, phase: "running" } : flight));
        });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(measureFrame);
      window.cancelAnimationFrame(startFrame);
    };
  }, [stored.active, stored.match, stored.playerId]);

  if (!stored.active || (!flights.length && !presentations.length) || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.layer} aria-hidden="true">
      {presentations.map((presentation) => {
        if (!presentation.card) return null;
        const style = {
          left: presentation.left,
          top: presentation.top,
          width: presentation.width,
          height: presentation.height,
        } as CSSProperties;
        return (
          <div
            className={styles.discardBase}
            data-card-type={presentation.card.type}
            style={style}
            key={`discard-base:${presentation.owner}`}
          >
            <OriginalImage src={presentation.card.art} alt="" draggable={false} />
          </div>
        );
      })}
      {flights.map((flight) => {
        const style = {
          left: flight.left, top: flight.top, width: flight.width, height: flight.height,
          "--discard-delta-x": `${flight.deltaX}px`, "--discard-delta-y": `${flight.deltaY}px`,
          "--discard-scale-x": flight.scaleX, "--discard-scale-y": flight.scaleY,
          "--discard-delay": `${flight.delay}ms`, "--discard-duration": `${DISCARD_FLIP_MS}ms`,
        } as CSSProperties;
        return (
          <div className={styles.flight} data-owner={flight.owner} data-card-type={flight.card.type}
            data-state={flight.phase} style={style}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && flight.phase === "running") finishFlight(flight);
            }} key={flight.id}>
            <div className={styles.cardInner}>
              <OriginalImage className={styles.cardBack} src={CARD_BACK_ART} alt="" draggable={false} />
              <div className={styles.cardFace}><OriginalImage src={flight.card.art} alt="" draggable={false} /></div>
            </div>
          </div>
        );
      })}
    </div>, document.body,
  );
}
