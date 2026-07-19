"use client";

import { useEffect, useMemo, useState } from "react";
import type { MatchState } from "../../lib/game";
import styles from "./MatchDecisionLayer.module.css";

type DecisionHandler = () => void | Promise<void>;
type DamageHandler = (cardId?: string) => void | Promise<void>;
type DiscardHandler = (cardIds: string[]) => void | Promise<void>;

export function MatchDecisionLayer({
  match,
  playerId,
  onResolveDamage,
  onDiscardToHandLimit,
}: {
  match: MatchState | null;
  playerId?: string;
  onResolveDamage: DamageHandler;
  onDiscardToHandLimit: DiscardHandler;
}) {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const player = match?.players.find((candidate) => candidate.id === playerId)
    ?? match?.players[0];
  const damageDecision = Boolean(
    match
    && player
    && match.phase === "damage"
    && match.pendingLoser === player.id
    && match.revealedFlip,
  );
  const requiredDiscards = match && player && match.phase === "handLimit" && match.priority === player.id
    ? Math.max(0, player.hand.length - 7)
    : 0;
  const handSignature = useMemo(
    () => player?.hand.map((card) => card.id).join("|") ?? "",
    [player?.hand],
  );

  useEffect(() => {
    setSelectedCardIds([]);
    setError("");
  }, [match?.phase, match?.version, handSignature]);

  if (!match || !player || (!damageDecision && requiredDiscards <= 0)) return null;

  const run = async (handler: DecisionHandler) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await handler();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (damageDecision && match.revealedFlip) {
    const flip = match.revealedFlip;
    const printedCost = typeof flip.cost === "number" ? flip.cost : 0;
    const frostStrike = match.damageOrigin
      ? match.frostStrike[match.damageOrigin] ?? 0
      : 0;
    const effectiveCost = printedCost + frostStrike;
    const affordable = effectiveCost <= player.energy;
    return (
      <div className={styles.backdrop} role="presentation">
        <section
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="experimental-flip-title"
        >
          <header className={styles.header}>
            <small>DAMAGE STEP • REVEALED FLIP</small>
            <h2 id="experimental-flip-title">Choose whether to play the Flip</h2>
            <p>The Damage Step cannot continue until this revealed card is played or declined.</p>
          </header>
          <div className={styles.flipLayout}>
            <img className={styles.flipArt} src={flip.art} alt={flip.displayName || flip.name} draggable={false} />
            <div className={styles.flipCopy}>
              <strong>{flip.displayName || flip.name}</strong>
              <p>{flip.effect || "No printed effect."}</p>
              <div className={styles.metrics}>
                <span>{match.pendingDamage} damage remaining</span>
                <span>{effectiveCost} Energy to play</span>
                <span>{player.energy} Energy available</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy || !affordable}
                  onClick={() => void run(() => onResolveDamage(flip.id))}
                >
                  {affordable ? "Play Flip" : "Not Enough Energy"}
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionSecondary}`}
                  disabled={busy}
                  onClick={() => void run(() => onResolveDamage())}
                >
                  Decline • Continue Damage
                </button>
              </div>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const selected = new Set(selectedCardIds);
  const toggleCard = (cardId: string) => {
    if (busy) return;
    setSelectedCardIds((current) => {
      if (current.includes(cardId)) return current.filter((candidate) => candidate !== cardId);
      return current.length < requiredDiscards ? [...current, cardId] : current;
    });
  };

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="experimental-hand-limit-title"
      >
        <header className={styles.header}>
          <small>END PHASE • HAND LIMIT</small>
          <h2 id="experimental-hand-limit-title">Discard to seven cards</h2>
          <p>Select exactly {requiredDiscards} card{requiredDiscards === 1 ? "" : "s"}. The turn advances after the discard is confirmed.</p>
        </header>
        <ul className={styles.cards} aria-label="Cards available to discard">
          {player.hand.map((card) => {
            const isSelected = selected.has(card.id);
            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={styles.cardButton}
                  data-selected={isSelected ? "true" : "false"}
                  aria-pressed={isSelected}
                  disabled={busy || (!isSelected && selectedCardIds.length >= requiredDiscards)}
                  onClick={() => toggleCard(card.id)}
                >
                  <img src={card.art} alt="" aria-hidden="true" draggable={false} />
                  <strong>{card.displayName || card.name}</strong>
                  <span>{isSelected ? "Selected" : "Keep"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            disabled={busy || selectedCardIds.length !== requiredDiscards}
            onClick={() => void run(() => onDiscardToHandLimit(selectedCardIds))}
          >
            Discard {selectedCardIds.length}/{requiredDiscards}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
