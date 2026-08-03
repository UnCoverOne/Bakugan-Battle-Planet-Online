from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    content = read(path)
    next_content, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex occurrence, found {count}: {pattern[:100]!r}")
    write(path, next_content)


write("components/game-screen-v2/animationStability.ts", r'''"use client";

const decodedImages = new Map<string, Promise<void>>();
const VIEWPORT_STABLE_EVENT = "bbp-viewport-stable";

function decodeImage(source: string) {
  if (!source || typeof Image === "undefined") return Promise.resolve();
  const cached = decodedImages.get(source);
  if (cached) return cached;

  const pending = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    const finish = () => {
      if (typeof image.decode === "function") {
        void image.decode().catch(() => undefined).finally(resolve);
      } else {
        resolve();
      }
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
    image.src = source;
    if (image.complete && image.naturalWidth > 0) finish();
  });
  decodedImages.set(source, pending);
  return pending;
}

export function waitForStableViewport(maximumWaitMs = 520) {
  if (typeof document === "undefined" || document.documentElement.dataset.viewportChanging !== "true") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      window.removeEventListener(VIEWPORT_STABLE_EVENT, complete);
      resolve();
    };
    const timeout = window.setTimeout(complete, maximumWaitMs);
    window.addEventListener(VIEWPORT_STABLE_EVENT, complete, { once: true });
  });
}

/** Decode the exact assets used by a flight and wait for unstable viewport work
 * to finish before committing its first visible frame. */
export async function prepareAnimationAssets(sources: readonly (string | null | undefined)[]) {
  await Promise.all([
    ...[...new Set(sources.filter((source): source is string => Boolean(source)))].map(decodeImage),
    waitForStableViewport(),
  ]);
}
''')

write("components/game-screen-v2/DrawAnimationLayer.tsx", r'''"use client";

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
import { drawTransitions } from "./drawAnimationState";
import styles from "./DrawAnimationLayer.module.css";
import { useMatchSelector } from "./matchStore";

const CARD_BACK_ART = "/assets/card-back.png";
const DRAW_ANIMATION_MS = 760;

type HandOwner = "player" | "opponent";
type FlightPhase = "prepared" | "running" | "settling";

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

export function DrawAnimationLayer() {
  const stored = useMatchSelector((state): StoredDrawState => ({
    active: state.route === "match",
    match: state.match,
    playerId: state.playerId,
  }));
  const [flights, setFlights] = useState<DrawFlight[]>([]);
  const previousMatch = useRef<MatchState | null>(null);
  const flightTargets = useRef(new Map<string, HTMLElement>());
  const hiddenTargetCounts = useRef(new Map<HTMLElement, number>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const target of hiddenTargetCounts.current.keys()) {
        delete target.dataset.drawAnimationTarget;
      }
      hiddenTargetCounts.current.clear();
      flightTargets.current.clear();
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
        pending.push({
          id: `${match.id}:${match.version}:${transition.playerId}:${index}`,
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
              <img className={styles.cardBack} src={CARD_BACK_ART} alt="" draggable={false} />
              {flight.card ? (
                <img className={styles.cardFace} src={flight.card.art} alt="" draggable={false} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
''')

write("components/game-screen-v2/DrawAnimationLayer.module.css", r''':global([data-draw-animation-target="true"]) {
  opacity: 0 !important;
  pointer-events: none !important;
}

.layer {
  position: fixed;
  inset: 0;
  z-index: 20100;
  overflow: hidden;
  pointer-events: none;
  perspective: 1200px;
  contain: layout paint style;
}

.flight {
  position: fixed;
  box-sizing: border-box;
  opacity: 0;
  transform-origin: top left;
  transform-style: preserve-3d;
  filter:
    drop-shadow(0 0.45rem 0.6rem rgba(0, 0, 0, 0.72))
    drop-shadow(0 0 0.3rem rgba(255, 255, 255, 0.72));
  will-change: transform, opacity;
}

.flight[data-owner="opponent"] {
  filter:
    drop-shadow(0 0.45rem 0.6rem rgba(0, 0, 0, 0.72))
    drop-shadow(0 0 0.34rem rgba(255, 75, 61, 0.72));
}

.flight[data-state="running"] {
  animation: draw-card-flight var(--draw-duration) cubic-bezier(0.18, 0.76, 0.2, 1) var(--draw-delay) both;
}

.flight[data-state="settling"] {
  opacity: 0;
}

.cardInner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

.flight[data-state="running"][data-reveal="true"] .cardInner {
  animation: reveal-drawn-card var(--draw-duration) ease-in-out var(--draw-delay) both;
}

.cardBack,
.cardFace {
  position: absolute;
  inset: 0;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 3.8% / 2.8%;
  object-fit: contain;
  object-position: center;
  backface-visibility: hidden;
  background: #080a0d;
  user-select: none;
}

.cardFace { transform: rotateY(180deg); }

@keyframes draw-card-flight {
  0% { opacity: 0.94; transform: translate3d(0, 0, 0) scale(1) rotateZ(-1deg); }
  20% { opacity: 1; transform: translate3d(0, -1.35rem, 5rem) scale(1.08) rotateZ(4deg); }
  82% { opacity: 1; transform: translate3d(var(--draw-delta-x), calc(var(--draw-delta-y) - 0.35rem), 0) scale(var(--draw-scale-x), var(--draw-scale-y)) rotateZ(-1deg); }
  100% { opacity: 1; transform: translate3d(var(--draw-delta-x), var(--draw-delta-y), 0) scale(var(--draw-scale-x), var(--draw-scale-y)) rotateZ(0); }
}

@keyframes reveal-drawn-card {
  0%, 42% { transform: rotateY(0); }
  68%, 100% { transform: rotateY(180deg); }
}

@media (prefers-reduced-motion: reduce) {
  .flight[data-state="running"],
  .flight[data-state="running"][data-reveal="true"] .cardInner {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
}
''')

write("components/game-screen-v2/DiscardFlipAnimationLayer.tsx", r'''"use client";

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
import styles from "./DiscardFlipAnimationLayer.module.css";

const CARD_BACK_ART = "/assets/card-back.png";
const DISCARD_FLIP_MS = 880;
type ZoneOwner = "player" | "opponent";
type FlightPhase = "prepared" | "running" | "settling";

type StoredDiscardFlipState = { active: boolean; match: MatchState | null; playerId?: string };
type DiscardFlight = {
  id: string; owner: ZoneOwner; card: GameCard; left: number; top: number;
  width: number; height: number; deltaX: number; deltaY: number;
  scaleX: number; scaleY: number; delay: number; phase: FlightPhase;
};
type PendingFlight = {
  id: string; owner: ZoneOwner; card: GameCard; source: HTMLElement;
  target: HTMLElement; delay: number;
};

function stackCardRect(zone: HTMLElement) {
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
  const previousMatch = useRef<MatchState | null>(null);
  const flightTargets = useRef(new Map<string, HTMLElement>());
  const hiddenTargetCounts = useRef(new Map<HTMLElement, number>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const target of hiddenTargetCounts.current.keys()) delete target.dataset.discardAnimationTarget;
      hiddenTargetCounts.current.clear();
      flightTargets.current.clear();
    };
  }, []);

  const hideTarget = (id: string, target: HTMLElement) => {
    hiddenTargetCounts.current.set(target, (hiddenTargetCounts.current.get(target) ?? 0) + 1);
    flightTargets.current.set(id, target);
    target.dataset.discardAnimationTarget = "true";
  };
  const revealTarget = (id: string) => {
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
  };
  const finishFlight = (id: string) => {
    revealTarget(id);
    if (!mounted.current) return;
    setFlights((current) => current.map((flight) => flight.id === id ? { ...flight, phase: "settling" } : flight));
    window.requestAnimationFrame(() => {
      if (mounted.current) setFlights((current) => current.filter((flight) => flight.id !== id));
    });
  };

  useLayoutEffect(() => {
    const match = stored.match;
    if (!stored.active) { previousMatch.current = null; return; }
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
      transition.cards.forEach((card, index) => pending.push({
        id: `${match.id}:${match.version}:${transition.playerId}:discard:${card.id}:${index}`,
        owner, card, source: deckZone, target: discardZone, delay: index * 105,
      }));
    }
    if (!pending.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    let cancelled = false;
    let measureFrame = 0;
    let startFrame = 0;

    void prepareAnimationAssets([CARD_BACK_ART, ...pending.map((item) => item.card.art)]).then(() => {
      if (cancelled || !mounted.current) return;
      measureFrame = window.requestAnimationFrame(() => {
        if (cancelled || !mounted.current) return;
        const measured: Array<{ flight: DiscardFlight; target: HTMLElement }> = [];
        for (const item of pending) {
          const start = stackCardRect(item.source);
          const end = stackCardRect(item.target);
          if (!start || !end) continue;
          measured.push({
            target: item.target,
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
  }, [stored.active, stored.match?.id, stored.match?.version, stored.playerId]);

  if (!stored.active || !flights.length || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.layer} aria-hidden="true">
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
              if (event.target === event.currentTarget && flight.phase === "running") finishFlight(flight.id);
            }} key={flight.id}>
            <div className={styles.cardInner}>
              <img className={styles.cardBack} src={CARD_BACK_ART} alt="" draggable={false} />
              <div className={styles.cardFace}><img src={flight.card.art} alt="" draggable={false} /></div>
            </div>
          </div>
        );
      })}
    </div>, document.body,
  );
}
''')

write("components/game-screen-v2/DiscardFlipAnimationLayer.module.css", r''':global([data-zone-kind="discard-pile"][data-discard-animation-target="true"] > img) {
  opacity: 0 !important;
  pointer-events: none !important;
}
.layer { position: fixed; inset: 0; z-index: 20105; overflow: hidden; pointer-events: none; perspective: 1300px; contain: layout paint style; }
.flight { position: fixed; box-sizing: border-box; opacity: 0; transform-origin: top left; transform-style: preserve-3d; filter: drop-shadow(0 0.5rem 0.68rem rgba(0,0,0,.76)) drop-shadow(0 0 .34rem rgba(255,255,255,.8)); will-change: transform, opacity; }
.flight[data-owner="opponent"] { filter: drop-shadow(0 .5rem .68rem rgba(0,0,0,.76)) drop-shadow(0 0 .4rem rgba(255,76,61,.74)); }
.flight[data-state="running"] { animation: discard-card-flight var(--discard-duration) cubic-bezier(.16,.78,.2,1) var(--discard-delay) both; }
.flight[data-state="settling"] { opacity: 0; }
.cardInner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.flight[data-state="running"] .cardInner { animation: discard-card-turn var(--discard-duration) cubic-bezier(.22,.72,.22,1) var(--discard-delay) both; }
.cardBack,.cardFace { position:absolute;inset:0;display:block;box-sizing:border-box;width:100%;height:100%;overflow:hidden;border:1px solid rgba(255,255,255,.7);border-radius:3.8% / 2.8%;backface-visibility:hidden;background:#080a0d;user-select:none; }
.cardBack { object-fit:contain;object-position:center; }
.cardFace { transform:rotateY(180deg); }
.cardFace img { display:block;width:100%;height:100%;object-fit:contain;object-position:center;user-select:none; }
.flight[data-card-type="Flip"] .cardFace img { position:absolute;left:50%;top:50%;width:126%;height:90%;max-width:none;transform:translate(-50%,-50%) rotate(90deg);transform-origin:center; }
@keyframes discard-card-flight {
  0% { opacity:.96;transform:translate3d(0,0,0) scale(1) rotateZ(-2deg); }
  18% { opacity:1;transform:translate3d(0,-1.2rem,5.5rem) scale(1.08) rotateZ(6deg); }
  52% { opacity:1;transform:translate3d(calc(var(--discard-delta-x)*.52),calc(var(--discard-delta-y)*.52 - 2.2rem),6.5rem) scale(1.12) rotateZ(12deg); }
  86% { opacity:1;transform:translate3d(var(--discard-delta-x),calc(var(--discard-delta-y) - .4rem),0) scale(var(--discard-scale-x),var(--discard-scale-y)) rotateZ(-2deg); }
  100% { opacity:1;transform:translate3d(var(--discard-delta-x),var(--discard-delta-y),0) scale(var(--discard-scale-x),var(--discard-scale-y)) rotateZ(0); }
}
@keyframes discard-card-turn { 0%,24%{transform:rotateY(0)} 72%,100%{transform:rotateY(180deg)} }
@media (prefers-reduced-motion: reduce) { .flight[data-state="running"],.flight[data-state="running"] .cardInner { animation-duration:1ms;animation-delay:0ms; } }
''')

write("components/game-screen-v2/ViewportStabilityGuard.tsx", r'''"use client";

import { useEffect } from "react";

const VIEWPORT_STABLE_EVENT = "bbp-viewport-stable";
type ViewportSample = { width: number; height: number; scale: number };

function sampleViewport(): ViewportSample {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    scale: viewport?.scale ?? 1,
  };
}

/** Mark only meaningful geometry changes. Routine visualViewport scrolling and
 * small browser-chrome height adjustments no longer pause active effects. */
export function ViewportStabilityGuard() {
  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    let previous = sampleViewport();

    const markChanging = (force = false) => {
      const next = sampleViewport();
      const widthChanged = Math.abs(next.width - previous.width) >= 1;
      const scaleChanged = Math.abs(next.scale - previous.scale) >= 0.01;
      const materialHeightChange = Math.abs(next.height - previous.height) >= 140;
      previous = next;
      if (!force && !widthChanged && !scaleChanged && !materialHeightChange) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.dataset.viewportChanging = "true";
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          delete document.documentElement.dataset.viewportChanging;
          window.dispatchEvent(new Event(VIEWPORT_STABLE_EVENT));
        }, 180);
      });
    };

    const resize = () => markChanging(false);
    const orientation = () => markChanging(true);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("orientationchange", orientation, { passive: true });
    window.visualViewport?.addEventListener("resize", resize, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      delete document.documentElement.dataset.viewportChanging;
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", orientation);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);
  return null;
}
''')

# Match store: selector-aware subscriptions and deferred persistence.
replace_once(
    "components/game-screen-v2/matchStore.ts",
    'import { useEffect, useSyncExternalStore } from "react";',
    'import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";',
)
replace_once(
    "components/game-screen-v2/matchStore.ts",
    'export function readMatchStore(): MatchStoreSnapshot {',
    'function readPersistedMatchStore(): MatchStoreSnapshot {',
)
replace_once(
    "components/game-screen-v2/matchStore.ts",
    '  snapshot = readMatchStore();\n  window.addEventListener("storage", refresh);\n  window.addEventListener(MATCH_UPDATE_EVENT, refresh as EventListener);',
    '  snapshot = readPersistedMatchStore();\n  window.addEventListener("storage", refresh);\n  window.addEventListener(MATCH_UPDATE_EVENT, receiveMatchUpdate as EventListener);',
)
replace_once(
    "components/game-screen-v2/matchStore.ts",
    '  const next = readMatchStore();',
    '  const next = readPersistedMatchStore();',
)
replace_once(
    "components/game-screen-v2/matchStore.ts",
    'function initialize() {',
    'function receiveMatchUpdate(event: Event) {\n  const detail = (event as CustomEvent<MatchState>).detail;\n  if (!detail) return refresh();\n  const normalized = normalizeMatchState(detail);\n  if (snapshot.match?.id === normalized.id && snapshot.match.version >= normalized.version) return;\n  snapshot = { ...snapshot, match: normalized };\n  notify();\n}\n\nfunction initialize() {',
)
replace_once(
    "components/game-screen-v2/matchStore.ts",
    'function getSnapshot() {\n  initialize();\n  return snapshot;\n}\n\nexport function useMatchSelector<T>(selector: (state: MatchStoreSnapshot) => T) {\n  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);\n  return selector(state);\n}',
    '''function getSnapshot() {
  initialize();
  return snapshot;
}

export function readMatchStore(): MatchStoreSnapshot {
  return getSnapshot();
}

function shallowSelectorEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftPrototype = Object.getPrototypeOf(left);
  const rightPrototype = Object.getPrototypeOf(right);
  const supported = leftPrototype === Object.prototype || leftPrototype === Array.prototype;
  if (!supported || leftPrototype !== rightPrototype) return false;
  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ));
}

export function useMatchSelector<T>(
  selector: (state: MatchStoreSnapshot) => T,
  equality: (left: T, right: T) => boolean = shallowSelectorEqual,
) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equality);
  const selectedRef = useRef<{ ready: boolean; value: T }>({ ready: false, value: undefined as T });
  selectorRef.current = selector;
  equalityRef.current = equality;

  const selectedSnapshot = useCallback(() => {
    const next = selectorRef.current(getSnapshot());
    const previous = selectedRef.current;
    if (previous.ready && equalityRef.current(previous.value, next)) return previous.value;
    selectedRef.current = { ready: true, value: next };
    return next;
  }, []);
  const serverSnapshot = useCallback(() => selectorRef.current(EMPTY), []);
  return useSyncExternalStore(subscribe, selectedSnapshot, serverSnapshot);
}''',
)
regex_once(
    "components/game-screen-v2/matchStore.ts",
    r'export function publishMatch\(next: MatchState, rememberPrevious = true\) \{[\s\S]*?\n\}\n\nexport function publishRoute',
    '''let persistTimer = 0;
let pendingPersistedMatch: MatchState | null = null;
let pendingPreviousMatch: MatchState | null = null;
let pendingRememberPrevious = false;

function scheduleMatchPersistence(next: MatchState, previous: MatchState | null, rememberPrevious: boolean) {
  pendingPersistedMatch = next;
  if (rememberPrevious && previous) {
    pendingPreviousMatch = previous;
    pendingRememberPrevious = true;
  }
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const match = pendingPersistedMatch;
    const prior = pendingPreviousMatch;
    const remember = pendingRememberPrevious;
    pendingPersistedMatch = null;
    pendingPreviousMatch = null;
    pendingRememberPrevious = false;
    if (remember && prior) writeStorage(localStorage, PREVIOUS_MATCH_KEY, prior);
    if (match) writeStorage(localStorage, MATCH_KEY, match);
  }, 0);
}

export function publishMatch(next: MatchState, rememberPrevious = true) {
  initialize();
  const normalized = normalizeMatchState(next);
  const current = snapshot.match;
  if (current && current.id === normalized.id && normalized.version <= current.version) return false;
  snapshot = { ...snapshot, match: normalized };
  notify();
  scheduleMatchPersistence(normalized, current, rememberPrevious);
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: normalized }));
  return true;
}

export function publishRoute''',
)

# Remove document-wide observers in card presentation.
replace_once(
    "components/game-screen-v2/GameplayCardPresentationLayer.tsx",
    '''    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };''',
    '''    synchronize();
    const secondFrame = window.requestAnimationFrame(synchronize);
    window.addEventListener("resize", synchronize);
    window.visualViewport?.addEventListener("resize", synchronize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", synchronize);
      window.visualViewport?.removeEventListener("resize", synchronize);
    };''',
)

# Phase transitions: retain a queue while blocked and replace body mutation observation with bounded/ref-based measurement.
replace_once(
    "components/game-screen-v2/PhaseTransitionLayer.tsx",
    '  const [transition, setTransition] = useState<TurnTransition | null>(null);',
    '  const [transitionQueue, setTransitionQueue] = useState<TurnTransition[]>([]);\n  const transition = transitionQueue[0] ?? null;',
)
regex_once(
    "components/game-screen-v2/PhaseTransitionLayer.tsx",
    r'  useEffect\(\(\) => \{\n    if \(!progress\) \{[\s\S]*?\n  \}, \[progress, transitionBlocked\]\);',
    '''  useEffect(() => {
    if (!progress) {
      previousProgress.current = null;
      setTransitionQueue([]);
      return;
    }
    const next = describeTurnTransition(previousProgress.current, progress);
    previousProgress.current = progress;
    if (!next) return;
    setTransitionQueue((current) => current.some((item) => item.signature === next.signature)
      ? current
      : [...current, next].slice(-5));
  }, [progress]);

  useEffect(() => {
    if (!transition || transitionBlocked) return;
    const duration = reducedMotionRequested()
      ? REDUCED_TRANSITION_DURATION_MS
      : PHASE_TRANSITION_DURATION_MS;
    const timeout = window.setTimeout(() => {
      setTransitionQueue((current) => current[0]?.signature === transition.signature
        ? current.slice(1)
        : current.filter((item) => item.signature !== transition.signature));
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [transition, transitionBlocked]);''',
)
regex_once(
    "components/game-screen-v2/PhaseTransitionLayer.tsx",
    r'    let frame = 0;\n    const clearFocus = [\s\S]*?\n    measure\(\);\n    const mutationObserver = new MutationObserver\(measure\);\n    mutationObserver.observe\(document.body, \{ childList: true, subtree: true \}\);\n    window.addEventListener\("resize", measure\);\n    window.visualViewport\?\.addEventListener\("resize", measure\);\n    window.visualViewport\?\.addEventListener\("scroll", measure\);\n    return \(\) => \{\n      window.cancelAnimationFrame\(frame\);\n      mutationObserver.disconnect\(\);\n      window.removeEventListener\("resize", measure\);\n      window.visualViewport\?\.removeEventListener\("resize", measure\);\n      window.visualViewport\?\.removeEventListener\("scroll", measure\);\n      clearFocus\("primary"\);\n      clearFocus\("secondary"\);\n    \};',
    '''    let frame = 0;
    let retryFrame = 0;
    let attempts = 0;
    let resizeObserver: ResizeObserver | null = null;
    const clearFocus = (kind: "primary" | "secondary") => {
      const element = focusedElements.current[kind];
      if (element?.getAttribute("data-transition-focus") === kind) {
        element.removeAttribute("data-transition-focus");
      }
      focusedElements.current[kind] = null;
    };
    const assignFocus = (kind: "primary" | "secondary", element: Element | null) => {
      if (focusedElements.current[kind] === element) return;
      clearFocus(kind);
      focusedElements.current[kind] = element;
      element?.setAttribute("data-transition-focus", kind);
    };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const primary = document.querySelector(plan.primarySelector);
        const secondary = plan.secondarySelector ? document.querySelector(plan.secondarySelector) : null;
        assignFocus("primary", primary);
        assignFocus("secondary", secondary);
        const next = { primary: targetBox(primary), secondary: targetBox(secondary) };
        setTargets((previous) => targetStatesMatch(previous, next) ? previous : next);
        resizeObserver?.disconnect();
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(measure);
          if (primary) resizeObserver.observe(primary);
          if (secondary) resizeObserver.observe(secondary);
        }
        if ((!primary || (plan.secondarySelector && !secondary)) && attempts < 8) {
          attempts += 1;
          retryFrame = window.requestAnimationFrame(measure);
        }
      });
    };

    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(retryFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      clearFocus("primary");
      clearFocus("secondary");
    };''',
)

# Core transfers are pre-mounted during the delay and only animate once active; global observers are removed.
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '''  cell,
  oppositePerspective,
}: {
  match: MatchState;
  playerId?: string;
  playArea: HTMLElement;
  cell: string;
  oppositePerspective: boolean;
}) {''',
    '''  cell,
  oppositePerspective,
  active,
}: {
  match: MatchState;
  playerId?: string;
  playArea: HTMLElement;
  cell: string;
  oppositePerspective: boolean;
  active: boolean;
}) {''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '    const mutationObserver = new MutationObserver(() => measure());\n\n    const measure = () => {',
    '    let attempts = 0;\n    let retryFrame = 0;\n\n    const measure = () => {',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '''        if (!source || !target || !target.isConnected || !playArea.isConnected) {
          setGeometry(null);
          return;
        }''',
    '''        if (!source || !target || !target.isConnected || !playArea.isConnected) {
          if (attempts < 8) {
            attempts += 1;
            retryFrame = window.requestAnimationFrame(measure);
          }
          return;
        }''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '''    measure();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();''',
    '''    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(retryFrame);
      resizeObserver?.disconnect();''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '      data-core-cell={cell}\n      style={style}',
    '      data-core-cell={cell}\n      data-active={active ? "true" : "false"}\n      style={style}',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '''    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [match?.id, playerId]);''',
    '''    measure();
    const secondFrame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", measure);
    };
  }, [match?.id, match?.version, playerId]);''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '  const deferredSet = new Set(deferredCoreCells);',
    '  const deferredSet = new Set(deferredCoreCells);\n  const transferringSet = new Set(transferringCoreCells);\n  const preparedTransferCells = [...new Set([...deferredCoreCells, ...transferringCoreCells])];',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.tsx",
    '''          {match && transferringCoreCells.length ? (
            <div className={styles.transferLayer} aria-hidden="true">
              {transferringCoreCells.map((cell) => (
                <CoreTransferSprite
                  match={match}
                  playerId={playerId}
                  playArea={targets.playArea!}
                  cell={cell}
                  oppositePerspective={oppositePerspective}
                  key={`${match.id}:${match.turn}:${cell}`}
                />
              ))}
            </div>
          ) : null}''',
    '''          {match && preparedTransferCells.length ? (
            <div className={styles.transferLayer} aria-hidden="true">
              {preparedTransferCells.map((cell) => (
                <CoreTransferSprite
                  match={match}
                  playerId={playerId}
                  playArea={targets.playArea!}
                  cell={cell}
                  oppositePerspective={oppositePerspective}
                  active={transferringSet.has(cell)}
                  key={`${match.id}:${match.turn}:${cell}`}
                />
              ))}
            </div>
          ) : null}''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.module.css",
    '''  transform-origin: center;
  animation: core-transfer 920ms cubic-bezier(0.16, 0.84, 0.22, 1) both;
  filter:''',
    '''  transform-origin: center;
  opacity: 0;
  filter:''',
)
replace_once(
    "components/game-screen-v2/BakuCoreLayer.module.css",
    '  will-change: transform, filter, opacity;\n}',
    '  will-change: transform, opacity;\n}\n\n.transferCore[data-active="true"] {\n  animation: core-transfer 920ms cubic-bezier(0.16, 0.84, 0.22, 1) both;\n}',
)

# Brawl resolution queue and transform-only docking.
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''  const [resolvingEffect, setResolvingEffect] = useState<PendingEffect | null>(null);
  const [effectBurst, setEffectBurst] = useState<PendingEffect | null>(null);''',
    '''  const [resolutionQueue, setResolutionQueue] = useState<PendingEffect[]>([]);
  const [resolvingEffect, setResolvingEffect] = useState<PendingEffect | null>(null);
  const [effectBurst, setEffectBurst] = useState<PendingEffect | null>(null);''',
)
regex_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    r'  useEffect\(\(\) => \{\n    const current = experience.match\?\.batch \?\? \[\];[\s\S]*?\n  \}, \[experience.match\?\.version, experience.match\?\.batch\]\);',
    '''  useEffect(() => {
    const current = experience.match?.batch ?? [];
    const previous = previousBatch.current;
    const removed = [...previous].reverse().filter((effect) => (
      !current.some((candidate) => candidate.id === effect.id)
    ));
    previousBatch.current = current;
    if (removed.length) {
      setResolutionQueue((queue) => [
        ...queue,
        ...removed.filter((effect) => !queue.some((queued) => queued.id === effect.id)),
      ]);
    }
  }, [experience.match?.version, experience.match?.batch]);

  useEffect(() => {
    if (resolvingEffect || !resolutionQueue.length) return;
    const [next, ...remaining] = resolutionQueue;
    setResolutionQueue(remaining);
    setResolvingEffect(next);
    setEffectBurst(next);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760);
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050);
    return () => {
      if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
      if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    };
  }, [resolutionQueue, resolvingEffect]);''',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '  const batchKey = combinedBatch.map((effect) => effect.id).join("|");\n',
    '',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''  const hudStyle = hudPosition ? {
    left: brawlDocked ? hudPosition.dockedLeft : hudPosition.left,
    top: hudPosition.top,
    width: `${hudPosition.maxWidth}px`,
  } as CSSProperties : undefined;''',
    '''  const hudStyle = hudPosition ? {
    left: hudPosition.left,
    top: hudPosition.top,
    width: `${hudPosition.maxWidth}px`,
    "--brawl-dock-offset": `${hudPosition.dockedLeft - hudPosition.left}px`,
  } as CSSProperties : undefined;''',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '<div className={styles.batchRow} key={batchKey}>',
    '<div className={styles.batchRow}>',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.module.css",
    '''  transition: left 220ms cubic-bezier(0.2, 0.78, 0.2, 1);
  will-change: left;''',
    '''  transition: transform 220ms cubic-bezier(0.2, 0.78, 0.2, 1);
  will-change: transform;''',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.module.css",
    '''}

.brawlDockHandle {''',
    '''}

.brawlHud[data-docked="true"] {
  transform: translate(calc(-50% + var(--brawl-dock-offset)), -100%);
}

.brawlDockHandle {''',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.module.css",
    '  animation: batch-row-shift 180ms ease-out both;\n',
    '',
)
replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.module.css",
    '  0% { opacity: 1; transform: scale(1); filter: brightness(1); }\n  38% { opacity: 1; transform: scale(1.16); filter: brightness(1.7); }\n  100% { opacity: 0; transform: scale(0.18) rotate(18deg); filter: brightness(2.2); }',
    '  0% { opacity: 1; transform: scale(1); }\n  38% { opacity: 1; transform: scale(1.16); }\n  100% { opacity: 0; transform: scale(0.18) rotate(18deg); }',
)

# Remove blur animation from phase callout.
replace_once(
    "components/game-screen-v2/PhaseTransitionLayer.module.css",
    '  0% { opacity: 0; transform: translate(-50%, -50%) scaleX(0.82); filter: blur(2px); }\n  8% { opacity: 1; transform: translate(-50%, -50%) scaleX(1); filter: blur(0); }\n  88% { opacity: 1; transform: translate(-50%, -50%) scaleX(1); filter: blur(0); }\n  100% { opacity: 0; transform: translate(-50%, -50%) scaleX(1.025); filter: blur(0); }',
    '  0% { opacity: 0; transform: translate(-50%, -50%) scaleX(0.82); }\n  8% { opacity: 1; transform: translate(-50%, -50%) scaleX(1); }\n  88% { opacity: 1; transform: translate(-50%, -50%) scaleX(1); }\n  100% { opacity: 0; transform: translate(-50%, -50%) scaleX(1.025); }',
)

# Roll Result gets an explicit exit presence instead of an immediate unmount.
replace_once(
    "components/game-screen-v2/RollResultLayer.tsx",
    'import type { CSSProperties } from "react";',
    'import { useEffect, useState, type CSSProperties } from "react";',
)
replace_once(
    "components/game-screen-v2/RollResultLayer.tsx",
    '''}) {
  if (!open || !match?.players.length) return null;
  const localPlayer = match.players.find((player) => player.id === playerId)
    ?? match.players[0];''',
    '''}) {
  const [displayMatch, setDisplayMatch] = useState<MatchState | null>(open ? match : null);
  const [presence, setPresence] = useState<"visible" | "exiting">("visible");
  useEffect(() => {
    if (open && match) {
      setDisplayMatch(match);
      setPresence("visible");
      return;
    }
    if (!displayMatch) return;
    setPresence("exiting");
    const timeout = window.setTimeout(() => setDisplayMatch(null), 180);
    return () => window.clearTimeout(timeout);
  }, [open, match, displayMatch]);
  if (!displayMatch?.players.length) return null;
  const renderedMatch = displayMatch;
  const localPlayer = renderedMatch.players.find((player) => player.id === playerId)
    ?? renderedMatch.players[0];''',
)
# Within RollResult body, remaining match references should use renderedMatch.
content = read("components/game-screen-v2/RollResultLayer.tsx")
start = content.index('  const currentRerollPlayers')
end = content.rindex('\n}\n')
segment = content[start:end].replace('match.', 'renderedMatch.').replace('match?', 'renderedMatch?')
segment = segment.replace('className={styles.backdrop}\n      role=', 'className={styles.backdrop}\n      data-state={presence}\n      role=')
write("components/game-screen-v2/RollResultLayer.tsx", content[:start] + segment + content[end:])
replace_once(
    "components/game-screen-v2/RollResultLayer.module.css",
    '''@keyframes roll-backdrop-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}''',
    '''.backdrop[data-state="exiting"] {
  animation: roll-backdrop-exit 180ms ease-in both;
}
.backdrop[data-state="exiting"] .dialog {
  animation: roll-dialog-exit 180ms ease-in both;
}
@keyframes roll-backdrop-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes roll-backdrop-exit { from { opacity: 1; } to { opacity: 0; } }
@keyframes roll-dialog-exit { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(.5rem) scale(.98); } }''',
)

# Tie-break overlay receives a delayed exit wrapper while retaining its action logic.
replace_once(
    "components/game-screen-v2/TieBreakLayer.tsx",
    'export function TieBreakLayer({',
    'function TieBreakLayerContent({',
)
replace_once(
    "components/game-screen-v2/TieBreakLayer.tsx",
    '''  onFinishTieBreak,
}: {
  match: MatchState | null;
  playerId?: string;
  onFlipTieBreakCard: TieBreakAction;
  onFinishTieBreak?: TieBreakAction;
}) {''',
    '''  onFinishTieBreak,
  forceVisible = false,
  presenceState = "visible",
}: {
  match: MatchState | null;
  playerId?: string;
  onFlipTieBreakCard: TieBreakAction;
  onFinishTieBreak?: TieBreakAction;
  forceVisible?: boolean;
  presenceState?: "visible" | "exiting";
}) {''',
)
replace_once(
    "components/game-screen-v2/TieBreakLayer.tsx",
    '  const visible = Boolean(\n    tieBreak',
    '  const visible = forceVisible || Boolean(\n    tieBreak',
)
replace_once(
    "components/game-screen-v2/TieBreakLayer.tsx",
    '<div className={styles.overlay} role="presentation">',
    '<div className={styles.overlay} data-state={presenceState} role="presentation">',
)
content = read("components/game-screen-v2/TieBreakLayer.tsx")
content += r'''

export function TieBreakLayer(props: {
  match: MatchState | null;
  playerId?: string;
  onFlipTieBreakCard: TieBreakAction;
  onFinishTieBreak?: TieBreakAction;
}) {
  const [presentedMatch, setPresentedMatch] = useState<MatchState | null>(null);
  const [presenceState, setPresenceState] = useState<"visible" | "exiting">("visible");
  const liveTieBreak = manualTieBreakState(props.match);

  useEffect(() => {
    if (!props.match || !liveTieBreak) {
      if (!presentedMatch) return;
      setPresenceState("exiting");
      const timeout = window.setTimeout(() => setPresentedMatch(null), 180);
      return () => window.clearTimeout(timeout);
    }
    setPresentedMatch(props.match);
    setPresenceState("visible");
    if (liveTieBreak.status !== "resolved" || !liveTieBreak.resolvedAt) return;
    const remaining = Math.max(0, liveTieBreak.resolvedAt + TIE_BREAK_PRESENTATION_MS - Date.now());
    const exitTimer = window.setTimeout(() => setPresenceState("exiting"), remaining);
    const clearTimer = window.setTimeout(() => setPresentedMatch(null), remaining + 180);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [props.match, liveTieBreak?.status, liveTieBreak?.resolvedAt]);

  if (!presentedMatch) return null;
  return (
    <TieBreakLayerContent
      {...props}
      match={presentedMatch}
      forceVisible
      presenceState={presenceState}
    />
  );
}
'''
write("components/game-screen-v2/TieBreakLayer.tsx", content)
replace_once(
    "components/game-screen-v2/TieBreakLayer.module.css",
    '''.dialog {
  width:''',
    '''.overlay[data-state="exiting"] {
  animation: tie-overlay-exit 180ms ease-in both;
}
.overlay[data-state="exiting"] .dialog {
  animation: tie-dialog-exit 180ms ease-in both;
}

.dialog {
  width:''',
)
content = read("components/game-screen-v2/TieBreakLayer.module.css")
content += '\n@keyframes tie-overlay-exit { from { opacity: 1; } to { opacity: 0; } }\n@keyframes tie-dialog-exit { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.98); } }\n'
write("components/game-screen-v2/TieBreakLayer.module.css", content)

# Regression coverage for the architectural contracts.
write("tests/presentation-stability.test.ts", r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("card flights prepare assets and use an overlap handoff instead of blank frames", () => {
  for (const name of ["DrawAnimationLayer", "DiscardFlipAnimationLayer"]) {
    const source = read(`components/game-screen-v2/${name}.tsx`);
    const css = read(`components/game-screen-v2/${name}.module.css`);
    assert.match(source, /prepareAnimationAssets/);
    assert.match(source, /phase: "prepared"/);
    assert.match(source, /phase: "running"/);
    assert.match(source, /phase: "settling"/);
    assert.doesNotMatch(css, /animation-play-state:\s*paused/);
    assert.match(css, /will-change:\s*transform, opacity/);
  }
});

test("viewport stability ignores scroll and match publication is selector-aware and deferred", () => {
  const viewport = read("components/game-screen-v2/ViewportStabilityGuard.tsx");
  const store = read("components/game-screen-v2/matchStore.ts");
  assert.doesNotMatch(viewport, /visualViewport\?\.addEventListener\("scroll"/);
  assert.match(viewport, /bbp-viewport-stable/);
  assert.match(store, /shallowSelectorEqual/);
  assert.match(store, /scheduleMatchPersistence/);
  assert.match(store, /snapshot = \{ \.\.\.snapshot, match: normalized \};\s*notify\(\);/);
});

test("presentation systems queue work and avoid document-wide mutation observers", () => {
  const phase = read("components/game-screen-v2/PhaseTransitionLayer.tsx");
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const cards = read("components/game-screen-v2/GameplayCardPresentationLayer.tsx");
  const cores = read("components/game-screen-v2/BakuCoreLayer.tsx");
  assert.match(phase, /transitionQueue/);
  assert.match(brawl, /resolutionQueue/);
  assert.doesNotMatch(phase, /new MutationObserver/);
  assert.doesNotMatch(cards, /new MutationObserver/);
  assert.doesNotMatch(cores, /new MutationObserver/);
  assert.match(cores, /preparedTransferCells/);
  assert.match(cores, /data-active=\{active/);
});

test("batch rows remain mounted, docking is transform-only, and modal exits are explicit", () => {
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const brawlCss = read("components/game-screen-v2/BrawlExperienceLayer.module.css");
  const roll = read("components/game-screen-v2/RollResultLayer.tsx");
  const tie = read("components/game-screen-v2/TieBreakLayer.tsx");
  assert.doesNotMatch(brawl, /key=\{batchKey\}/);
  assert.match(brawlCss, /--brawl-dock-offset/);
  assert.doesNotMatch(brawlCss, /transition:\s*left/);
  assert.match(roll, /data-state=\{presence\}/);
  assert.match(tie, /presenceState/);
  assert.match(tie, /forceVisible/);
});
''')

# Add focused test to the standard suite after the existing deck animation test when present.
package = read("package.json")
if "tests/presentation-stability.test.ts" not in package:
    anchor = "tests/deck-interaction-animation.test.ts"
    if anchor in package:
        package = package.replace(anchor, f"{anchor} tests/presentation-stability.test.ts", 1)
    else:
        package = package.replace(" && node --test tests/rendered-html.test.mjs", " tests/presentation-stability.test.ts && node --test tests/rendered-html.test.mjs", 1)
    write("package.json", package)

print("Presentation stability changes applied.")
