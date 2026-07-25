"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge } from "../application/ui";

export function EntryScreen() {
  const { profile, setProfile, authChecking, authBusy, authError, continueAsGuest, authenticate } = useApp();
  const [mode, setMode] = useState<"guest" | "login" | "signup">("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [syncStrategy, setSyncStrategy] = useState<"merge" | "local" | "cloud">("merge");
  const [showRecovery, setShowRecovery] = useState(false);
  const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];

  const validateName = () => {
    const name = profile.name.trim().replace(/\s+/g, " ");
    if (!name) return "Brawler name cannot be blank or whitespace.";
    if (!/^[\p{L}\p{N} _'-]+$/u.test(name)) return "Use letters, numbers, spaces, apostrophes, underscores, or hyphens.";
    if (/^(admin|administrator|moderator|official|support)$/i.test(name)) return "That reserved Brawler name cannot be used.";
    return "";
  };

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (mode === "guest") return;
    const nameError = mode === "signup" ? validateName() : "";
    if (nameError) return setFormError(nameError);
    if (mode === "signup" && password !== confirmPassword) return setFormError("Passwords do not match.");
    const normalizedName = profile.name.trim().replace(/\s+/g, " ");
    if (mode === "signup") setProfile((current: typeof profile) => ({ ...current, name: normalizedName }));
    await authenticate(mode, { email, password, displayName: normalizedName, faction: profile.faction, syncStrategy });
  };

  return <main className="entry-page">
    <header className="public-header"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><nav><a href="#features">Features</a><a href="#rules">Rules</a><a href="#accessibility">Accessibility</a></nav><span>ORIGINAL 2019 RULESET</span></header>
    <section className="entry-hero"><div className="entry-art"><img src="/assets/brawlers.png" alt="The Awesome Brawlers and their Bakugan" /></div><div className="entry-copy"><Badge tone="red">PERSISTENT TCG ACCOUNT SYSTEM</Badge><h1>ANSWER THE CALL<br /><em>TO BRAWL.</em></h1><p>Continue locally on this device, or create an account to sync decks, settings, match history, drafts, and resumable state across devices.</p>
      <div className="auth-tabs" role="tablist" aria-label="Access options">{(["guest", "login", "signup"] as const).map((option) => <button key={option} role="tab" aria-selected={mode === option} aria-controls="access-panel" className={mode === option ? "active" : ""} onClick={() => { setMode(option); setFormError(""); }}>{option === "guest" ? "LOCAL PROFILE" : option === "login" ? "LOG IN" : "SIGN UP"}</button>)}</div>
      {mode === "guest" ? <form id="access-panel" role="tabpanel" className="signin-panel account-panel" onSubmit={(event) => { event.preventDefault(); const nameError = validateName(); if (nameError) return setFormError(nameError); setProfile((current: typeof profile) => ({ ...current, name: current.name.trim().replace(/\s+/g, " ") })); continueAsGuest(); }}>
        <div className="storage-callout"><strong>DEVICE-LOCAL MODE</strong><span>Your decks, settings, drafts, history, and active state remain in this browser after refreshes and restarts when browser storage is available.</span></div>
        <label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required aria-describedby="local-name-help" /></label>
        <small id="local-name-help">1–20 visible characters. Reserved staff names and blank-looking names are blocked.</small>
        <label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label>
        {formError && <p className="error-message" role="alert">{formError}</p>}
        <AppButton type="submit" tone="red">CONTINUE ON THIS DEVICE</AppButton><small>You can link this local profile to an account later without deleting the browser copy.</small>
      </form> : <form id="access-panel" role="tabpanel" className="signin-panel account-panel" onSubmit={submitAccount}>
        {mode === "signup" && <><label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label></>}
        <label>EMAIL ADDRESS<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby="password-requirements" /></label>
        <small id="password-requirements">Use 10–128 characters. A longer, unique passphrase is recommended.</small>
        {mode === "signup" && <label>CONFIRM PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}
        {mode === "login" && <fieldset className="merge-choice"><legend>AFTER LOGIN, USE WHICH DATA?</legend><label><input type="radio" name="sync-strategy" checked={syncStrategy === "merge"} onChange={() => setSyncStrategy("merge")} /><span><strong>Merge safely</strong>Keep both device and cloud decks; conflicts become private recovery copies.</span></label><label><input type="radio" name="sync-strategy" checked={syncStrategy === "local"} onChange={() => setSyncStrategy("local")} /><span><strong>Use this device</strong>Upload this device’s copy over the account snapshot.</span></label><label><input type="radio" name="sync-strategy" checked={syncStrategy === "cloud"} onChange={() => setSyncStrategy("cloud")} /><span><strong>Use cloud copy</strong>Replace the current device state with the account snapshot.</span></label></fieldset>}
        {(formError || authError) && <p className="error-message" role="alert">{formError || authError}</p>}
        <AppButton type="submit" tone="red" disabled={authBusy || authChecking}>{authChecking ? "CHECKING SESSION…" : authBusy ? "CONNECTING…" : mode === "login" ? "LOG IN & CONTINUE" : "CREATE ACCOUNT & SYNC"}</AppButton>
        {mode === "login" && <button className="text-button recovery-link" type="button" onClick={() => setShowRecovery((value) => !value)}>FORGOT PASSWORD?</button>}
        {showRecovery && <div className="storage-callout" role="status"><strong>ADMINISTRATOR-ASSISTED RECOVERY</strong><span>Automated recovery email is not configured for this prototype. Open a private account-recovery request with the project administrator; never include your password.</span><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online/issues/new" target="_blank" rel="noreferrer">OPEN SUPPORT REQUEST →</a></div>}
        <small>Passwords are hashed on the server and sessions use secure, HTTP-only cookies. Your selected data strategy is applied before the first sync.</small>
      </form>}
    </div></section>
    <section id="features" className="entry-features"><article><strong>01</strong><h2>PERSIST</h2><p>Return to the same route, draft, deck, or active match after restarting the browser.</p></article><article><strong>02</strong><h2>PLAY LOCAL</h2><p>Logged-out Brawlers retain their data using browser storage.</p></article><article><strong>03</strong><h2>SYNC</h2><p>Accounts carry decks, settings, records, and state between devices.</p></article></section>
    <section id="rules" className="public-info-section"><div><span className="eyebrow">OFFICIAL REFERENCE</span><h2>RULES & RULINGS</h2><p>The Compendium combines the supplied complete rulebook, advanced glossary, card catalogue, and published developer responses. Digital-adaptation rulings are labelled separately from official tabletop sources.</p><Link className="hex-button ghost" href="/compendium">OPEN COMPENDIUM</Link></div><ul><li>Stable links for cards, glossary entries, and rulings</li><li>Source, revision, and effective-date labels</li><li>Rendered game symbols instead of raw bracket tokens</li></ul></section>
    <section id="accessibility" className="public-info-section"><div><span className="eyebrow">ACCESSIBILITY</span><h2>PLAY WITH THE INTERFACE YOU NEED</h2><p>Keyboard focus, route announcements, reduced motion, high contrast, text scaling, labelled filters, and meaningful image descriptions are supported across non-game screens.</p><Link className="hex-button ghost" href="/settings">ACCESSIBILITY SETTINGS</Link></div><ul><li>Skip links and visible focus states</li><li>Reduced-motion and high-contrast preferences</li><li>Screen-reader friendly navigation and status announcements</li></ul></section>
    <footer className="public-footer"><span>Unofficial fan-made prototype. Bakugan and related marks belong to their respective owners.</span><Link href="/compendium">Rules</Link><Link href="/tools/card-editor">Card editor</Link><a href="#accessibility">Accessibility</a><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online" target="_blank" rel="noreferrer">Project repository</a></footer>
  </main>;
}
