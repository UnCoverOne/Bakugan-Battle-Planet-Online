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

export function CoinFlipLayer({ match, playerId, onCompleteCoinFlip }: CoinFlipLayerProps) {
  const pending = match?.pendingCoinFlip;
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const [revealedId, setRevealedId] = useState("");
  const completingId = useRef("");
  const completeRef = useRef(onCompleteCoinFlip);

  useEffect(() => {
    completeRef.current = onCompleteCoinFlip;
  }, [onCompleteCoinFlip]);

  useEffect(() => {
    if (!pending) {
      setRevealedId("");
      completingId.current = "";
      return;
    }
    setRevealedId("");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const revealTimer = window.setTimeout(
      () => setRevealedId(pending.id),
      reducedMotion ? 160 : 1_450,
    );
    const completeTimer = pending.controllerId === localPlayerId
      ? window.setTimeout(() => {
        if (completingId.current === pending.id) return;
        completingId.current = pending.id;
        void Promise.resolve(completeRef.current()).catch(() => {
          if (completingId.current === pending.id) completingId.current = "";
        });
      }, reducedMotion ? 650 : 2_200)
      : undefined;
    return () => {
      window.clearTimeout(revealTimer);
      if (completeTimer != null) window.clearTimeout(completeTimer);
    };
  }, [pending?.id, pending?.controllerId, localPlayerId]);

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
