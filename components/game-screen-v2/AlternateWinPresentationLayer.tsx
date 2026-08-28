"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MatchState } from "../../lib/game";
import { useMatchSelector } from "./matchStore";
import {
  DRAGONOID_MAXIMUS_HERO_CARD_IDS,
  DRAGONOID_MAXIMUS_SKIP_EVENT,
  dragonoidMaximusCard,
  dragonoidMaximusHeroCards,
  dragonoidMaximusPresentationDuration,
  dragonoidMaximusResolvedAt,
  dragonoidMaximusWinner,
  isDragonoidMaximusResult,
} from "./alternateWinPresentation";
import styles from "./AlternateWinPresentationLayer.module.css";

type PresentationState = {
  active: boolean;
  match: MatchState | null;
};

type TimelineStyle = CSSProperties & {
  "--maximus-duration": string;
  "--timeline-offset": string;
};

const HERO_FALLBACK_NAMES = ["Dan Kouzo", "Wynton Styles", "Lia Venegas"] as const;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AlternateWinPresentationLayer() {
  const presentation = useMatchSelector((state): PresentationState => ({
    active: state.route === "match",
    match: state.match,
  }));
  const match = presentation.match;
  const active = presentation.active && isDragonoidMaximusResult(match);
  const resolvedAt = dragonoidMaximusResolvedAt(match);
  const resultKey = `${match?.id ?? ""}:${match?.gameNumber ?? 0}:${match?.winner ?? ""}:${match?.resultReason ?? ""}:${resolvedAt}`;
  const fallbackResolvedAt = useRef(Date.now());
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [timelineElapsed, setTimelineElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      setFinished(false);
      setTimelineElapsed(0);
      return;
    }
    const startedAt = resolvedAt || Date.now();
    if (!resolvedAt) fallbackResolvedAt.current = startedAt;
    const effectiveStartedAt = resolvedAt || fallbackResolvedAt.current;
    const duration = dragonoidMaximusPresentationDuration(reducedMotion);
    const elapsed = Math.max(0, Date.now() - effectiveStartedAt);
    setTimelineElapsed(Math.min(elapsed, duration));
    setFinished(elapsed >= duration);
    if (elapsed >= duration) return;
    const timeout = window.setTimeout(() => setFinished(true), duration - elapsed);
    return () => window.clearTimeout(timeout);
  }, [active, reducedMotion, resolvedAt, resultKey]);

  const skip = useCallback(() => {
    setFinished(true);
    window.dispatchEvent(new Event(DRAGONOID_MAXIMUS_SKIP_EVENT));
  }, []);

  useEffect(() => {
    if (!active || finished) return;
    skipRef.current?.focus();
    const trapFocusAndSkip = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        skipRef.current?.focus();
      }
    };
    window.addEventListener("keydown", trapFocusAndSkip);
    return () => window.removeEventListener("keydown", trapFocusAndSkip);
  }, [active, finished, resultKey, skip]);

  if (!active || !match || finished) return null;

  const duration = dragonoidMaximusPresentationDuration(reducedMotion);
  const timelineStyle = {
    "--maximus-duration": `${duration}ms`,
    "--timeline-offset": reducedMotion ? "0ms" : `${-timelineElapsed}ms`,
  } as TimelineStyle;
  const card = dragonoidMaximusCard(match);
  const heroCards = dragonoidMaximusHeroCards(match);
  const heroById = new Map(heroCards.map((hero) => [hero.catalogId, hero]));
  const winner = dragonoidMaximusWinner(match);

  return (
    <div
      className={styles.layer}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-label="Dragonoid Maximus alternate win resolution"
      style={timelineStyle}
    >
      <button
        ref={skipRef}
        type="button"
        className={styles.skipAction}
        onClick={skip}
        aria-label="Skip Dragonoid Maximus win animation"
      >
        SKIP
      </button>
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.burst} aria-hidden="true" />
      <div className={styles.energyRings} aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className={styles.particles} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i
            key={index}
            style={{ "--particle-index": index } as CSSProperties}
          />
        ))}
      </div>

      <section className={styles.stage}>
        <div className={styles.heroConstellation} aria-label="Required Hero cards">
          {DRAGONOID_MAXIMUS_HERO_CARD_IDS.map((catalogId, index) => {
            const hero = heroById.get(catalogId);
            const fallbackName = HERO_FALLBACK_NAMES[index] ?? "Required Hero";
            const heroName = hero?.displayName || hero?.name || fallbackName;
            return (
              <div
                key={catalogId}
                className={styles.heroBeat}
                data-slot={index + 1}
              >
                <span className={styles.heroBeam} aria-hidden="true" />
                <div className={styles.heroCardShell}>
                  {hero ? (
                    <OriginalImage
                      src={hero.art}
                      alt={heroName}
                      draggable={false}
                    />
                  ) : (
                    <span className={styles.heroPlaceholder}>{heroName}</span>
                  )}
                  <strong>{heroName}</strong>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.conditionLock} aria-hidden="true">
          <span />
          <strong>ULTIMATE CONDITION LOCKED</strong>
          <span />
        </div>

        <span className={styles.kicker}>ULTIMATE WIN EFFECT RESOLVED</span>
        <div className={styles.cardFrame}>
          <span className={styles.cardGlow} aria-hidden="true" />
          <OriginalImage
            src={card?.art ?? "/assets/cards/sets/ex/full/ex-2.webp"}
            alt="Dragonoid Maximus"
            draggable={false}
          />
        </div>
        <div className={styles.copy}>
          <h2>DRAGONOID MAXIMUS</h2>
          <strong>THE ULTIMATE BRAWLER ASCENDS</strong>
          <p>{winner?.name ?? "The controlling Brawler"} fulfilled the alternate win condition.</p>
        </div>
      </section>

      <p className={styles.accessibleStatus} aria-live="assertive">
        Dan Kouzo, Wynton Styles, and Lia Venegas completed Dragonoid Maximus&apos;s ultimate condition. The match result will appear shortly.
      </p>
    </div>
  );
}
