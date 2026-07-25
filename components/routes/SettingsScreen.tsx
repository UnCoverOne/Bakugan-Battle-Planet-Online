"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, PageHeader, Toggle } from "../application/ui";

export function SettingsScreen() {
  const router = useRouter();
  const { settings, setSettings, authUser, syncStatus, authError, storageHealth, signOutAccount, syncNow, changePassword, deleteAccount } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const clearLocalProfile = () => { if (window.confirm("Delete all Bakugan TCG Online data stored in this browser?")) { localStorage.clear(); window.location.reload(); } };
  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault(); setAccountBusy(true); setAccountError("");
    try { await changePassword(currentPassword, newPassword); setCurrentPassword(""); setNewPassword(""); }
    catch (error) { setAccountError(error instanceof Error ? error.message : "Could not change password."); }
    finally { setAccountBusy(false); }
  };
  const removeAccount = async () => {
    setAccountBusy(true); setAccountError("");
    try { await deleteAccount(confirmation); }
    catch (error) { setAccountError(error instanceof Error ? error.message : "Could not delete account."); }
    finally { setAccountBusy(false); }
  };
  return <>
    <PageHeader eyebrow="CLIENT PREFERENCES" title="SETTINGS" copy="Accessibility, audio, display, privacy, local storage, cloud sync, and account controls." art="/assets/haos.png" />
    <section className="settings-grid"><article className="panel"><h2>ACCESSIBILITY</h2><Toggle label="Reduced motion" copy="Replace camera moves and flashes with static emphasis." checked={settings.reducedMotion} onChange={(value) => setSettings({ ...settings, reducedMotion: value })} /><Toggle label="High contrast" copy="Increase panel, border, and focus contrast." checked={settings.highContrast} onChange={(value) => setSettings({ ...settings, highContrast: value })} /><label className="range-setting"><span>Card scale <b>{settings.cardScale}%</b></span><input type="range" min="80" max="140" value={settings.cardScale} onChange={(event) => setSettings({ ...settings, cardScale: Number(event.target.value) })} /></label></article><article className="panel"><h2>AUDIO & MATCH LOG</h2><Toggle label="Interface and match audio" copy="Phase calls, priority, and result cues." checked={settings.sound} onChange={(value) => setSettings({ ...settings, sound: value, soundEnabled: value })} /><label>DEFAULT LOG DETAIL<select value={settings.logDetail} onChange={(event) => setSettings({ ...settings, logDetail: event.target.value })}><option>All events</option><option>Gameplay only</option><option>Random results</option></select></label></article><article className="panel"><h2>PRIVACY</h2><Toggle label="Allow replay links" copy="Enable copyable links to locally retained completed match records." checked={settings.replayLinks ?? true} onChange={(value) => setSettings({ ...settings, replayLinks: value })} /><p className="small-note">Friend challenges and block management are not advertised until the supporting social service exists.</p></article>
      <article className="panel account-management"><div className="panel-heading"><div><span className="eyebrow">DATA & ACCOUNT</span><h2>{authUser ? "CLOUD SYNC" : "LOCAL STORAGE"}</h2></div><Badge tone={syncStatus === "synced" || storageHealth.status === "saved" ? "gold" : syncStatus === "error" || storageHealth.status === "error" ? "red" : "blue"}>{authUser ? syncStatus.toUpperCase() : storageHealth.status.toUpperCase()}</Badge></div>{authUser ? <><div className="account-summary"><strong>{authUser.email}</strong><span>Decks, drafts, history, settings, and resumable state sync automatically.</span></div>{authError && syncStatus === "error" && <p className="error-message">{authError}</p>}<div className="account-actions"><AppButton tone="blue" onClick={syncNow}>SYNC NOW</AppButton><AppButton tone="ghost" onClick={() => void signOutAccount()}>SIGN OUT</AppButton></div><form className="password-form" onSubmit={submitPassword}><h3>CHANGE PASSWORD</h3><label>CURRENT PASSWORD<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><AppButton type="submit" tone="ghost" disabled={accountBusy}>UPDATE PASSWORD</AppButton></form><div className="delete-account"><h3>DELETE ACCOUNT</h3><p>This removes the cloud account and synced copy. The local browser copy remains until you delete it separately.</p><label>TYPE DELETE TO CONFIRM<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-text" disabled={accountBusy || confirmation.toUpperCase() !== "DELETE"} onClick={() => void removeAccount()}>DELETE CLOUD ACCOUNT</button></div></> : <><div className={`storage-callout ${storageHealth.status === "error" ? "storage-failed" : ""}`}><strong>{storageHealth.status === "error" ? "LATEST CHANGES NOT SAVED" : "SAVED ON THIS DEVICE"}</strong><span>{storageHealth.message}{storageHealth.savedAt ? ` Last successful save: ${new Date(storageHealth.savedAt).toLocaleString()}.` : ""}</span></div><AppButton tone="red" onClick={() => router.push("/")}>SIGN UP OR LOG IN TO SYNC</AppButton></>}{accountError && <p className="error-message" role="alert">{accountError}</p>}<hr /><button className="danger-text" onClick={clearLocalProfile}>DELETE LOCAL BROWSER DATA</button></article></section>
  </>;
}
