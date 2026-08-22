"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchState } from "../../lib/game";
import styles from "./CoinFlipLayer.module.css";

type CoinFlipAction = () => void | Promise<void>;

type CoinFlipLayerProps = {
  match: MatchState | null;
  playerId?: string;
  onCompleteCoinFlip: CoinFlipAction;
};

const COIN_FLIP_COMPLETION_RETRY_MS = 900;

export function CoinFlipLayer({ match, playerId, onCompleteCoinFlip }: CoinFlipLayerProps) {
  const pending = match?.pendingCoinFlip;
  const pendingId = pending?.id;
  const pendingControllerId = pending?.controllerId;
  const pendingResolveAt = pending?.resolveAt;
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const [revealedId, setRevealedId] = useState("");
  const completingId = useRef("");
  const completeRef = useRef(onCompleteCoinFlip);

  useEffect(() => {
    completeRef.current = onCompleteCoinFlip;
  }, [onCompleteCoinFlip]);

  useEffect(() => {
    if (!pendingId || !pendingControllerId || pendingResolveAt == null) {
      setRevealedId("");
      completingId.current = "";
      return;
    }

    let cancelled = false;
    let completeTimer: number | undefined;
    setRevealedId("");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const revealTimer = window.setTimeout(
      () => setRevealedId(pendingId),
      reducedMotion ? 160 : 1_450,
    );

    const scheduleCompletion = (delay: number) => {
      completeTimer = window.setTimeout(() => void attemptCompletion(), delay);
    };
    const attemptCompletion = async () => {
      if (cancelled || completingId.current === pendingId) return;
      completingId.current = pendingId;
      try {
        await completeRef.current();
      } catch {
        if (cancelled) return;
        if (completingId.current === pendingId) completingId.current = "";
        // Completion is a rules liveness acknowledgement, not an optional UI
        // request. A transient HTTP/network failure must not strand the batch.
        scheduleCompletion(COIN_FLIP_COMPLETION_RETRY_MS);
      }
    };

    if (pendingControllerId === localPlayerId) {
      const animationDelay = reducedMotion
        ? 650
        : Math.max(0, pendingResolveAt - Date.now());
      scheduleCompletion(animationDelay);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(revealTimer);
      if (completeTimer != null) window.clearTimeout(completeTimer);
    };
  }, [localPlayerId, pendingControllerId, pendingId, pendingResolveAt]);

  if (!pending) return null;
  const revealed = revealedId === pending.id;
  const resultLabel = pending.result === "heads" ? "HEADS" : "TAILS";

  return (
    <div className={styles.backdrop} data-coin-flip-id={pending.id}>
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${pending.sourceName} coin flip`}
      >
        <p className={styles.eyebrow}>COIN FLIP</p>
        <h2 className={styles.title}>{pending.sourceName}</h2>
        <div className={styles.stage} aria-hidden="true">
          <div className={`${styles.coin} ${pending.result === "heads" ? styles.landHeads : styles.landTails}`}>
            <div className={`${styles.face} ${styles.front}`}>
              <span className={styles.rim}>H</span>
              <strong>HEADS</strong>
            </div>
            <div className={`${styles.face} ${styles.back}`}>
              <span className={styles.rim}>T</span>
              <strong>TAILS</strong>
            </div>
          </div>
          <div className={styles.shadow} />
        </div>
        <div className={styles.result} aria-live="assertive" aria-atomic="true">
          <span>{revealed ? "RESULT" : "FLIPPING…"}</span>
          <strong className={revealed ? styles.resultVisible : styles.resultHidden}>
            {resultLabel}
          </strong>
        </div>
      </section>
    </div>
  );
}
