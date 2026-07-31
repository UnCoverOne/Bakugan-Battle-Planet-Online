"use client";

import type { CSSProperties } from "react";
import type { MatchState, RollOutcome } from "../../lib/game";
import styles from "./RollResultLayer.module.css";

function resultLabel(result: RollOutcome["result"]) {
  switch (result) {
    case "intended-core": return "Intended BakuCore";
    case "overshoot": return "Overshoot";
    case "undershoot": return "Undershoot";
    case "skew-left": return "Skewed Left";
    case "skew-right": return "Skewed Right";
    case "path-intercept": return "Magnet-Phase Intercept";
    case "open-no-core": return "Opened — No BakuCore";
    case "miss-closed": return "Missed — Remained Closed";
  }
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
  if (!open || !match?.players.length) return null;
  const localPlayer = match.players.find((player) => player.id === playerId)
    ?? match.players[0];
  const currentRerollPlayers = new Set(match.players
    .filter((player) => match.rolls[player.id]?.rerollSequence === match.rerollSequence)
    .map((player) => player.id));
  const orderedPlayers = [
    localPlayer,
    ...match.players.filter((player) => player.id !== localPlayer.id),
  ].filter((player) => !currentRerollPlayers.size || currentRerollPlayers.has(player.id));
  const reroll = currentRerollPlayers.size > 0;

  return (
    <div
      className={styles.backdrop}
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
          <span>{reroll ? "REROLL" : "ROLLING STEP"}</span>
          <h2 id="roll-result-title">{reroll ? "Reroll Result" : "Roll Results"}</h2>
        </header>
        <div className={styles.results}>
          {orderedPlayers.map((player, index) => {
            const outcome = match.rolls[player.id];
            if (!outcome) return null;
            const bakugan = player.bakugan.find((candidate) => candidate.id === outcome.bakuganId);
            const landed = outcome.cores
              .map((cell) => match.placements.find((placement) => placement.cell === cell))
              .filter(Boolean);
            const local = player.id === localPlayer.id;
            return (
              <article
                className={styles.resultCard}
                data-owner={local ? "player" : "opponent"}
                style={{ "--result-order": index } as CSSProperties}
                key={player.id}
              >
                <div className={styles.bakuganArtWrap}>
                  {bakugan ? (
                    <img
                      className={styles.bakuganArt}
                      src={bakugan.character.art || bakugan.art}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  ) : null}
                </div>
                <div className={styles.resultCopy}>
                  <small>{outcome.rerollSource ? `REROLL • ${outcome.rerollSource}` : local ? "PLAYER" : "OPPONENT"}</small>
                  <strong>{player.name}</strong>
                  <h3>{resultLabel(outcome.result)}</h3>
                  <p>{bakugan?.name ?? "Bakugan"}</p>
                  <dl>
                    <div><dt>Accuracy</dt><dd>{outcome.accuracyRoll} / {bakugan?.rollAccuracy ?? 0}</dd></div>
                    <div><dt>Double</dt><dd>{outcome.doubleRoll} / {bakugan?.doubleCoreChance ?? 0}</dd></div>
                  </dl>
                  {outcome.doubleCore ? (
                    <span className={styles.doubleCoreBadge}>Second BakuCore picked up</span>
                  ) : null}
                  <p className={styles.resultNote}>{outcome.note}</p>
                  <div className={styles.landedCores} data-empty={landed.length ? "false" : "true"}>
                    {landed.length ? landed.map((placement) => placement ? (
                      <figure key={placement.cell}>
                        <img src={placement.core.art} alt="" aria-hidden="true" draggable={false} />
                        <figcaption>{placement.core.name}</figcaption>
                      </figure>
                    ) : null) : <span>No BakuCore collected</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <p className={styles.dismissHint}>Click outside this window or press × to continue.</p>
      </section>
    </div>
  );
}

