"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MatchState } from "../../lib/game";
import { playerCanFlipDamage } from "../../lib/manualDamage";
import styles from "./DamageStepLayer.module.css";

type DamageAction = () => void | Promise<void>;

export function DamageStepLayer({
  match,
  playerId,
  onFlipDamageCard,
}: {
  match: MatchState | null;
  playerId?: string;
  onFlipDamageCard: DamageAction;
}) {
  const [deckZone, setDeckZone] = useState<HTMLElement | null>(null);
  const [discardZone, setDiscardZone] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const canFlip = playerCanFlipDamage(match, localPlayerId);
  const selectedFlip = Boolean(
    match
    && localPlayerId
    && match.phase === "damage"
    && match.pendingLoser === localPlayerId
    && match.revealedFlip,
  );

  useLayoutEffect(() => {
    setDeckZone(document.querySelector<HTMLElement>('[data-zone-id="player-deck"]'));
    setDiscardZone(document.querySelector<HTMLElement>('[data-zone-id="player-discard-pile"]'));
  }, [match?.id, match?.version]);

  useEffect(() => {
    if (deckZone) {
      if (canFlip) deckZone.dataset.damageFlipActive = "true";
      else delete deckZone.dataset.damageFlipActive;
    }
    if (discardZone) {
      if (selectedFlip) discardZone.dataset.selectedFlip = "true";
      else delete discardZone.dataset.selectedFlip;
    }
    return () => {
      if (deckZone) delete deckZone.dataset.damageFlipActive;
      if (discardZone) delete discardZone.dataset.selectedFlip;
    };
  }, [canFlip, selectedFlip, deckZone, discardZone]);

  useEffect(() => setError(""), [match?.version]);

  const flipNext = async () => {
    if (!canFlip || busy) return;
    setBusy(true);
    setError("");
    try {
      await onFlipDamageCard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The damage card could not be flipped.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canFlip && deckZone ? createPortal(
        <button
          type="button"
          className={styles.deckPrompt}
          disabled={busy}
          onClick={() => void flipNext()}
          aria-label={`Flip the next damage card. ${match?.pendingDamage ?? 0} remaining.`}
        >
          <strong>{match?.pendingDamage ?? 0}</strong>
          <span>FLIP DAMAGE</span>
        </button>,
        deckZone,
      ) : null}
      {selectedFlip && discardZone && match?.revealedFlip ? createPortal(
        <div className={styles.selectedFlipMarker} role="status" aria-live="polite">
          <span>SELECTED FLIP</span>
          <strong>{match.revealedFlip.displayName || match.revealedFlip.name}</strong>
        </div>,
        discardZone,
      ) : null}
      {error ? (
        <div className={styles.errorPopup} role="alert">
          <strong>Damage Step</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss damage error">×</button>
        </div>
      ) : null}
    </>
  );
}

