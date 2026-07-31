"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import {
  ConfirmationDialog,
  SyncConflictPanel,
} from "../application/SystemState";
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
  "Audio & visual",
  "Accessibility",
  "Data & sync",
  "Privacy",
  "Danger zone",
] as const;
type Section = (typeof SECTIONS)[number];
type ConfirmAction = "local" | "account" | null;

export function SettingsScreen() {
  const router = useRouter();
  const {
    settings,
    setSettings,
    profile,
    decks,
    history,
    selectedDeckId,
    authUser,
    syncStatus,
    syncConflict,
    resolveSyncConflict,
    authError,
    storageHealth,
    signOutAccount,
    requestAccountAccess,
    syncNow,
    changePassword,
    deleteAccount,
  } = useApp();
  const [section, setSection] = useState<Section>("Account");
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

  const saveSetting = (key: string, value: unknown, label: string) => {
    setSettings({ ...settings, [key]: value });
    setSavedField(`${label} saved`);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedField(""), 2200);
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

          {section === "Audio & visual" && (
            <SettingsSection
              title="Audio & visual"
              description="Adjust feedback and card presentation."
            >
              <SettingToggle
                label="Interface and match audio"
                copy="Phase calls, priority, and result cues."
                checked={settings.sound}
                onChange={(value) => {
                  setSettings({
                    ...settings,
                    sound: value,
                    soundEnabled: value,
                  });
                  setSavedField("Audio preference saved");
                  if (savedTimer.current) clearTimeout(savedTimer.current);
                  savedTimer.current = setTimeout(
                    () => setSavedField(""),
                    2200,
                  );
                }}
              />
              <label className={styles.rangeSetting}>
                <span>
                  <strong>Card scale</strong>
                  <small>
                    Adjust supported card previews from 80% to 140%.
                  </small>
                </span>
                <b>{settings.cardScale}%</b>
                <input
                  type="range"
                  min="80"
                  max="140"
                  value={settings.cardScale}
                  onChange={(event) =>
                    saveSetting(
                      "cardScale",
                      Number(event.target.value),
                      "Card scale",
                    )
                  }
                />
              </label>
            </SettingsSection>
          )}

          {section === "Accessibility" && (
            <SettingsSection
              title="Accessibility"
              description="Reduce sensory load and strengthen interface legibility."
            >
              <SettingToggle
                label="Reduced motion"
                copy="Disable parallax, energy sweeps, card tilt, and non-essential transition travel."
                checked={settings.reducedMotion}
                onChange={(value) =>
                  saveSetting("reducedMotion", value, "Reduced motion")
                }
              />
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

          {section === "Data & sync" && (
            <SettingsSection
              title="Data & sync"
              description={
                authUser
                  ? "Review account-cloud state and resolve revision conflicts."
                  : "Review storage health and keep a portable backup."
              }
            >
              {syncConflict && (
                <SyncConflictPanel
                  conflict={syncConflict}
                  busy={accountBusy}
                  onResolve={(preference) => {
                    setAccountBusy(true);
                    void resolveSyncConflict(preference).finally(() =>
                      setAccountBusy(false),
                    );
                  }}
                />
              )}
              <Surface
                className={`${styles.syncCard} ${storageHealth.status === "error" ? styles.failed : ""}`}
              >
                <div>
                  <StatusChip
                    tone={
                      syncStatus === "synced" ||
                      storageHealth.status === "saved"
                        ? "success"
                        : syncStatus === "error" ||
                            storageHealth.status === "error"
                          ? "danger"
                          : syncStatus === "conflict"
                            ? "warning"
                            : "info"
                    }
                  >
                    {authUser ? syncStatus : storageHealth.status}
                  </StatusChip>
                  <h3>
                    {authUser ? "Cloud account data" : storageTitle}
                  </h3>
                  <p>
                    {authUser
                      ? "While logged in, the app uses account data only. Local guest data stays unchanged in this browser and returns after logout."
                      : storageHealth.message}
                  </p>
                  {storageHealth.savedAt && (
                    <small>
                      Last device save:{" "}
                      {new Date(storageHealth.savedAt).toLocaleString()}
                    </small>
                  )}
                  {authError && syncStatus === "error" && (
                    <p className={styles.error}>{authError}</p>
                  )}
                </div>
                {authUser && (
                  <ActionButton
                    tone="secondary"
                    onClick={() => void syncNow()}
                    disabled={
                      syncStatus === "saving" || syncStatus === "conflict"
                    }
                  >
                    Sync now
                  </ActionButton>
                )}
              </Surface>
              <Surface className={styles.exportCard}>
                <div>
                  <h3>{authUser ? "Export account data" : "Export local data"}</h3>
                  <p>
                    Download a readable JSON backup of the data currently in use
                    before a destructive action.
                  </p>
                </div>
                <ActionButton tone="secondary" onClick={exportData}>
                  Download export
                </ActionButton>
              </Surface>
            </SettingsSection>
          )}

          {section === "Privacy" && (
            <SettingsSection
              title="Privacy"
              description="Control what can be shared outside this device."
            >
              <SettingToggle
                label="Allow match-record links"
                copy="Enable copyable links to locally retained completed match records."
                checked={settings.replayLinks ?? true}
                onChange={(value) =>
                  saveSetting("replayLinks", value, "Match-record links")
                }
              />
              <Surface className={styles.privacyCard}>
                <h3>Public deck attribution</h3>
                <p>
                  Published decks show the creator name captured at publication.
                  Copies retain source attribution but become private, editable
                  decks.
                </p>
              </Surface>
            </SettingsSection>
          )}

          {section === "Danger zone" && (
            <SettingsSection
              title="Danger zone"
              description="Destructive actions are isolated here and never save immediately."
            >
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
