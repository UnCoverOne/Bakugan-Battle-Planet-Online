"use client";

import { useEffect, useMemo, useState } from "react";
import { type MatchState } from "../../lib/game";
import { dispatchLocalGameAction } from "../../lib/engine/local-command-dispatcher";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import styles from "./MatchDecisionLayer.module.css";

type DecisionState = {
  active: boolean;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

/**
 * Flip decisions are now presented by the permanent Action HUD. This layer is
 * retained only for the end-of-turn hand-limit choice.
 */
export function MatchDecisionLayer() {
  const decision = useMatchSelector((state): DecisionState => ({
    active: state.route === "match",
    match: state.match,
    online: state.online,
    playerId: state.playerId,
  }));
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const match = decision.match;
  const player = match?.players.find((candidate) => candidate.id === decision.playerId)
    ?? match?.players[0];
  const requiredDiscards = decision.active
    && match
    && player
    && match.phase === "handLimit"
    && match.priority === player.id
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

  if (!decision.active || !match || !player || requiredDiscards <= 0) return null;

  const submit = async (
    payload: Record<string, unknown>,
  ) => {
    const current = readMatchStore();
    const currentMatch = current.match;
    const actorId = current.playerId ?? currentMatch?.players[0]?.id;
    if (!currentMatch || !actorId) throw new Error("No active match is available.");

    if (!current.online) {
      if (!writeCoordinatedMatch(dispatchLocalGameAction(currentMatch, actorId, "hand-limit", payload))) {
        throw new Error("The match changed before the decision was applied.");
      }
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", ...(current.capability ? { "x-match-capability": current.capability } : {}) },
      body: JSON.stringify({
        action: "hand-limit",
        code: currentMatch.code,
        playerId: actorId,
        expectedVersion: currentMatch.version,
        payload,
      }),
    });
    const data = await response.json() as { state?: MatchState; error?: string };
    if (data.state) writeCoordinatedMatch(data.state);
    if (!response.ok) throw new Error(data.error ?? "The match decision could not be completed.");
  };

  const run = async () => {
    if (busy || selectedCardIds.length !== requiredDiscards) return;
    setBusy(true);
    setError("");
    try {
      await submit({ cardIds: selectedCardIds });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be completed.");
    } finally {
      setBusy(false);
    }
  };

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
        aria-labelledby="hand-limit-title"
      >
        <header className={styles.header}>
          <small>END PHASE • HAND LIMIT</small>
          <h2 id="hand-limit-title">Discard to seven cards</h2>
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
            onClick={() => void run()}
          >
            Discard {selectedCardIds.length}/{requiredDiscards}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
