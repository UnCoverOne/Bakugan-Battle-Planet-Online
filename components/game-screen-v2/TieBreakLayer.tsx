"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MatchState } from "../../lib/game";
import {
  manualTieBreakState,
  playerCanFlipTieBreak,
  type TieBreakReveal,
} from "../../lib/manualTieBreak";
import styles from "./TieBreakLayer.module.css";

const CARD_BACK_ART = "/assets/card-back.png";
const RESOLVED_PRESENTATION_MS = 2_600;

type TieBreakAction = () => void | Promise<void>;

function energyLabel(reveal: TieBreakReveal) {
  return reveal.card.cost === "X" ? "0 (X)" : String(reveal.cost);
}

export function TieBreakLayer({
  match,
  playerId,
  onFlipTieBreakCard,
}: {
  match: MatchState | null;
  playerId?: string;
  onFlipTieBreakCard: TieBreakAction;
}) {
  const [mounted, setMounted] = useState(false);
  const [deckZone, setDeckZone] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const tieBreak = manualTieBreakState(match);
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const canFlip = playerCanFlipTieBreak(match, localPlayerId);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    setDeckZone(document.querySelector<HTMLElement>('[data-zone-id="player-deck"]'));
  }, [match?.id, match?.version]);

  useEffect(() => {
    if (!deckZone) return;
    if (canFlip) deckZone.dataset.tieBreakActive = "true";
    else delete deckZone.dataset.tieBreakActive;
    return () => { delete deckZone.dataset.tieBreakActive; };
  }, [canFlip, deckZone]);

  useEffect(() => setError(""), [match?.version]);

  useEffect(() => {
    if (!tieBreak?.resolvedAt) return;
    const remaining = Math.max(0, tieBreak.resolvedAt + RESOLVED_PRESENTATION_MS - Date.now());
    const timeout = window.setTimeout(() => setClock(Date.now()), remaining + 20);
    return () => window.clearTimeout(timeout);
  }, [tieBreak?.resolvedAt]);

  const visible = Boolean(
    tieBreak
    && (
      tieBreak.status === "waiting"
      || (tieBreak.resolvedAt ?? 0) + RESOLVED_PRESENTATION_MS > clock
    ),
  );
  const currentRevealCount = tieBreak ? Object.keys(tieBreak.current).length : 0;
  const showingPreviousTie = Boolean(
    tieBreak?.status === "waiting"
    && currentRevealCount === 0
    && tieBreak.lastRound?.tied,
  );

  const displayedReveals = useMemo(() => {
    if (!tieBreak) return {} as Record<string, TieBreakReveal | undefined>;
    const source = showingPreviousTie ? tieBreak.lastRound?.reveals : tieBreak.current;
    return Object.fromEntries(
      (match?.players ?? []).map((player) => [player.id, source?.[player.id]]),
    );
  }, [match?.players, showingPreviousTie, tieBreak]);

  if (!mounted || !tieBreak || !visible || !match) return null;

  const localPlayer = match.players.find((player) => player.id === localPlayerId);
  const winner = match.players.find((player) => player.id === tieBreak.winnerId);
  const firstCurrentReveal = Object.values(tieBreak.current)[0];
  const repeatedCost = showingPreviousTie
    ? Object.values(tieBreak.lastRound?.reveals ?? {})[0]?.cost
    : undefined;
  const status = tieBreak.status === "resolved" && winner
    ? `${winner.name} flipped the higher Energy cost and is the Brawl Victor.`
    : showingPreviousTie
      ? `Both cards cost ${repeatedCost ?? 0} Energy. Flip the next cards.`
      : currentRevealCount === 1
        ? `${firstCurrentReveal?.card.displayName || firstCurrentReveal?.card.name} was revealed. Waiting for the other player.`
        : canFlip
          ? "Click your Deck on the playmat to flip its top card."
          : `${localPlayer?.name ?? "Your player"} has flipped. Waiting for the other player.`;

  const flipNext = async () => {
    if (!canFlip || busy) return;
    setBusy(true);
    setError("");
    try {
      await onFlipTieBreakCard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tie-break card could not be flipped.");
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
          aria-label={`Flip the top card of your deck for tie-break round ${tieBreak.round}.`}
        >
          <strong>TIE</strong>
          <span>FLIP TOP CARD</span>
        </button>,
        deckZone,
      ) : null}

      {createPortal(
        <div className={styles.overlay} role="presentation">
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tie-break-title"
            aria-describedby="tie-break-status"
          >
            <header>
              <span>BRAWL TIE-BREAK · ROUND {tieBreak.round}</span>
              <h2 id="tie-break-title">{tieBreak.decidingStat.toUpperCase()} TIE</h2>
              <p id="tie-break-status" aria-live="polite">{status}</p>
            </header>

            <div className={styles.cardSlots}>
              {match.players.map((player) => {
                const reveal = displayedReveals[player.id];
                const isWinner = tieBreak.status === "resolved" && tieBreak.winnerId === player.id;
                const isTied = showingPreviousTie && Boolean(reveal);
                const isLocal = player.id === localPlayerId;
                return (
                  <article
                    className={`${styles.cardSlot} ${isWinner ? styles.cardSlotWinner : ""} ${isTied ? styles.cardSlotTied : ""}`}
                    key={player.id}
                  >
                    <div className={styles.playerLabel}>
                      <strong>{player.name}</strong>
                      <span>{isLocal ? "YOU" : "OPPONENT"}</span>
                    </div>
                    <div className={styles.cardFrame}>
                      <img
                        src={reveal?.card.art ?? CARD_BACK_ART}
                        alt={reveal ? reveal.card.displayName || reveal.card.name : "Face-down top card"}
                        draggable={false}
                      />
                      {reveal ? (
                        <div className={styles.energyBadge}>
                          <span>ENERGY</span>
                          <strong>{energyLabel(reveal)}</strong>
                        </div>
                      ) : (
                        <div className={styles.waitingBadge}>
                          {isLocal && canFlip ? "CLICK YOUR DECK" : "WAITING FOR FLIP"}
                        </div>
                      )}
                      {isWinner ? <div className={styles.higherCost}>HIGHER COST</div> : null}
                      {isTied ? <div className={styles.equalCost}>EQUAL COST</div> : null}
                    </div>
                    <footer>
                      {reveal
                        ? <><strong>{reveal.card.displayName || reveal.card.name}</strong><span>Moved to Discard Pile</span></>
                        : <><strong>Top card hidden</strong><span>{player.deck} cards remain</span></>}
                    </footer>
                  </article>
                );
              })}
            </div>

            <div className={`${styles.outcome} ${tieBreak.status === "resolved" ? styles.outcomeResolved : ""}`}>
              {tieBreak.status === "resolved" && winner
                ? <><strong>{winner.name} is Victor</strong><span>The Brawl continues to the Victor Step.</span></>
                : <><strong>{showingPreviousTie ? "Tie again" : "Highest Energy cost wins"}</strong><span>X counts as 0 Energy.</span></>}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {error ? createPortal(
        <div className={styles.errorPopup} role="alert">
          <strong>Tie-break</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss tie-break error">×</button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
