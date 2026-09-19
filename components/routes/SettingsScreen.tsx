"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../application/AppProvider";
import { ConfirmationDialog } from "../application/SystemState";
import { downloadTextFile } from "../application/ui";
import {
  ActionButton,
  Field,
  RouteHero,
  StatusChip,
  Surface,
} from "../design-system/primitives";
import styles from "./SettingsScreen.module.css";

const SECTIONS = [
  "Account",
  "Gameplay",
  "Video",
  "Audio",
  "Accessibility",
] as const;
type Section = (typeof SECTIONS)[number];
type ConfirmAction = "local" | "account" | null;

export function SettingsScreen() {
  const {
    settings,
    setSettings,
    profile,
    decks,
    history,
    selectedDeckId,
    authUser,
    syncStatus,
    storageHealth,
    signOutAccount,
    saveAccountProfile,
    requestAccountAccess,
    changePassword,
    deleteAccount,
    collection,
  } = useApp();
  const [section, setSection] = useState<Section>("Account");
  const [brawlerName, setBrawlerName] = useState(profile.name);
  const [savedField, setSavedField] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [accountError, setAccountError] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  useEffect(() => {
    setBrawlerName(profile.name);
  }, [profile.name]);

  const saveSettingsPatch = (patch: Record<string, unknown>, label: string) => {
    setSettings({ ...settings, ...patch });
    setSavedField(`${label} saved`);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedField(""), 2200);
  };

  const saveSetting = (key: string, value: unknown, label: string) => {
    saveSettingsPatch({ [key]: value }, label);
  };

  const submitBrawlerName = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedBrawlerName = brawlerName.trim().replace(/\s+/g, " ");
    if (!normalizedBrawlerName || normalizedBrawlerName.length > 20) {
      setAccountError("Brawler Name must be between 1 and 20 characters.");
      return;
    }
    setAccountBusy(true);
    setAccountError("");
    try {
      await saveAccountProfile({ displayName: normalizedBrawlerName });
      setBrawlerName(normalizedBrawlerName);
      setSavedField("Brawler Name updated");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedField(""), 2200);
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : "Could not update the Brawler Name.",
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError("");
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setSavedField("Password updated");
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not change password.",
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const removeAccount = async () => {
    setAccountBusy(true);
    setAccountError("");
    try {
      await deleteAccount(confirmation);
      setConfirmAction(null);
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not delete account.",
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const clearLocalProfile = () => {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith("bbp-")) storage.removeItem(key);
      }
    }
    window.location.assign("/");
  };

  const exportData = () => {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: profile.name, faction: profile.faction },
      decks,
      history,
      settings,
      selectedDeckId,
      collection,
    };
    downloadTextFile(
      `bakugan-brawler-data-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    setSavedField("Data export downloaded");
  };

  const storageTitle =
    storageHealth.status === "error"
      ? "Latest changes not saved"
      : storageHealth.status === "saved"
        ? "Saved on this device"
        : "Local storage ready";

  return (
    <div className={styles.route}>
      <RouteHero
        className={styles.hero}
        eyebrow="Client preferences"
        title="Settings"
        description="Preferences save immediately. Identity, password, and destructive changes always require an explicit action."
        aside={
          <div className={styles.saveStatus} role="status" aria-live="polite">
            <StatusChip tone={savedField ? "success" : "neutral"}>
              {savedField || "Ready"}
            </StatusChip>
            <small>{authUser ? `Cloud: ${syncStatus}` : storageTitle}</small>
          </div>
        }
      />
      <section className={styles.layout}>
        <nav className={styles.sectionNav} aria-label="Settings categories">
          {SECTIONS.map((item) => (
            <button
              type="button"
              aria-current={section === item ? "page" : undefined}
              className={section === item ? styles.active : ""}
              key={item}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <main className={styles.content}>
          {section === "Account" && (
            <SettingsSection
              title="Account"
              description="Manage the signed-in account and credentials."
            >
              <form
                className={styles.passwordForm}
                onSubmit={submitBrawlerName}
              >
                <h3>Brawler Name</h3>
                <Field
                  label="Brawler Name"
                  hint={
                    authUser
                      ? "Shown on your Profile, published identity, and matches. Use 1–20 characters."
                      : "Shown on this device in your Profile and matches. Use 1–20 characters."
                  }
                >
                  <input
                    type="text"
                    autoComplete="nickname"
                    minLength={1}
                    maxLength={20}
                    value={brawlerName}
                    onChange={(event) => setBrawlerName(event.target.value)}
                    required
                  />
                </Field>
                <ActionButton
                  type="submit"
                  tone="secondary"
                  disabled={
                    accountBusy ||
                    !brawlerName.trim() ||
                    brawlerName.trim().replace(/\s+/g, " ") === profile.name
                  }
                >
                  Update Brawler Name
                </ActionButton>
              </form>
              {authUser ? (
                <>
                  <Surface className={styles.accountSummary}>
                    <div>
                      <span>Signed in as</span>
                      <strong>{authUser.email}</strong>
                    </div>
                    <ActionButton
                      tone="secondary"
                      onClick={() => void signOutAccount()}
                    >
                      Log out
                    </ActionButton>
                  </Surface>
                  <form
                    className={styles.passwordForm}
                    onSubmit={submitPassword}
                  >
                    <h3>Change password</h3>
                    <Field label="Current password">
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                        required
                      />
                    </Field>
                    <Field label="New password" hint="Use 10–128 characters.">
                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={10}
                        maxLength={128}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                      />
                    </Field>
                    <ActionButton
                      type="submit"
                      tone="secondary"
                      disabled={accountBusy}
                    >
                      Update password
                    </ActionButton>
                  </form>
                </>
              ) : (
                <Surface className={styles.callout}>
                  <div>
                    <strong>Device-local profile</strong>
                    <p>
                      Sign in to sync decks, records, settings, and drafts
                      between devices.
                    </p>
                  </div>
                  <ActionButton onClick={() => requestAccountAccess("signup")}>
                    Register or log in
                  </ActionButton>
                </Surface>
              )}

              {authUser && (
                <Surface className={styles.dangerCard}>
                  <div>
                    <h3>Delete cloud account</h3>
                    <p>
                      Removes the account and its cloud data. The separate local
                      guest data remains until deleted explicitly.
                    </p>
                    <Field label="Type DELETE to enable">
                      <input
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                      />
                    </Field>
                  </div>
                  <ActionButton
                    tone="danger"
                    disabled={
                      accountBusy || confirmation.toUpperCase() !== "DELETE"
                    }
                    onClick={() => setConfirmAction("account")}
                  >
                    Delete cloud account
                  </ActionButton>
                </Surface>
              )}

              <Surface className={styles.dangerCard}>
                <div>
                  <h3>Delete local browser data</h3>
                  <p>
                    Removes the separate guest decks, records, settings, drafts,
                    and active state saved in this browser. Signed-in account
                    data is unaffected.
                  </p>
                </div>
                <div className={styles.dangerActions}>
                  <ActionButton tone="secondary" onClick={exportData}>
                    Export first
                  </ActionButton>
                  <ActionButton
                    tone="danger"
                    onClick={() => setConfirmAction("local")}
                  >
                    Delete local data
                  </ActionButton>
                </div>
              </Surface>

              {accountError && (
                <p className={styles.error} role="alert">
                  {accountError}
                </p>
              )}
            </SettingsSection>
          )}

          {section === "Gameplay" && (
            <SettingsSection
              title="Gameplay"
              description="Control supporting information around matches."
            >
              <Field label="Default match-log detail">
                <select
                  value={settings.logDetail}
                  onChange={(event) =>
                    saveSetting(
                      "logDetail",
                      event.target.value,
                      "Match-log detail",
                    )
                  }
                >
                  <option>All events</option>
                  <option>Gameplay only</option>
                  <option>Random results</option>
                </select>
              </Field>
              <p className={styles.note}>
                This changes supporting match information only; the current
                Match screen composition remains unchanged.
              </p>
            </SettingsSection>
          )}

          {section === "Video" && (
            <SettingsSection
              title="Video"
              description="Adjust match presentation, preview size, and motion."
            >
              <label className={styles.rangeSetting}>
                <span>
                  <strong>Preview scaling</strong>
                  <small>Adjust supported card and BakuCore previews from 80% to 140%.</small>
                </span>
                <b>{settings.cardScale}%</b>
                <input
                  type="range"
                  min="80"
                  max="140"
                  value={settings.cardScale}
                  onChange={(event) =>
                    saveSetting("cardScale", Number(event.target.value), "Preview scaling")
                  }
                />
              </label>
              <label className={styles.rangeSetting}>
                <span>
                  <strong>Text scaling</strong>
                  <small>Scale interface text from 80% to 140%.</small>
                </span>
                <b>{settings.textScale}%</b>
                <input
                  type="range"
                  min="80"
                  max="140"
                  value={settings.textScale}
                  onChange={(event) =>
                    saveSetting("textScale", Number(event.target.value), "Text scaling")
                  }
                />
              </label>
              <SettingToggle
                label="Reduced motion"
                copy="Disable parallax, energy sweeps, card tilt, and non-essential transition travel."
                checked={settings.reducedMotion}
                onChange={(value) =>
                  saveSetting("reducedMotion", value, "Reduced motion")
                }
              />
            </SettingsSection>
          )}

          {section === "Audio" && (
            <SettingsSection
              title="Audio"
              description="Control game, interface, and future music channels."
            >
              <SettingToggle
                label="Game Sounds"
                copy="Cards, rolls, damage, priority, and match-result cues."
                checked={settings.gameSoundsEnabled}
                onChange={(value) =>
                  saveSettingsPatch(
                    { gameSoundsEnabled: value, soundEnabled: value, sound: value },
                    "Game Sounds",
                  )
                }
              />
              <label className={styles.rangeSetting}>
                <span>
                  <strong>Game Sounds volume</strong>
                  <small>Volume for gameplay-event audio.</small>
                </span>
                <b>{settings.gameSoundVolume}%</b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.gameSoundVolume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    saveSettingsPatch(
                      { gameSoundVolume: value, soundVolume: value / 100 },
                      "Game Sounds volume",
                    );
                  }}
                />
              </label>

              <SettingToggle
                label="UI Sounds"
                copy="Interface feedback such as navigation and control cues."
                checked={settings.uiSoundsEnabled}
                onChange={(value) => saveSetting("uiSoundsEnabled", value, "UI Sounds")}
              />
              <label className={styles.rangeSetting}>
                <span>
                  <strong>UI Sounds volume</strong>
                  <small>Volume reserved for interface feedback.</small>
                </span>
                <b>{settings.uiSoundVolume}%</b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.uiSoundVolume}
                  onChange={(event) =>
                    saveSetting("uiSoundVolume", Number(event.target.value), "UI Sounds volume")
                  }
                />
              </label>

              <SettingToggle
                label="Music"
                copy="Enable soundtrack playback when music support is added."
                checked={settings.musicEnabled}
                onChange={(value) => saveSetting("musicEnabled", value, "Music")}
              />
              <label className={styles.rangeSetting}>
                <span>
                  <strong>Music volume</strong>
                  <small>Stored now for future soundtrack support.</small>
                </span>
                <b>{settings.musicVolume}%</b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.musicVolume}
                  onChange={(event) =>
                    saveSetting("musicVolume", Number(event.target.value), "Music volume")
                  }
                />
              </label>

              <label className={styles.rangeSetting}>
                <span>
                  <strong>Master Volume</strong>
                  <small>Overall output level applied to implemented audio channels.</small>
                </span>
                <b>{settings.masterVolume}%</b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.masterVolume}
                  onChange={(event) =>
                    saveSetting("masterVolume", Number(event.target.value), "Master Volume")
                  }
                />
              </label>
              <p className={styles.note}>
                Music playback is not implemented yet; its toggle and volume are saved for future support.
              </p>
            </SettingsSection>
          )}

          {section === "Accessibility" && (
            <SettingsSection
              title="Accessibility"
              description="Strengthen interface legibility and assistive navigation."
            >
              <SettingToggle
                label="High contrast"
                copy="Increase panel, border, selection, and focus contrast."
                checked={settings.highContrast}
                onChange={(value) =>
                  saveSetting("highContrast", value, "High contrast")
                }
              />
              <Surface className={styles.accessibilityNote}>
                <strong>Keyboard and screen-reader support</strong>
                <p>
                  Route announcements, skip navigation, visible focus
                  indicators, labelled filters, and meaningful state messages
                  are always enabled.
                </p>
              </Surface>
            </SettingsSection>
          )}

        </main>
      </section>

      {confirmAction === "local" && (
        <ConfirmationDialog
          title="Delete local browser data?"
          objectName="All Bakugan Battle Planet Online data on this browser"
          consequence="Guest decks, records, settings, drafts, and active state in this browser will be permanently removed. Account cloud data is unaffected."
          confirmLabel="Delete local data"
          onCancel={() => setConfirmAction(null)}
          onConfirm={clearLocalProfile}
        />
      )}
      {confirmAction === "account" && (
        <ConfirmationDialog
          title="Delete cloud account?"
          objectName={authUser?.email ?? "Current account"}
          consequence="The account and its cloud data will be permanently removed. The separate guest data in this browser remains until explicitly deleted."
          confirmLabel="Delete cloud account"
          busy={accountBusy}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void removeAccount()}
        />
      )}
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.settingsSection}>
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function SettingToggle({
  label,
  copy,
  checked,
  onChange,
}: {
  label: string;
  copy: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.toggle}>
      <span>
        <strong>{label}</strong>
        <small>{copy}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
