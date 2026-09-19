"use client";

import { useEffect, useState } from "react";
import styles from "./GameMenuHud.module.css";

type AsyncAction = () => void | Promise<void>;
type SettingsTab = "Gameplay" | "Video" | "Audio" | "Accessibility";

const SETTINGS_TABS: readonly SettingsTab[] = [
  "Gameplay",
  "Video",
  "Audio",
  "Accessibility",
];

export function GameMenuHud({
  automaticDraw,
  automaticPass,
  gameSoundsEnabled,
  gameSoundVolume,
  uiSoundsEnabled,
  uiSoundVolume,
  musicEnabled,
  musicVolume,
  masterVolume,
  logDetail,
  cardScale,
  textScale,
  reducedMotion,
  highContrast,
  completed = false,
  administrator = false,
  undoAvailable,
  onAutomaticDrawChange,
  onAutomaticPassChange,
  onGameSoundsEnabledChange,
  onGameSoundVolumeChange,
  onUiSoundsEnabledChange,
  onUiSoundVolumeChange,
  onMusicEnabledChange,
  onMusicVolumeChange,
  onMasterVolumeChange,
  onLogDetailChange,
  onCardScaleChange,
  onTextScaleChange,
  onReducedMotionChange,
  onHighContrastChange,
  onUndo,
  onConcede,
  onDownloadLog,
}: {
  automaticDraw: boolean;
  automaticPass: boolean;
  gameSoundsEnabled: boolean;
  gameSoundVolume: number;
  uiSoundsEnabled: boolean;
  uiSoundVolume: number;
  musicEnabled: boolean;
  musicVolume: number;
  masterVolume: number;
  logDetail: string;
  cardScale: number;
  textScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  completed?: boolean;
  administrator?: boolean;
  undoAvailable: boolean;
  onAutomaticDrawChange: (enabled: boolean) => void;
  onAutomaticPassChange: (enabled: boolean) => void;
  onGameSoundsEnabledChange: (enabled: boolean) => void;
  onGameSoundVolumeChange: (volume: number) => void;
  onUiSoundsEnabledChange: (enabled: boolean) => void;
  onUiSoundVolumeChange: (volume: number) => void;
  onMusicEnabledChange: (enabled: boolean) => void;
  onMusicVolumeChange: (volume: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onLogDetailChange: (detail: string) => void;
  onCardScaleChange: (scale: number) => void;
  onTextScaleChange: (scale: number) => void;
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

  const percentageSlider = (
    label: string,
    copy: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <label className={styles.rangeSetting}>
      <span>
        <strong>{label}</strong>
        <small>{copy}</small>
      </span>
      <b>{value}%</b>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );

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
              <strong>Game Sounds</strong>
              <small>Play audio cues for cards, rolls, damage and turns.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={gameSoundsEnabled}
              onChange={(event) => onGameSoundsEnabledChange(event.target.checked)}
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
                <p>Adjust match preferences without leaving the table.</p>
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

                {settingsTab === "Video" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-1"
                    aria-labelledby="gameplay-settings-tab-1"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Video</strong>
                      <small>Scale previews and text, or reduce motion during play.</small>
                    </div>
                    <label className={styles.rangeSetting}>
                      <span>
                        <strong>Preview scaling</strong>
                        <small>Adjust supported card and BakuCore previews from 80% to 140%.</small>
                      </span>
                      <b>{cardScale}%</b>
                      <input
                        type="range"
                        min="80"
                        max="140"
                        value={cardScale}
                        aria-label="Preview scaling"
                        onChange={(event) => onCardScaleChange(Number(event.target.value))}
                      />
                    </label>
                    <label className={styles.rangeSetting}>
                      <span>
                        <strong>Text scaling</strong>
                        <small>Scale interface text from 80% to 140%.</small>
                      </span>
                      <b>{textScale}%</b>
                      <input
                        type="range"
                        min="80"
                        max="140"
                        value={textScale}
                        aria-label="Text scaling"
                        onChange={(event) => onTextScaleChange(Number(event.target.value))}
                      />
                    </label>
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
                  </div>
                ) : null}

                {settingsTab === "Audio" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-2"
                    aria-labelledby="gameplay-settings-tab-2"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Audio</strong>
                      <small>Control game, interface, and future music channels.</small>
                    </div>
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>Game Sounds</strong>
                        <small>Cards, rolls, damage, priority, and match-result cues.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={gameSoundsEnabled}
                        onChange={(event) => onGameSoundsEnabledChange(event.target.checked)}
                      />
                    </label>
                    {percentageSlider(
                      "Game Sounds volume",
                      "Volume for gameplay-event audio.",
                      gameSoundVolume,
                      onGameSoundVolumeChange,
                    )}
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>UI Sounds</strong>
                        <small>Interface feedback such as navigation and control cues.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={uiSoundsEnabled}
                        onChange={(event) => onUiSoundsEnabledChange(event.target.checked)}
                      />
                    </label>
                    {percentageSlider(
                      "UI Sounds volume",
                      "Volume reserved for interface feedback.",
                      uiSoundVolume,
                      onUiSoundVolumeChange,
                    )}
                    <label className={styles.toggleRow}>
                      <span>
                        <strong>Music</strong>
                        <small>Future soundtrack support; this preference is saved now.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={musicEnabled}
                        onChange={(event) => onMusicEnabledChange(event.target.checked)}
                      />
                    </label>
                    {percentageSlider(
                      "Music volume",
                      "Stored now for future soundtrack support.",
                      musicVolume,
                      onMusicVolumeChange,
                    )}
                    {percentageSlider(
                      "Master Volume",
                      "Overall output level applied to implemented audio channels.",
                      masterVolume,
                      onMasterVolumeChange,
                    )}
                  </div>
                ) : null}

                {settingsTab === "Accessibility" ? (
                  <div
                    role="tabpanel"
                    id="gameplay-settings-panel-3"
                    aria-labelledby="gameplay-settings-tab-3"
                    className={styles.settingsSection}
                  >
                    <div className={styles.settingsSectionHeading}>
                      <strong>Accessibility</strong>
                      <small>Strengthen match readability.</small>
                    </div>
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
