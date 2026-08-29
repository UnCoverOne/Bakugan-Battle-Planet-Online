"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useEffect, useState, type CSSProperties } from "react";
import type { MatchState, RollOutcome } from "../../lib/game";
import { useBakuCorePresentation } from "./BakuCorePresentation";
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
  const { presentationMode } = useBakuCorePresentation();
  const replay = presentationMode === "replay";
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
  const reroll = currentRerollPlayers.size > 0;

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
        {!replay ? (
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close roll results"
            onClick={onDismiss}
          >
            ×
          </button>
        ) : null}
        <header className={styles.header}>
          <span>{reroll ? "REROLL" : "ROLLING STEP"}</span>
          <h2 id="roll-result-title">{reroll ? "Reroll Result" : "Roll Results"}</h2>
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
                        <OriginalImage src={placement.core.art} alt="" aria-hidden="true" draggable={false} />
                        <figcaption>{placement.core.name}</figcaption>
                      </figure>
                    ) : null) : <span>No BakuCore collected</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <p className={styles.dismissHint}>{replay
          ? "Click outside this window to continue the replay."
          : "Click outside this window or press × to continue."}</p>
      </section>
    </div>
  );
}
