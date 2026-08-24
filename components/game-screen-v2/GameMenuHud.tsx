"use client";

import { useEffect, useState } from "react";
import styles from "./GameMenuHud.module.css";

type AsyncAction = () => void | Promise<void>;

export function GameMenuHud({
  automaticDraw,
  automaticPass,
  soundEnabled,
  completed = false,
  administrator = false,
  undoAvailable,
  onAutomaticDrawChange,
  onAutomaticPassChange,
  onSoundEnabledChange,
  onUndo,
  onConcede,
  onDownloadLog,
  onOpenSettings,
}: {
  automaticDraw: boolean;
  automaticPass: boolean;
  soundEnabled: boolean;
  completed?: boolean;
  administrator?: boolean;
  undoAvailable: boolean;
  onAutomaticDrawChange: (enabled: boolean) => void;
  onAutomaticPassChange: (enabled: boolean) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
  onUndo: AsyncAction;
  onConcede: AsyncAction;
  onDownloadLog?: AsyncAction;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingLog, setDownloadingLog] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const concede = async () => {
    if (busy || !window.confirm("Concede this game?")) return;
    setBusy(true);
    setError("");
    try {
      await onConcede();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The game could not be conceded.");
      setBusy(false);
    }
  };

  const downloadLog = async () => {
    if (!onDownloadLog || downloadingLog) return;
    setDownloadingLog(true);
    setError("");
    try {
      await onDownloadLog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The engine history could not be downloaded.");
    } finally {
      setDownloadingLog(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.menuButton}
        aria-label="Open match menu"
        aria-expanded={open}
        aria-controls="game-menu-drawer"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">☰</span>
        <strong>MENU</strong>
      </button>

      <div
        className={styles.scrim}
        data-open={open ? "true" : "false"}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <aside
        id="game-menu-drawer"
        className={styles.drawer}
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
        aria-label="Match menu"
      >
        <header>
          <div>
            <small>MATCH MENU</small>
            <strong>BRAWLER OPTIONS</strong>
          </div>
          <button type="button" aria-label="Close match menu" onClick={() => setOpen(false)}>×</button>
        </header>

        <div className={styles.options}>
          <label className={styles.toggleRow}>
            <span>
              <strong>Automatic Draw</strong>
              <small>Draw immediately when the Draw Step begins.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={automaticDraw}
              onChange={(event) => onAutomaticDrawChange(event.target.checked)}
            />
          </label>

          <label className={styles.toggleRow}>
            <span>
              <strong>Gameplay Sounds</strong>
              <small>Play lightweight cues for cards, rolls, damage and turns.</small>
            </span>
            <input type="checkbox" role="switch" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} />
          </label>

          <label className={styles.toggleRow}>
            <span>
              <strong>Automatic Pass</strong>
              <small>Pass priority when no playable action is available.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={automaticPass}
              onChange={(event) => onAutomaticPassChange(event.target.checked)}
            />
          </label>
        </div>

        <div className={styles.menuActions}>
          {administrator && onDownloadLog ? (
            <button type="button" disabled={downloadingLog} onClick={() => void downloadLog()}>
              {downloadingLog ? "Downloading Log…" : "Download Log"}
            </button>
          ) : null}
          {!completed ? (
            <button type="button" disabled={busy || !undoAvailable} onClick={() => void onUndo()}>
              Undo Latest Card
            </button>
          ) : null}
          <button type="button" className={styles.settingsButton} onClick={onOpenSettings}>
            Settings
          </button>
          {!completed ? (
            <button type="button" className={styles.concedeButton} disabled={busy} onClick={() => void concede()}>
              {busy ? "Conceding…" : "Concede"}
            </button>
          ) : null}
        </div>

        {error ? <p role="alert">{error}</p> : null}
      </aside>
    </>
  );
}

