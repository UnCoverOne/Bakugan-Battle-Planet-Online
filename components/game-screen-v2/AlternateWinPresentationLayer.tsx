"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MatchState } from "../../lib/game";
import { useMatchSelector } from "./matchStore";
import {
  DRAGONOID_MAXIMUS_ANIMATION_MS,
  DRAGONOID_MAXIMUS_CARD_ID,
  DRAGONOID_MAXIMUS_RESULT_DELAY_MS,
  dragonoidMaximusResolvedAt,
  isDragonoidMaximusResult,
} from "./alternateWinPresentation";
import styles from "./AlternateWinPresentationLayer.module.css";

type PresentationState = {
  active: boolean;
  match: MatchState | null;
};

function maximusCard(match: MatchState) {
  for (const player of match.players) {
    for (const bakugan of player.bakugan) {
      const card = [...bakugan.evoStack].reverse().find((candidate) => (
        candidate.catalogId === DRAGONOID_MAXIMUS_CARD_ID
      ));
      if (card) return card;
    }
  }
  return null;
}

export function AlternateWinPresentationLayer() {
  const presentation = useMatchSelector((state): PresentationState => ({
    active: state.route === "match",
    match: state.match,
  }));
  const match = presentation.match;
  const active = presentation.active && isDragonoidMaximusResult(match);
  const resultKey = `${match?.id ?? ""}:${match?.gameNumber ?? 0}:${match?.phase ?? ""}:${match?.resultReason ?? ""}`;
  const [fallbackResolvedAt, setFallbackResolvedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const resolvedAt = dragonoidMaximusResolvedAt(match) || fallbackResolvedAt;
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const update = () => setNow(Date.now());
    const startedAt = Date.now();
    if (!dragonoidMaximusResolvedAt(match)) setFallbackResolvedAt(startedAt);
    setNow(startedAt);
    const interval = window.setInterval(update, 50);
    return () => window.clearInterval(interval);
  }, [active, match, resultKey]);

  useEffect(() => {
    if (active) root.current?.focus();
  }, [active]);

  if (!active || !match) return null;
  const elapsed = Math.max(0, now - resolvedAt);
  if (elapsed >= DRAGONOID_MAXIMUS_RESULT_DELAY_MS) return null;
  const phase = elapsed < DRAGONOID_MAXIMUS_ANIMATION_MS ? "spectacle" : "aftermath";
  const card = maximusCard(match);
  const winner = match.players.find((player) => player.id === match.winner);

  return (
    <div
      ref={root}
      className={styles.layer}
      data-phase={phase}
      role="dialog"
      aria-modal="true"
      aria-label="Dragonoid Maximus alternate win resolution"
      tabIndex={-1}
    >
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.energyRings} aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className={styles.burst} aria-hidden="true" />
      <div className={styles.particles} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <i
            key={index}
            style={{ "--particle-index": index } as CSSProperties}
          />
        ))}
      </div>
      <section className={styles.stage}>
        <span className={styles.kicker}>ULTIMATE WIN EFFECT RESOLVED</span>
        <div className={styles.cardFrame}>
          <span className={styles.cardGlow} aria-hidden="true" />
          <img
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
        Dragonoid Maximus resolved. The match result will appear shortly.
      </p>
    </div>
  );
}
