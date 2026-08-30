"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useEffect, useState, type CSSProperties } from "react";
import type { MatchState, RollOutcome } from "../../lib/game";
import styles from "./RollResultLayer.module.css";

function resultLabel(result: RollOutcome["result"]) {
  switch (result) {
    case "intended-core": return "Hit Target";
    case "overshoot": return "Overshot";
    case "undershoot": return "Undershot";
    case "skew-left": return "Left";
    case "skew-right": return "Right";
    case "path-intercept": return "Intercepted";
    case "open-no-core": return "Opened — No Core";
    case "miss-closed": return "Missed";
  }
}

function resultContext(outcome: RollOutcome, match: MatchState) {
  const collision = outcome.collisionDecisions?.find(
    (decision) => decision.affectedPlayerId === outcome.playerId,
  );
  if (collision?.kind === "primary-contested") {
    const winner = match.players.find((player) => player.id === collision.winnerPlayerId);
    return `${winner?.name ?? "Opponent"} won the contested Core.`;
  }
  if (collision?.kind === "secondary-yielded") {
    return "Second Core was already collected.";
  }
  if (outcome.result === "path-intercept") {
    return "Opened on an earlier Core.";
  }
  return null;
}

export function RollResultLayer({
  match,
  playerId,
  open,
  onDismiss,
}: {
  match: MatchState | null;
  playerId?: string;
  open: boolean;
  onDismiss: () => void;
}) {
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
    ?? renderedMatch.players[0];
  const currentRerollPlayers = new Set(renderedMatch.players
    .filter((player) => renderedMatch.rolls[player.id]?.rerollSequence === renderedMatch.rerollSequence)
    .map((player) => player.id));
  const orderedPlayers = [
    localPlayer,
    ...renderedMatch.players.filter((player) => player.id !== localPlayer.id),
  ].filter((player) => !currentRerollPlayers.size || currentRerollPlayers.has(player.id));

  return (
    <div
      className={styles.backdrop}
      data-state={presence}
      role="presentation"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onDismiss();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="roll-result-title"
      >
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close roll results"
          onClick={onDismiss}
        >
          ×
        </button>
        <header className={styles.header}>
          <h2 id="roll-result-title">Roll Results</h2>
        </header>
        <div className={styles.results}>
          {orderedPlayers.map((player, index) => {
            const outcome = renderedMatch.rolls[player.id];
            if (!outcome) return null;
            const bakugan = player.bakugan.find((candidate) => candidate.id === outcome.bakuganId);
            const landed = outcome.cores
              .map((cell) => renderedMatch.placements.find((placement) => placement.cell === cell))
              .filter(Boolean);
            const local = player.id === localPlayer.id;
            const context = resultContext(outcome, renderedMatch);
            return (
              <article
                className={styles.resultCard}
                data-owner={local ? "player" : "opponent"}
                style={{ "--result-order": index } as CSSProperties}
                key={player.id}
              >
                <div className={styles.bakuganArtWrap}>
                  {bakugan ? (
                    <OriginalImage
                      className={styles.bakuganArt}
                      src={bakugan.character.art || bakugan.art}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  ) : null}
                </div>
                <div className={styles.resultCopy}>
                  <div className={styles.identity}>
                    <strong>{player.name}</strong>
                    <span aria-hidden="true">•</span>
                    <span>{bakugan?.name ?? "Bakugan"}</span>
                    {local ? <small>YOU</small> : null}
                  </div>
                  <h3>{resultLabel(outcome.result)}</h3>
                  {landed.length ? (
                    <div className={styles.landedCores}>
                      {landed.map((placement) => placement ? (
                        <figure key={placement.cell}>
                          <OriginalImage src={placement.core.art} alt="" aria-hidden="true" draggable={false} />
                          <figcaption>{placement.core.name}</figcaption>
                        </figure>
                      ) : null)}
                    </div>
                  ) : null}
                  {(outcome.doubleCore || outcome.rerollSource) ? (
                    <div className={styles.badges}>
                      {outcome.doubleCore ? <span>Double Core</span> : null}
                      {outcome.rerollSource ? <span>Reroll · {outcome.rerollSource}</span> : null}
                    </div>
                  ) : null}
                  {context ? <p className={styles.resultContext}>{context}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
