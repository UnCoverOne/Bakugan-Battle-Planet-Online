"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import {
  useCallback,
  useEffect,
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
  dragonoidMaximusPresentationStartedAt,
  dragonoidMaximusResultKey,
  dragonoidMaximusWinner,
  isDragonoidMaximusResult,
} from "./alternateWinPresentation";
import styles from "./AlternateWinPresentationLayer.module.css";
import mobileStyles from "./AlternateWinPresentationMobile.module.css";

type PresentationState = {
  active: boolean;
  match: MatchState | null;
};

type AlternateWinPresentationLayerProps = {
  match?: MatchState | null;
  presentationMode?: "live" | "replay";
  playbackRate?: number;
};

type TimelineStyle = CSSProperties & {
  "--maximus-duration": string;
  "--timeline-offset": string;
};

type PresentationClock = {
  key: string;
  startedAt: number;
  offset: number;
};

const HERO_FALLBACK_NAMES = ["Dan Kouzo", "Wynton Styles", "Lia Venegas"] as const;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AlternateWinPresentationLayer({
  match: replayMatch,
  presentationMode = "live",
  playbackRate = 1,
}: AlternateWinPresentationLayerProps = {}) {
  const livePresentation = useMatchSelector((state): PresentationState => ({
    active: state.route === "match",
    match: state.match,
  }));
  const presentation: PresentationState = presentationMode === "replay"
    ? { active: true, match: replayMatch ?? null }
    : livePresentation;
  const rate = presentationMode === "replay"
    ? Math.max(0.25, Math.min(4, playbackRate || 1))
    : 1;
  const match = presentation.match;
  const candidateActive = presentation.active && isDragonoidMaximusResult(match);
  const candidateResultKey = candidateActive ? dragonoidMaximusResultKey(match) : "";
  // A direct seek remounts the replay presenters at the destination frame. Do
  // not replay an alternate-win cinematic just because that destination is a
  // completed result; only animate when the result appears during adjacent
  // forward playback.
  const initialReplayResultKey = useRef(presentationMode === "replay" ? candidateResultKey : "");
  const suppressInitialReplayResult = presentationMode === "replay"
    && Boolean(candidateResultKey)
    && initialReplayResultKey.current === candidateResultKey;
  const active = candidateActive && !suppressInitialReplayResult;
  const resultKey = active ? candidateResultKey : "";
  const clockRef = useRef<PresentationClock>({ key: "", startedAt: 0, offset: 0 });
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [finished, setFinished] = useState(false);

  if (resultKey && clockRef.current.key !== resultKey) {
    const now = Date.now();
    const startedAt = presentationMode === "replay"
      ? now
      : dragonoidMaximusPresentationStartedAt(match, now);
    clockRef.current = {
      key: resultKey,
      startedAt,
      offset: Math.max(0, now - startedAt),
    };
  } else if (!resultKey && clockRef.current.key) {
    clockRef.current = { key: "", startedAt: 0, offset: 0 };
  }

  const presentationStartedAt = clockRef.current.key === resultKey
    ? clockRef.current.startedAt
    : 0;
  const timelineElapsed = clockRef.current.key === resultKey
    ? clockRef.current.offset
    : 0;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active || !resultKey || !presentationStartedAt) {
      setFinished(false);
      return;
    }
    setFinished(false);
    const duration = dragonoidMaximusPresentationDuration(reducedMotion) / rate;
    const elapsed = Math.max(0, Date.now() - presentationStartedAt);
    if (elapsed >= duration) {
      setFinished(true);
      return;
    }
    const timeout = window.setTimeout(
      () => setFinished(true),
      duration - elapsed,
    );
    return () => window.clearTimeout(timeout);
  }, [active, presentationStartedAt, rate, reducedMotion, resultKey]);

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

  const duration = dragonoidMaximusPresentationDuration(reducedMotion) / rate;
  const timelineStyle = {
    "--maximus-duration": `${duration}ms`,
    "--timeline-offset": reducedMotion
      ? "0ms"
      : `${-Math.min(timelineElapsed, Math.max(0, duration - 1))}ms`,
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
      <div className={`${styles.vignette} ${mobileStyles.vignette}`} aria-hidden="true" />
      <div className={styles.burst} aria-hidden="true" />
      <div className={styles.energyRings} aria-hidden="true">
        <span className={mobileStyles.energyRing} />
        <span className={mobileStyles.energyRing} />
        <span className={mobileStyles.energyRing} />
      </div>
      <div className={styles.particles} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i
            key={index}
            className={mobileStyles.particle}
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
                <div className={`${styles.heroCardShell} ${mobileStyles.heroCardShell}`}>
                  {hero ? (
                    <OriginalImage
                      src={hero.art}
                      alt={heroName}
                      draggable={false}
                      loading="eager"
                      decoding="async"
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
        <div className={`${styles.cardFrame} ${mobileStyles.cardFrame}`}>
          <span className={`${styles.cardGlow} ${mobileStyles.cardGlow}`} aria-hidden="true" />
          <OriginalImage
            src={card?.art ?? "/assets/cards/sets/ex/full/ex-2.webp"}
            alt="Dragonoid Maximus"
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
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
