"use client";

import { useEffect, useState } from "react";
import styles from "./GameMenuHud.module.css";

type AsyncAction = () => void | Promise<void>;
type SettingsTab = "Gameplay" | "Audio & visual" | "Accessibility";

const SETTINGS_TABS: readonly SettingsTab[] = [
  "Gameplay",
  "Audio & visual",
  "Accessibility",
];

export function GameMenuHud({
  automaticDraw,
  automaticPass,
  soundEnabled,
  logDetail,
  cardScale,
  reducedMotion,
  highContrast,
  completed = false,
  administrator = false,
  undoAvailable,
  onAutomaticDrawChange,
  onAutomaticPassChange,
  onSoundEnabledChange,
  onLogDetailChange,
  onCardScaleChange,
  onReducedMotionChange,
  onHighContrastChange,
  onUndo,
  onConcede,
  onDownloadLog,
}: {
  automaticDraw: boolean;
  automaticPass: boolean;
  soundEnabled: boolean;
  logDetail: string;
  cardScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  completed?: boolean;
  administrator?: boolean;
  undoAvailable: boolean;
  onAutomaticDrawChange: (enabled: boolean) => void;
  onAutomaticPassChange: (enabled: boolean) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
  onLogDetailChange: (detail: string) => void;
  onCardScaleChange: (scale: number) => void;
  onReducedMotionChange: (enabled: boolean) => void;
  onHighContrastChange: (enabled: boolean) => void;
  onUndo: AsyncAction;
  onConcede: AsyncAction;
  onDownloadLog?: AsyncAction;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("Gameplay");
  const [busy, setBusy] = useState(false);
  const [downloadingLog, setDownloadingLog] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open && !settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, settingsOpen]);

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

  const openGameplaySettings = () => {
    setOpen(false);
    setSettingsTab("Gameplay");
    setSettingsOpen(true);
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
              <small>Pass priority only when no other legal action is available.</small>
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
          <button type="button" className={styles.settingsButton} onClick={openGameplaySettings}>
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

      {settingsOpen ? (
        <div className={styles.settingsOverlay} role="presentation">
          <button
            type="button"
            className={styles.settingsBackdrop}
            aria-label="Close gameplay settings"
            onClick={() => setSettingsOpen(false)}
          />
          <section
            className={styles.settingsDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gameplay-settings-title"
          >
            <header className={styles.settingsHeader}>
              <div>
                <small>MATCH SETTINGS</small>
                <h2 id="gameplay-settings-title">GAMEPLAY SETTINGS</h2>
                <p>Adjust match-only preferences without leaving the table.</p>
              </div>
              <button
                type="button"
                className={styles.settingsClose}
                aria-label="Close gameplay settings"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>

            <div className={styles.settingsBody}>
              <nav className={styles.settingsTabs} role="tablist" aria-label="Gameplay settings categories">
                {SETTINGS_TABS.map((tab, index) => (
                  <button
                    type="button"
                    role="tab"
                    id={`gameplay-settings-tab-${index}`}
                    aria-selected={settingsTab === tab}
                    aria-controls={`gameplay-settings-panel-${index}`}
                    autoFocus={index === 0}
                    data-active={settingsTab === tab ? "true" : "false"}
                    key={tab}
                    onClick={() => setSettingsTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </nav>

              <div className={styles.settingsPanel}>
                {settingsTab === "Gameplay" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-0"
                    aria-labelledby="gameplay-settings-tab-0"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Gameplay</strong>
                      <small>Automation and supporting match information.</small>
                    </div>
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>Automatic Draw</strong>
                        <small>Draw immediately when the Draw Step begins, while preserving the normal draw animation.</small>
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
                        <strong>Automatic Pass</strong>
                        <small>Pass priority only when no other legal action is available.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={automaticPass}
                        onChange={(event) => onAutomaticPassChange(event.target.checked)}
                      />
                    </label>
                    <label className={styles.selectSetting}>
                      <span>
                        <strong>Match-log detail</strong>
                        <small>Choose how much supporting event detail the match log shows.</small>
                      </span>
                      <select value={logDetail} onChange={(event) => onLogDetailChange(event.target.value)}>
                        <option>All events</option>
                        <option>Gameplay only</option>
                        <option>Random results</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {settingsTab === "Audio & visual" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-1"
                    aria-labelledby="gameplay-settings-tab-1"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Audio & visual</strong>
                      <small>Adjust feedback and card presentation during play.</small>
                    </div>
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>Gameplay Sounds</strong>
                        <small>Play cues for cards, rolls, damage, priority, and turns.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={soundEnabled}
                        onChange={(event) => onSoundEnabledChange(event.target.checked)}
                      />
                    </label>
                    <label className={styles.rangeSetting}>
                      <span>
                        <strong>Card scale</strong>
                        <small>Adjust supported card previews from 80% to 140%.</small>
                      </span>
                      <b>{cardScale}%</b>
                      <input
                        type="range"
                        min="80"
                        max="140"
                        value={cardScale}
                        onChange={(event) => onCardScaleChange(Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}

                {settingsTab === "Accessibility" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-2"
                    aria-labelledby="gameplay-settings-tab-2"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Accessibility</strong>
                      <small>Reduce sensory load and strengthen match readability.</small>
                    </div>
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>Reduced motion</strong>
                        <small>Disable non-essential movement and transitions.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={reducedMotion}
                        onChange={(event) => onReducedMotionChange(event.target.checked)}
                      />
                    </label>
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>High contrast</strong>
                        <small>Increase panel, border, selection, and focus contrast.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={highContrast}
                        onChange={(event) => onHighContrastChange(event.target.checked)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
