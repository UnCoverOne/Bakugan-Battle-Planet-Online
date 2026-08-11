"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import {
  accountIntentCopy,
  readAccountIntent,
  rememberAccountIntent,
  type AccountIntentReason,
} from "../../lib/account-intent";
import { useApp } from "./AppProvider";
import styles from "./AccountAccessModal.module.css";

export type AccountAccessMode = "login" | "signup";
type AccessView = AccountAccessMode | "recovery";

const RECOVERY_DISPLAY_KEY = "bbp-pending-recovery-code-display-v1";

function generateRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return Array.from({ length: 5 }, (_, index) => characters.slice(index * 4, index * 4 + 4).join("")).join("-");
}

function storeRecoveryCodeForDisplay(code: string) {
  try {
    sessionStorage.setItem(RECOVERY_DISPLAY_KEY, code);
  } catch {
    // The account still works; the code will not be shown after navigation.
  }
}

function clearPendingRecoveryDisplay() {
  try {
    sessionStorage.removeItem(RECOVERY_DISPLAY_KEY);
  } catch {
    // Nothing else is required.
  }
}

export function AccountAccessModal({
  mode,
  onClose,
}: {
  mode: AccountAccessMode;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const {
    profile,
    guestData,
    authBusy,
    authChecking,
    authError,
    authenticate,
    requestAccountAccess,
  } = useApp();
  const intent = useMemo(() => readAccountIntent(), []);
  const intentCopy = accountIntentCopy(intent?.reason);
  const [view, setView] = useState<AccessView>(mode);
  const [displayName, setDisplayName] = useState(profile.name === "Guest Brawler" ? "" : profile.name);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [bringLocalData, setBringLocalData] = useState(true);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySuccessCode, setRecoverySuccessCode] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setView(mode);
  }, [mode]);

  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !authBusy) onClose();
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [authBusy, onClose]);

  const validate = () => {
    if (view === "signup") {
      const normalizedName = displayName.trim().replace(/\s+/g, " ");
      if (!normalizedName) return "Brawler name cannot be blank.";
      if (!/^[\p{L}\p{N} _'-]+$/u.test(normalizedName)) {
        return "Use letters, numbers, spaces, apostrophes, underscores, or hyphens.";
      }
      if (/^(admin|administrator|moderator|official|support)$/i.test(normalizedName)) {
        return "That reserved Brawler name cannot be used.";
      }
    }
    if (view !== "login" && password !== confirmation) return "Passwords do not match.";
    return "";
  };

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setNotice("");
    const error = validate();
    if (error) return setFormError(error);

    const nextRecoveryCode = generateRecoveryCode();
    storeRecoveryCodeForDisplay(nextRecoveryCode);
    const returnTo = intent?.returnTo && intent.returnTo.startsWith("/")
      ? intent.returnTo
      : pathname;
    const result = await authenticate(view, {
      email,
      password,
      displayName: displayName.trim().replace(/\s+/g, " "),
      faction: profile.faction,
      importLocalData: view === "signup" && bringLocalData,
      recoveryCode: nextRecoveryCode,
      returnTo,
    });
    if (!result?.ok) clearPendingRecoveryDisplay();
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setNotice("");
    const error = validate();
    if (error) return setFormError(error);
    const nextRecoveryCode = generateRecoveryCode();
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "recover-password",
          email,
          recoveryCode: recoveryCode.trim().toUpperCase(),
          newPassword: password,
          nextRecoveryCode,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Password could not be reset.");
      setRecoverySuccessCode(nextRecoveryCode);
      setPassword("");
      setConfirmation("");
      setRecoveryCode("");
      setNotice("Password reset. Save the replacement recovery code, then log in with your new password.");
    } catch (recoveryError) {
      setFormError(recoveryError instanceof Error ? recoveryError.message : "Password could not be reset.");
    }
  };

  const switchMode = (next: AccountAccessMode) => {
    setFormError("");
    setNotice("");
    setRecoverySuccessCode("");
    setView(next);
    requestAccountAccess(next);
  };

  const copyRecoveryCode = async () => {
    try {
      await navigator.clipboard.writeText(recoverySuccessCode);
      setNotice("Recovery code copied. Store it somewhere private.");
    } catch {
      setNotice("Copy the recovery code manually and store it somewhere private.");
    }
  };

  const title = view === "recovery"
    ? "Reset password"
    : view === "login"
      ? "Log in"
      : intentCopy.title;
  const eyebrow = view === "recovery" ? "Account recovery" : intentCopy.eyebrow;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !authBusy) onClose();
    }}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-access-title"
      >
        <header className={styles.header}>
          <div>
            <span>{eyebrow}</span>
            <h2 id="account-access-title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            className={styles.close}
            type="button"
            aria-label="Close account window"
            disabled={authBusy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {view === "recovery" ? (
          <form className={styles.form} onSubmit={submitRecovery}>
            <p className={styles.transferIntro}>
              Enter the recovery code issued when you registered or last logged in. Recovery codes are shown once and are never emailed or stored in readable form.
            </p>
            <label className={styles.field}>
              Email address
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className={styles.field}>
              Recovery code
              <input autoComplete="one-time-code" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required />
            </label>
            <label className={styles.field}>
              New password
              <input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <label className={styles.field}>
              Confirm new password
              <input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            </label>
            {recoverySuccessCode && (
              <div className={styles.notice}>
                <strong>Replacement recovery code</strong>
                <code>{recoverySuccessCode}</code>
                <button type="button" onClick={() => void copyRecoveryCode()}>Copy code</button>
              </div>
            )}
            {(formError || notice) && <p className={formError ? styles.error : styles.notice} role={formError ? "alert" : "status"}>{formError || notice}</p>}
            <div className={styles.actions}>
              <button className={styles.quiet} type="button" onClick={() => switchMode("login")}>Back to Log In</button>
              <button className={styles.primary} type="submit">Reset Password</button>
            </div>
          </form>
        ) : (
          <form className={styles.form} onSubmit={submitAccount}>
            <p className={styles.transferIntro}>
              {view === "signup"
                ? intentCopy.copy
                : "Log in to load your account data. Guest decks and progress remain preserved separately on this browser."}
            </p>
            {view === "signup" && (
              <label className={styles.field}>
                Brawler name
                <input value={displayName} maxLength={20} autoComplete="nickname" onChange={(event) => setDisplayName(event.target.value)} required />
              </label>
            )}
            <label className={styles.field}>
              Email address
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className={styles.field}>
              Password
              <input
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete={view === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <p className={styles.help}>Use 10–128 characters. A unique passphrase is recommended.</p>
            {view === "signup" && (
              <label className={styles.field}>
                Confirm password
                <input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
              </label>
            )}
            {view === "signup" && guestData.hasMeaningfulData && (
              <label className={styles.choice}>
                <input type="checkbox" checked={bringLocalData} onChange={(event) => setBringLocalData(event.target.checked)} />
                <span>
                  <strong>Bring my local progress</strong>
                  <span>{guestData.labels.join(" · ")}. Your guest copy remains unchanged on this browser.</span>
                </span>
              </label>
            )}
            {(formError || authError) && <p className={styles.error} role="alert">{formError || authError}</p>}
            {view === "login" && (
              <p className={styles.switchMode}>
                <button type="button" onClick={() => { setFormError(""); setView("recovery"); }}>Forgot password?</button>
              </p>
            )}
            <p className={styles.switchMode}>
              {view === "login" ? "New to Battle Planet?" : "Already have an account?"}
              <button type="button" onClick={() => switchMode(view === "login" ? "signup" : "login")}>
                {view === "login" ? "Create Account" : "Log In"}
              </button>
            </p>
            <div className={styles.actions}>
              <button className={styles.quiet} type="button" onClick={onClose}>Continue as Guest</button>
              <button className={styles.primary} type="submit" disabled={authBusy || authChecking}>
                {authChecking
                  ? "Checking session…"
                  : authBusy
                    ? "Connecting…"
                    : view === "login"
                      ? "Log In"
                      : "Create Account"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function GuestAccountPrompt({
  reason,
  onLogin,
  onRegister,
  onDismiss,
}: {
  reason: "deck-saved" | "match-complete" | "publish-deck" | "favorite-deck";
  onLogin: () => void;
  onRegister: () => void;
  onDismiss: () => void;
}) {
  const prompt = reason === "publish-deck"
    ? {
        title: "Account required to publish",
        copy: "The deck is saved privately on this device. Create an account to publish it under your Brawler name.",
        intent: "publish-deck" as const,
      }
    : reason === "favorite-deck"
      ? {
          title: "Account required to favorite",
          copy: "Create an account or log in to save this Public deck to My Favorites and add one community Favorite.",
          intent: "favorite-deck" as const,
        }
      : reason === "deck-saved"
      ? {
          title: "Deck saved on this device",
          copy: "Create an account to back up this deck and use it on other devices.",
          intent: "deck-saved" as const,
        }
      : {
          title: "Match complete",
          copy: "Create an account to protect eligible progress and unlock achievements.",
          intent: "match-complete" as const,
        };

  const select = (mode: AccountAccessMode) => {
    rememberAccountIntent(prompt.intent as AccountIntentReason, {
      returnTo: window.location.pathname,
      deckId: readAccountIntent()?.deckId,
    });
    if (mode === "signup") onRegister();
    else onLogin();
  };

  return (
    <aside className={styles.prompt} role="status" data-ui="guest-account-prompt">
      <strong>{prompt.title}</strong>
      <p>{prompt.copy}</p>
      <div className={styles.promptActions}>
        <button type="button" onClick={() => select("signup")}>Create Account</button>
        <button type="button" onClick={() => select("login")}>Log In</button>
        <button type="button" onClick={onDismiss}>Not now</button>
      </div>
    </aside>
  );
}
